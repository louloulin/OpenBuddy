#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { auditCommercialModel } from "./audit-commercial-model.mjs";
import { validateCapabilitySnapshot } from "./validate-new-api-capability-snapshot.mjs";
import { validateReconciliationStatus } from "./new-api-reconciliation-worker.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";

const parseList = (value) => [...new Set(text(value).split(",").map((item) => item.trim()).filter(Boolean))];

const cleanUrl = (value, name) => {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be a clean HTTP(S) URL`);
  return url.toString().replace(/\/+$/, "");
};

const check = (name, status, detail) => ({ name, status, detail });

const capabilityModels = (snapshot) => new Set((Array.isArray(snapshot?.models) ? snapshot.models : []).map((entry) => text(entry?.id)).filter(Boolean));

const commercialModels = (commercialModel) => new Set((Array.isArray(commercialModel?.pricing)
  ? commercialModel.pricing.map((entry) => text(entry?.model))
  : commercialModel?.pricing && typeof commercialModel.pricing === "object"
    ? Object.entries(commercialModel.pricing).map(([key, entry]) => text(entry?.model) || text(key))
    : []).filter(Boolean));

const excludedCommercialModels = (commercialModel) => new Map((Array.isArray(commercialModel?.excludedModels) ? commercialModel.excludedModels : []).flatMap((entry) => {
  const model = text(entry?.model);
  const reason = text(entry?.reason);
  return model && reason ? [[model, reason]] : [];
}));

export const auditEnterpriseRelease = async ({ snapshot, commercialModel, capabilities, reconciliationStatus, mode = "development", now = Date.now(), maxAgeHours = 24, reconciliationMaxAgeHours = 26, expectedGatewayVersion, expectedGroups = [], expectedModels = [], expectedChannels = [], gatewayHealth, gatewayUrl, newApiBaseUrl, casdoorIssuer }) => {
  const checks = [];
  let commercialReport;
  try {
    if (!capabilities) {
      checks.push(check("new-api.capability-snapshot", mode === "production" ? "failed" : "blocked", "NEW_API_CAPABILITIES_JSON evidence was not provided"));
    } else {
      const result = validateCapabilitySnapshot(snapshot, { now, maxAgeHours, groups: expectedGroups, models: expectedModels, channels: expectedChannels, capabilities });
      checks.push(check("new-api.capability-snapshot", "passed", `fresh=${result.generatedAt}; groups=${result.groups}; models=${result.models}; channels=${result.channels}; quotaPerUnit=${result.quotaPerUnit}`));
    }
  } catch (error) {
    checks.push(check("new-api.capability-snapshot", "failed", error instanceof Error ? error.message : String(error)));
  }
  try {
    commercialReport = auditCommercialModel(commercialModel);
    checks.push(check("openbuddy.commercial-model", commercialReport.ok ? "passed" : "failed", `plans=${commercialReport.planCount}; models=${commercialReport.modelCount}; errors=${commercialReport.errors.length}`));
  } catch (error) {
    checks.push(check("openbuddy.commercial-model", "failed", error instanceof Error ? error.message : String(error)));
  }
  const pricedModels = commercialModels(commercialModel);
  const excludedModels = excludedCommercialModels(commercialModel);
  const unknownExclusions = [...excludedModels.keys()].filter((model) => !capabilityModels(snapshot).has(model));
  const missingCommercialModels = [...capabilityModels(snapshot)].filter((model) => !pricedModels.has(model) && !excludedModels.has(model));
  const coverageProblems = [
    ...(missingCommercialModels.length ? [`missing pricing or exclusion for ${missingCommercialModels.join(", ")}`] : []),
    ...(unknownExclusions.length ? [`exclusion is not present in snapshot for ${unknownExclusions.join(", ")}`] : []),
  ];
  const modelCoverageStatus = coverageProblems.length === 0 ? "passed" : mode === "production" ? "failed" : "blocked";
  checks.push(check("openbuddy.model-commercial-coverage", modelCoverageStatus, coverageProblems.length === 0 ? `priced=${pricedModels.size}; explicitlyExcluded=${excludedModels.size}` : coverageProblems.join("; ")));

  try {
    if (!reconciliationStatus) throw new Error("reconciliation status evidence was not provided");
    const result = validateReconciliationStatus(reconciliationStatus, { now, maxAgeHours: reconciliationMaxAgeHours });
    checks.push(check("openbuddy.reconciliation-heartbeat", "passed", `runId=${result.runId}; completedAt=${result.completedAt}`));
  } catch (error) {
    checks.push(check("openbuddy.reconciliation-heartbeat", mode === "production" ? "failed" : "blocked", error instanceof Error ? error.message : String(error)));
  }

  const production = mode === "production";
  if (gatewayUrl) {
    try {
      const normalizedGatewayUrl = cleanUrl(gatewayUrl, "OPENBUDDY_GATEWAY_URL");
      if (production && !normalizedGatewayUrl.startsWith("https://")) checks.push(check("openbuddy.gateway-transport", "failed", "production Gateway URL must use HTTPS"));
      else checks.push(check("openbuddy.gateway-transport", "passed", normalizedGatewayUrl.startsWith("https://") ? "HTTPS" : "HTTP development endpoint"));
    } catch (error) {
      checks.push(check("openbuddy.gateway-transport", "failed", error instanceof Error ? error.message : String(error)));
    }
  } else {
    checks.push(check("openbuddy.gateway-transport", production ? "failed" : "blocked", production ? "OPENBUDDY_GATEWAY_URL is required in production" : "Gateway URL was not provided"));
  }
  for (const [name, value] of [["NEW_API_BASE_URL", newApiBaseUrl], ["CASDOOR_ISSUER", casdoorIssuer]]) {
    if (!value) {
      checks.push(check(`${name.toLowerCase()}.transport`, production ? "failed" : "blocked", production ? `${name} is required in production` : `${name} was not provided`));
      continue;
    }
    try {
      const normalized = cleanUrl(value, name);
      checks.push(check(`${name.toLowerCase()}.transport`, production && !normalized.startsWith("https://") ? "failed" : "passed", normalized.startsWith("https://") ? "HTTPS" : "HTTP development endpoint"));
    } catch (error) {
      checks.push(check(`${name.toLowerCase()}.transport`, "failed", error instanceof Error ? error.message : String(error)));
    }
  }
  if (gatewayHealth !== undefined) {
    const healthy = gatewayHealth?.status === "ok" && gatewayHealth?.data?.ok === true;
    checks.push(check("openbuddy.gateway-health", healthy ? "passed" : "failed", healthy ? `store=${text(gatewayHealth.data.store) || "unknown"}; version=${text(gatewayHealth.data.version) || "unknown"}` : "Gateway health payload is not ready"));
    const actualVersion = text(gatewayHealth?.data?.version);
    if (production && !text(expectedGatewayVersion)) {
      checks.push(check("openbuddy.gateway-version", "failed", "OPENBUDDY_EXPECTED_GATEWAY_VERSION is required in production"));
    } else if (text(expectedGatewayVersion) && actualVersion !== text(expectedGatewayVersion)) {
      checks.push(check("openbuddy.gateway-version", "failed", `running Gateway version ${actualVersion || "unknown"} does not match expected ${text(expectedGatewayVersion)}`));
    } else if (text(expectedGatewayVersion)) {
      checks.push(check("openbuddy.gateway-version", "passed", `version=${actualVersion}`));
    }
  } else {
    checks.push(check("openbuddy.gateway-health", production ? "failed" : "blocked", production ? "Gateway health evidence is required in production" : "Gateway health was not provided"));
    if (production) checks.push(check("openbuddy.gateway-version", "failed", "Gateway health is required before version comparison"));
  }
  const failures = checks.filter((item) => item.status === "failed");
  const blocked = checks.filter((item) => item.status === "blocked");
  return { schema: "openbuddy.enterprise-release-audit.v1", mode, ok: failures.length === 0 && blocked.length === 0, checks, failures: failures.length, blocked: blocked.length, ...(commercialReport ? { commercialReport } : {}) };
};

const required = (name) => {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const readJsonValue = async (value, name) => {
  const source = text(value);
  if (!source) return undefined;
  const raw = source.startsWith("@") ? await readFile(source.slice(1), "utf8") : source;
  try { return JSON.parse(raw); } catch { throw new Error(`${name} is not valid JSON`); }
};

export const main = async () => {
  const snapshot = JSON.parse(await readFile(required("OPENBUDDY_CAPABILITY_SNAPSHOT_FILE"), "utf8"));
  const commercialModel = JSON.parse(await readFile(required("OPENBUDDY_COMMERCIAL_MODEL_CONFIG"), "utf8"));
  const capabilities = await readJsonValue(process.env.NEW_API_CAPABILITIES_JSON, "NEW_API_CAPABILITIES_JSON");
  const reconciliationStatus = await readJsonValue(process.env.NEW_API_RECONCILIATION_STATUS_FILE ? `@${process.env.NEW_API_RECONCILIATION_STATUS_FILE}` : "", "NEW_API_RECONCILIATION_STATUS_FILE");
  let gatewayHealth;
  const gatewayUrl = text(process.env.OPENBUDDY_GATEWAY_URL);
  if (gatewayUrl) {
    try {
      const response = await fetch(`${cleanUrl(gatewayUrl, "OPENBUDDY_GATEWAY_URL")}/healthz`);
      gatewayHealth = await response.json().catch(() => undefined);
      if (!response.ok) gatewayHealth = { status: "error", data: { ok: false } };
    } catch {
      gatewayHealth = { status: "error", data: { ok: false } };
    }
  }
  const report = await auditEnterpriseRelease({
    snapshot,
    commercialModel,
    capabilities,
    reconciliationStatus,
    mode: text(process.env.OPENBUDDY_RELEASE_MODE) || "development",
    maxAgeHours: Number(text(process.env.NEW_API_CAPABILITY_MAX_AGE_HOURS) || 24),
    reconciliationMaxAgeHours: Number(text(process.env.NEW_API_RECONCILIATION_MAX_AGE_HOURS) || 26),
    expectedGatewayVersion: text(process.env.OPENBUDDY_EXPECTED_GATEWAY_VERSION),
    expectedGroups: parseList(process.env.NEW_API_EXPECTED_GROUPS),
    expectedModels: parseList(process.env.NEW_API_EXPECTED_MODELS),
    expectedChannels: parseList(process.env.NEW_API_EXPECTED_CHANNELS),
    gatewayHealth,
    gatewayUrl,
    newApiBaseUrl: text(process.env.NEW_API_BASE_URL),
    casdoorIssuer: text(process.env.CASDOOR_ISSUER),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
};

if (process.argv[1]?.endsWith("audit-enterprise-release.mjs")) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
