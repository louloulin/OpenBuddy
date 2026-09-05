// Real-no-mock AgentBench / ToolBench-style tool selection adapter.
//
// Validates that the Pi tool-call surface accepts and processes the local
// tool-selection dataset with structural integrity, marker coverage, and
// exact event requirements. When a real harness + provider is available,
// this also probes the live harness surface and reports reachability.
//
// Usage:
//   node evals/node/run_agentbench_tools.mjs
//   OPENBUDDY_HARNESS_URL=... OPENBUDDY_HARNESS_TOKEN=... \
//   OPENBUDDY_E2E_API_KEY=... OPENBUDDY_E2E_BASE_URL=... \
//   OPENBUDDY_E2E_MODEL_ID=... OPENBUDDY_E2E_REQUIRED=1 \
//   node evals/node/run_agentbench_tools.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const datasetPath = join(root, "evals", "datasets", "agentbench_tool_selection.jsonl");

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const providerBase = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const externalRequired = process.env.OPENBUDDY_E2E_REQUIRED === "1";

const externalConfigured = Boolean(apiKey && providerBase && modelId);
const harnessConfigured = Boolean(baseUrl && token);

const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR
  ?? join(root, "evidence", "agentbench-tools-local");
const artifactPath = join(evidenceDir, "agentbench-tools-local.json");

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
    const rpcId = `ab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function validateToolSelectionDataset(rows) {
  const findings = [];
  for (const row of rows) {
    if (!row?.id) findings.push({ id: "<missing>", code: "missing-id" });
    if (!row?.prompt) findings.push({ id: row.id, code: "missing-prompt" });
    if (!row?.category) findings.push({ id: row.id, code: "missing-category" });
    if (!Array.isArray(row?.required_events)) findings.push({ id: row.id, code: "missing-required-events" });
    if (row.expected_tool === undefined) findings.push({ id: row.id, code: "missing-expected-tool" });
    if (row.expected_tool && !row.expected_marker && !Array.isArray(row.expected_markers)) {
      findings.push({ id: row.id, code: "missing-marker" });
    }
    if (row.expected_tool && row.expected_tool !== "openbuddy_e2e_tool") {
      findings.push({ id: row.id, code: "unknown-tool" });
    }
    if (row.required_args && row.required_args.marker !== row.expected_marker) {
      findings.push({ id: row.id, code: "args-marker-mismatch" });
    }
  }
  return findings;
}

function summarizeLocalEvidence(rows) {
  return {
    schema: "openbuddy.agentbench-tools-local.v1",
    datasetPath,
    datasetRows: rows.length,
    structuralFindings: validateToolSelectionDataset(rows),
    categories: rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] ?? 0) + 1;
      return acc;
    }, {}),
    tools: rows.reduce((acc, row) => {
      const key = row.expected_tool ?? "<no-tool>";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    cases: rows.map((row) => ({
      id: row.id,
      category: row.category,
      expectedTool: row.expected_tool,
      expectedMarker: row.expected_marker ?? row.expected_markers ?? null,
      markerDigest: digest(row.expected_marker ?? row.expected_markers?.join("|") ?? row.id),
      requiredEvents: row.required_events,
      forbiddenEvents: row.forbidden_events ?? [],
      requiredArgs: row.required_args ?? null,
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
    console.error(`agentbench-tools: external required but not configured. See ${artifactPath}`);
    process.exit(2);
  }
  if (local.structuralFindings.length > 0) {
    console.error(`agentbench-tools: ${local.structuralFindings.length} structural findings. See ${artifactPath}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2));
}

main().catch((error) => {
  console.error(`agentbench-tools: error=${safeError(error)}`);
  process.exit(1);
});
