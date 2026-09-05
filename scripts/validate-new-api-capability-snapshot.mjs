#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const optional = (name, fallback = "") => process.env[name]?.trim() || fallback;
const parseExpected = (value) => [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
const verifiedDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function validateCapabilityDirectory(capabilities, snapshot) {
  const directory = assertObject(capabilities, "capability directory");
  const groups = new Set((Array.isArray(snapshot.groups) ? snapshot.groups : []).map((entry) => entry?.name).filter(Boolean));
  const models = new Set((Array.isArray(snapshot.models) ? snapshot.models : []).map((entry) => entry?.id).filter(Boolean));
  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  const failures = [];
  for (const [group, modelDirectory] of Object.entries(directory)) {
    if (group !== "*" && !groups.has(group)) failures.push(`capability group=${group} is absent from snapshot`);
    if (!modelDirectory || typeof modelDirectory !== "object" || Array.isArray(modelDirectory)) {
      failures.push(`capability group=${group} is not an object`);
      continue;
    }
    for (const [model, protocolDirectory] of Object.entries(modelDirectory)) {
      if (model !== "*" && !models.has(model)) failures.push(`capability model=${model} is absent from snapshot`);
      if (model !== "*" && group !== "*") {
        const routed = channels.some((channel) => (channel?.group === group || !channel?.group) && Array.isArray(channel?.models) && channel.models.includes(model));
        if (!routed) failures.push(`capability route group=${group},model=${model} is absent from snapshot channels`);
      }
      if (!protocolDirectory || typeof protocolDirectory !== "object" || Array.isArray(protocolDirectory)) {
        failures.push(`capability group=${group},model=${model} is not an object`);
        continue;
      }
      for (const [protocol, capability] of Object.entries(protocolDirectory)) {
        if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
          failures.push(`capability ${group}/${model}/${protocol} is invalid`);
          continue;
        }
        if (capability.supported === true && (capability.usage !== "required" || !verifiedDate(capability.verifiedAt))) {
          failures.push(`supported capability ${group}/${model}/${protocol} requires usage=required and verifiedAt=YYYY-MM-DD`);
        }
      }
    }
  }
  if (failures.length) throw new Error(`capability directory drift: ${failures.join("; ")}`);
  return { groups: Object.keys(directory).length, supported: Object.values(directory).reduce((total, modelsForGroup) => total + Object.values(modelsForGroup ?? {}).reduce((count, protocols) => count + Object.values(protocols ?? {}).filter((capability) => capability?.supported === true).length, 0), 0) };
}

export function validateCapabilitySnapshot(snapshot, options = {}) {
  const value = assertObject(snapshot, "capability snapshot");
  if (value.schema !== "openbuddy.new-api-capability-snapshot.v1") throw new Error("unsupported capability snapshot schema");
  const generatedAt = typeof value.generatedAt === "string" ? Date.parse(value.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) throw new Error("capability snapshot generatedAt is invalid");
  const now = options.now ?? Date.now();
  const maxAgeHours = Number(options.maxAgeHours ?? 24);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error("maxAgeHours must be positive");
  if (generatedAt > now + 5 * 60 * 1000) throw new Error("capability snapshot generatedAt is in the future");
  if (now - generatedAt > maxAgeHours * 60 * 60 * 1000) throw new Error(`capability snapshot is older than ${maxAgeHours} hours`);
  const status = assertObject(value.status, "capability snapshot status");
  if (!Number.isFinite(Number(status.quotaPerUnit)) || Number(status.quotaPerUnit) <= 0) throw new Error("capability snapshot quotaPerUnit must be positive");
  const groups = new Set((Array.isArray(value.groups) ? value.groups : []).map((entry) => entry?.name).filter(Boolean));
  const models = new Set((Array.isArray(value.models) ? value.models : []).map((entry) => entry?.id).filter(Boolean));
  const channels = new Set((Array.isArray(value.channels) ? value.channels : []).map((entry) => entry?.id || entry?.name).filter(Boolean));
  const checks = [];
  for (const [kind, expected, actual] of [["group", options.groups ?? [], groups], ["model", options.models ?? [], models], ["channel", options.channels ?? [], channels]]) {
    for (const item of expected) checks.push({ kind, value: item, ok: actual.has(item) });
  }
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) throw new Error(`capability snapshot drift: ${failed.map((check) => `${check.kind}=${check.value}`).join(", ")}`);
  const capabilityDirectory = options.capabilities;
  const capabilityResult = capabilityDirectory ? validateCapabilityDirectory(capabilityDirectory, value) : undefined;
  return { schema: value.schema, generatedAt: value.generatedAt, quotaPerUnit: Number(status.quotaPerUnit), groups: groups.size, models: models.size, channels: channels.size, checks, ...(capabilityResult ? { capabilityDirectory: capabilityResult } : {}) };
}

async function readJsonValue(value, label) {
  if (!value) return undefined;
  const raw = value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value;
  try { return JSON.parse(raw); } catch { throw new Error(`${label} is not valid JSON`); }
}

export async function main() {
  const file = optional("NEW_API_CAPABILITY_SNAPSHOT_FILE");
  if (!file) throw new Error("NEW_API_CAPABILITY_SNAPSHOT_FILE is required");
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  const capabilities = await readJsonValue(process.env.NEW_API_CAPABILITIES_JSON?.trim(), "NEW_API_CAPABILITIES_JSON");
  const result = validateCapabilitySnapshot(snapshot, {
    maxAgeHours: optional("NEW_API_CAPABILITY_MAX_AGE_HOURS", "24"),
    groups: parseExpected(optional("NEW_API_EXPECTED_GROUPS")),
    models: parseExpected(optional("NEW_API_EXPECTED_MODELS")),
    channels: parseExpected(optional("NEW_API_EXPECTED_CHANNELS")),
    capabilities,
  });
  process.stdout.write(`${JSON.stringify({ status: "passed", file, ...result })}\n`);
}

if (process.argv[1]?.endsWith("validate-new-api-capability-snapshot.mjs")) {
  main().catch((error) => { console.error(error?.message ?? error); process.exitCode = 1; });
}
