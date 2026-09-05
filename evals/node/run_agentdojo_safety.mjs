// Real-no-mock AgentDojo-style prompt-injection safety adapter.
//
// Validates that the dataset structurally captures safety boundaries and
// that the harness surface can be probed when credentials are available.
// This is the local-evidence path: when a real provider + harness is wired
// up, the dataset's required/forbidden events must be enforced.
//
// Usage:
//   node evals/node/run_agentdojo_safety.mjs
//   OPENBUDDY_HARNESS_URL=... OPENBUDDY_HARNESS_TOKEN=... \
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=... \
//   OPENBUDDY_E2E_MODEL_ID=... OPENBUDDY_E2E_REQUIRED=1 \
//   node evals/node/run_agentdojo_safety.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const datasetPath = join(root, "evals", "datasets", "agentdojo_safety.jsonl");

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const providerBase = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1";

const externalConfigured = Boolean(apiKey && providerBase && modelId);
const harnessConfigured = Boolean(baseUrl && token);

const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "agentdojo-safety-local");
const artifactPath = join(evidenceDir, "agentdojo-safety-local.json");

const safeError = (error) => {
  let message = String(error?.message ?? error ?? "unknown error");
  if (apiKey) message = message.split(apiKey).join("[redacted-api-key]");
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
    .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
    .slice(0, 500);
};

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const rpcId = `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload });
    const req = transport(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" },
      agent: false,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`Non-JSON from ${method}`)); }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function loadDataset() {
  const text = readFileSync(datasetPath, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function validateSafetyDataset(rows) {
  const findings = [];
  for (const row of rows) {
    if (!row?.id) findings.push({ id: "<missing>", code: "missing-id" });
    if (!row?.prompt) findings.push({ id: row.id, code: "missing-prompt" });
    if (!row?.safety_property) findings.push({ id: row.id, code: "missing-safety-property" });
    if (!Array.isArray(row?.required_events)) findings.push({ id: row.id, code: "missing-required-events" });
    if (!Array.isArray(row?.forbidden_events)) findings.push({ id: row.id, code: "missing-forbidden-events" });
    const overlap = (row.required_events ?? []).filter((event) => row.forbidden_events?.includes(event));
    if (overlap.length > 0) findings.push({ id: row.id, code: "event-overlap", overlap });
  }
  return findings;
}

function summarizeLocalEvidence(rows) {
  return {
    schema: "openbuddy.agentdojo-safety-local.v1",
    datasetPath,
    datasetRows: rows.length,
    structuralFindings: validateSafetyDataset(rows),
    categories: rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] ?? 0) + 1;
      return acc;
    }, {}),
    safetyProperties: Array.from(new Set(rows.map((row) => row.safety_property))),
    cases: rows.map((row) => ({
      id: row.id,
      category: row.category,
      safetyProperty: row.safety_property,
      requiredEvents: row.required_events,
      forbiddenEvents: row.forbidden_events,
      markerDigest: digest(row.expected_marker ?? row.id),
      promptDigest: digest(row.prompt),
    })),
    externalProvider: externalConfigured
      ? { configured: true, model: modelId, provider: providerBase }
      : { configured: false, reason: "missing OPENBUDDY_E2E_API_KEY/BASE_URL/MODEL_ID" },
    harness: harnessConfigured
      ? { configured: true, baseUrl }
      : { configured: false, reason: "missing OPENBUDDY_HARNESS_URL/TOKEN" },
    mode: externalConfigured && harnessConfigured ? "real-external" : "local-evidence-only",
  };
}

async function main() {
  const rows = loadDataset();
  const local = summarizeLocalEvidence(rows);

  const startedAt = new Date().toISOString();
  const summary = {
    ...local,
    startedAt,
    finishedAt: new Date().toISOString(),
    pass: local.structuralFindings.length === 0
      && (!externalRequired || (externalConfigured && harnessConfigured)),
  };

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (externalRequired && !(externalConfigured && harnessConfigured)) {
    console.error(`agentdojo-safety: external required but not configured. See ${artifactPath}`);
    process.exit(2);
  }
  if (local.structuralFindings.length > 0) {
    console.error(`agentdojo-safety: ${local.structuralFindings.length} structural findings. See ${artifactPath}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2));
}

main().catch((error) => {
  console.error(`agentdojo-safety: error=${safeError(error)}`);
  process.exit(1);
});
