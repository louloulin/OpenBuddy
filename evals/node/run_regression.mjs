// Real multi-turn + tool-call regression (MCP-Bench / tau-bench style).
// Reads evals/datasets/core_tasks.jsonl, drives a real Electron harness via
// evals/node/harness_client.mjs.  Requires a running OpenBuddy Electron with
// OPENBUDDY_HARNESS_URL / OPENBUDDY_HARNESS_TOKEN exported.
//
// Honors OPENBUDDY_E2E_API_KEY / OPENBUDDY_E2E_BASE_URL /
// OPENBUDDY_E2E_MODEL_ID and refuses to fall back to mocks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { withRetry, computeDatasetHash, eventsFingerprint, normalizeEventPayload, normalizeTarget } from "./_harness-utils.mjs";
import { compareToGolden } from "./golden-compare.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const datasetPath = join(repoRoot, "evals", "datasets", "core_tasks.jsonl");

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const e2eKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const e2eBase = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const e2eModel = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";

if (!baseUrl || !token) {
  console.error("strict-real-regression requires OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN");
  process.exit(2);
}
if (!required || !(e2eKey && e2eBase && e2eModel)) {
  console.error("Real regression requires OPENBUDDY_E2E_REQUIRED=1 and complete credentials/base/model");
  process.exit(2);
}
const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
const turnTimeoutMs = Number(process.env.OPENBUDDY_EVAL_TIMEOUT_MS ?? 120_000);
const retryAttempts = Number(process.env.OPENBUDDY_EVAL_RETRIES ?? 2);

function rpc(method, payload, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    process.stderr.write(`[rpc] ${method} ${url}\n`);
    const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
    const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload: payload ?? {} });
    const req = lib(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" },
      agent: false,
      ...(signal ? { signal } : {}),
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        try { resolve({ rpcId, status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (error) { reject(new Error(`Bad RPC JSON status=${res.statusCode}: ${chunks.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function readEventLog(sessionId, limit = 200) {
  const response = await rpc("agent.event-log", { sessionId, limit });
  if (!response?.body?.result?.ok) throw new Error(`event-log RPC failed: ${JSON.stringify(response)}`);
  const entries = response.body.result.value;
  if (!Array.isArray(entries)) throw new Error(`event-log RPC returned invalid entries: ${JSON.stringify(entries)}`);
  return entries.filter((entry) => entry?.sessionId === sessionId).slice(-limit);
}
async function waitForAssistantEnd(sessionId, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let snapshot = [];
  while (Date.now() < deadline) {
    const recent = await readEventLog(sessionId, 400);
    snapshot = recent;
    const turns = recent.filter((event) => event.type === "agent/start");
    if (turns.length > 0) {
      const lastTurnStart = turns[turns.length - 1].sequence;
      const afterTurn = recent.filter((event) => event.sequence >= lastTurnStart && event.sessionId === sessionId);
      if (afterTurn.some((event) => event.type === "assistant/end") && afterTurn.some((event) => event.type === "agent/settled")) {
        return { events: recent, lastTurnStart };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`assistant/end timeout after ${deadlineMs}ms (events=${snapshot.length}, types=${JSON.stringify(snapshot.map((event) => ({ type: event.type, sequence: event.sequence, sessionId: event.sessionId, payloadKeys: event.payload && typeof event.payload === "object" ? Object.keys(event.payload).slice(0, 12) : [] })))})`);
}

async function evaluateOne(task) {
  const label = task.id;
  const target = task.target[0];
  const baseCwd = process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-eval";
  const cwd = `${baseCwd}/${label.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const newSession = await rpc("session.create", { cwd, modelId: task.model_id ?? `custom_anthropic/${e2eModel}` });
  if (!newSession?.body?.result?.ok) throw new Error(`new-session failed: ${JSON.stringify(newSession)}`);
  const sessionId = newSession.body.result.value.sessionId;

  const turns = Array.isArray(task.input) ? task.input : [{ turn: task.input, expect: target }];
  let lastTurnStart = 0;
  for (const turn of turns) {
    const before = await readEventLog(sessionId, 600);
    const cursor = Math.max(0, ...before.map((event) => Number.isInteger(event.sequence) ? event.sequence : 0));
    await rpc("session.prompt", { sessionId, text: turn.turn });
    const { events, lastTurnStart: ts } = await waitForAssistantEnd(sessionId, turnTimeoutMs);
    lastTurnStart = ts;
    const turnEvents = events.filter((event) => event.sessionId === sessionId && event.sequence > cursor).sort((a, b) => a.sequence - b.sequence);
    const lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"];
    let position = -1;
    for (const type of lifecycle) {
      const next = turnEvents.findIndex((event, index) => index > position && event.type === type);
      if (next < 0) throw new Error(`${label} missing lifecycle event ${type}`);
      position = next;
    }
    if (turnEvents.some((event, index) => index > 0 && event.sequence <= turnEvents[index - 1].sequence)) {
      throw new Error(`${label} event sequence regressed`);
    }
    if (turnEvents.some((event) => event.sessionId !== sessionId)) throw new Error(`${label} event session identity changed`);
    const expectedMarker = normalizeTarget(turn.expect);
    if (!turnEvents.some((event) => event.type === "assistant/update" && normalizeEventPayload(event).includes(expectedMarker))) {
      throw new Error(`turn did not contain marker ${turn.expect}`);
    }
    if (task.context?.requiresPriorTurns && Array.isArray(task.context.markers) && turns.indexOf(turn) > 0) {
      if (turn.turn && task.context.markers.some((marker) => turn.turn.includes(marker))) {
        throw new Error(`${label} repeats a context marker in the follow-up input`);
      }
      const normalizedSerialized = turnEvents.map((event) => normalizeEventPayload(event)).join("\n");
      const normalizedJoined = normalizeTarget(normalizedSerialized);
      if (!task.context.markers.some((marker) => normalizedJoined.includes(normalizeTarget(marker)))) {
        throw new Error(`${label} did not recover a prior context marker`);
      }
    }
    const metadata = turnEvents.map((event) => JSON.stringify(event.payload ?? event)).join("\n");
    if (!metadata.includes(e2eModel) || !metadata.includes("custom_anthropic") || !metadata.includes("anthropic-messages")) {
      throw new Error(`${label} missing provider/model/api evidence`);
    }
    if (task.expect?.includes("tool_executed")) {
      const starts = turnEvents.filter((event) => event.type === "tool/start" && JSON.stringify(event.payload ?? event).includes("openbuddy_e2e_tool"));
      const ends = turnEvents.filter((event) => event.type === "tool/end" && JSON.stringify(event.payload ?? event).includes("openbuddy_e2e_tool"));
      if (starts.length !== 1 || ends.length !== 1 || starts[0].sequence >= ends[0].sequence) throw new Error(`${label} tool lifecycle is incomplete`);
      const startPayload = starts[0].payload ?? {};
      const args = startPayload.args ?? startPayload.input ?? {};
      if (args.marker !== turn.expect) throw new Error(`${label} tool argument marker is not exact`);
      const endNormalized = normalizeTarget(normalizeEventPayload({ type: "tool/end", payload: ends[0].payload ?? ends[0] }));
      if (!endNormalized.includes(normalizeTarget(turn.expect))) {
        throw new Error(`${label} tool result marker is missing (normalized)`);
      }
    }
  }
  const finalEvents = await readEventLog(sessionId, 600);
  const expectedTarget = normalizeTarget(target);
  const matches = finalEvents
    .filter((event) => event.sequence >= lastTurnStart && event.sessionId === sessionId)
    .filter((event) => normalizeEventPayload(event).includes(expectedTarget));
  const hasToolCall = task.expect?.includes("tool_executed") === true
    ? finalEvents.some((event) => event.type === "tool/start" && JSON.stringify(event.payload ?? event).includes("openbuddy_e2e_tool"))
      && finalEvents.some((event) => event.type === "tool/end" && JSON.stringify(event.payload ?? event).includes("openbuddy_e2e_tool"))
    : true;
  return { id: label, session: sessionId.slice(0, 12), ok: matches.length > 0 && hasToolCall, events: finalEvents.length, realTrace: true };
}

const dataset = readFileSync(datasetPath, "utf8").split("\n").map((line, index) => {
  try { return JSON.parse(line); } catch { return null; }
}).filter(Boolean);

const results = [];
let failed = 0;
for (const task of dataset) {
  try {
    const result = await withRetry(() => evaluateOne(task), {
      attempts: retryAttempts,
      baseDelayMs: 500,
      onRetry: ({ attempt, error }) => {
        const message = String(error?.message ?? error).slice(0, 120);
        console.error(`[retry] task=${task.id} attempt=${attempt} error=${message}`);
      },
    });
    results.push(result);
    if (!result.ok) failed += 1;
  } catch (error) {
    failed += 1;
    results.push({ id: task.id, ok: false, errorDigest: digest(error?.message ?? error) });
  }
}

const datasetHash = computeDatasetHash(dataset);
const goldenDir = join(repoRoot, "evals", "golden", "core-regression");
const goldenComparison = compareToGolden({
  runnerId: "core-regression",
  datasetHash,
  results,
  goldenDir,
});
const summary = {
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
  dataset: "core_tasks.jsonl",
  datasetHash,
  capabilities: ["multiturn-trace"],
  total: dataset.length,
  passed: results.filter((entry) => entry.ok).length,
  failed,
  realE2E: Boolean(e2eKey && e2eBase && e2eModel),
  goldenComparison,
  results: results.map((entry) => ({
    ...entry,
    eventsFingerprint: entry.eventsFingerprint ?? eventsFingerprint(entry.events ?? []),
  })),
};
if (process.env.OPENBUDDY_EVIDENCE_DIR) {
  mkdirSync(process.env.OPENBUDDY_EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(process.env.OPENBUDDY_EVIDENCE_DIR, "core-regression.json"), JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify({ ...summary, evidenceArtifact: process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "core-regression.json") : null }, null, 2));
process.exit(failed === 0 && goldenComparison.pass ? 0 : 1);
