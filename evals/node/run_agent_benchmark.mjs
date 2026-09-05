// Strict real-agent benchmark for OpenBuddy Electron + Pi.
// No fixture/mock fallback: missing real credentials or harness is a failure.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const datasetPath = join(root, "evals", "datasets", "agent_benchmark.jsonl");
const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const providerBaseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";

if (process.env.OPENBUDDY_E2E_REQUIRED !== "1") {
  console.error("strict-real-agent-benchmark requires OPENBUDDY_E2E_REQUIRED=1");
  process.exit(2);
}
if (!baseUrl || !token) {
  console.error("strict-real-agent-benchmark requires OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN");
  process.exit(2);
}
if (!apiKey || !providerBaseUrl || !modelId) {
  console.error("strict-real-agent-benchmark requires complete temporary provider credentials");
  process.exit(2);
}

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const rpcId = `agent-benchmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = JSON.stringify({ type: "client-request", rpcId, method, payload });
    const request = transport(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" },
      agent: false,
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`Non-JSON response from ${method}`)); }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function eventLog(sessionId, limit = 2000) {
  const response = await rpc("agent.event-log", { sessionId, limit });
  if (!response?.result?.ok || !Array.isArray(response.result.value)) throw new Error(`agent.event-log failed for ${sessionId}`);
  return response.result.value.filter((event) => event?.sessionId === sessionId);
}

const stringify = (value) => {
  try { return JSON.stringify(value); } catch { return String(value); }
};
const safeError = (error) => {
  let message = String(error?.message ?? error ?? "unknown error");
  if (apiKey) message = message.split(apiKey).join("[redacted-api-key]");
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
    .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
    .slice(0, 500);
};
const sequence = (event) => typeof event?.sequence === "number" ? event.sequence : -1;
const hasMarker = (event, marker) => stringify(event?.payload ?? event).includes(marker);
const textHash = (text) => createHash("sha256").update(text).digest("hex");
const inputText = (event) => {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object") return undefined;
  if (typeof payload.text === "string") return payload.text;
  if (Array.isArray(payload.content)) {
    return payload.content
      .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  return undefined;
};
const hasInput = (event, text) => event?.type === "session/input"
  && (inputText(event) === text || event.payload?.text?.sha256 === textHash(text));
const inputDiagnostics = (events, expectedText) => events
  .filter((event) => event?.type === "session/input")
  .map((event) => {
    const value = event.payload?.text;
    const contentText = inputText(event);
    return {
      sequence: sequence(event),
      payloadKeys: event.payload && typeof event.payload === "object" ? Object.keys(event.payload).sort() : [],
      textType: typeof value === "string" ? "string" : contentText === undefined ? typeof value : "content-array",
      textLength: typeof value === "string" ? value.length : contentText?.length ?? value?.length ?? null,
      textHash: value && typeof value === "object" ? value.sha256 ?? null : null,
      contentHash: contentText === undefined ? null : textHash(contentText),
      expectedHash: textHash(expectedText),
    };
  });
const payload = (event) => event?.payload && typeof event.payload === "object" ? event.payload : {};
const assistantMessage = (event) => {
  const value = payload(event);
  return value.message && typeof value.message === "object" ? value.message : value;
};
const providerEvidence = (events) => {
  const messages = events
    .filter((event) => event.type === "assistant/start" || event.type === "assistant/update" || event.type === "assistant/end")
    .map(assistantMessage);
  return {
    provider: messages.some((message) => message.provider === "custom_anthropic"),
    model: messages.some((message) => message.model === modelId),
    api: messages.some((message) => message.api === "anthropic-messages"),
  };
};
const hasTurnProviderEvidence = (events) => {
  return providerEvidence(events);
};
const errorDigest = (error) => createHash("sha256").update(String(error?.message ?? error ?? "unknown error")).digest("hex").slice(0, 16);
const safeRpcError = (response, label) => {
  const result = response?.result;
  const candidate = result?.error ?? response?.error ?? result?.value;
  let detail;
  try { detail = JSON.stringify(candidate); } catch { detail = String(candidate); }
  return `${label}: ${detail ? detail.slice(0, 400) : "no response detail"}`;
};
const traceDigest = (events) => createHash("sha256").update(JSON.stringify(events.map((event) => ({
  sequence: sequence(event),
  type: event.type,
  sessionId: event.sessionId,
  provider: assistantMessage(event).provider,
  model: assistantMessage(event).model,
  api: assistantMessage(event).api,
  tool: payload(event).toolName,
  isError: payload(event).isError,
})))).digest("hex").slice(0, 16);

async function waitForSettled(sessionId, cursor, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await eventLog(sessionId);
    const post = events.filter((event) => sequence(event) > cursor);
    if (post.some((event) => event.type === "agent/settled")) return events;
    if (post.some((event) => event.type === "agent/error" || event.type === "turn/error")) throw new Error(`Pi turn failed for ${sessionId}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`agent/settled timeout for ${sessionId}`);
}

function verifyTurn(task, turn, events, cursor, turnIndex) {
  const turnEvents = events.filter((event) => sequence(event) > cursor).sort((a, b) => sequence(a) - sequence(b));
  const requiredEvents = turn.requires ?? task.requires ?? [];
  const missing = requiredEvents.filter((type) => !turnEvents.some((event) => event.type === type));
  if (missing.length) throw new Error(`${task.id} missing ${missing.join(",")}`);
  if (!turnEvents.some((event) => hasInput(event, turn.text))) {
    throw new Error(`${task.id} input not recorded: ${JSON.stringify(inputDiagnostics(turnEvents, turn.text))}`);
  }
  if (!turnEvents.some((event) => (event.type === "assistant/update" || event.type === "assistant/end") && hasMarker(event, turn.marker))) throw new Error(`${task.id} marker missing: ${turn.marker}`);
  const lifecycle = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"];
  let previousIndex = -1;
  for (const type of lifecycle) {
    const index = turnEvents.findIndex((event) => event.type === type && turnEvents.indexOf(event) > previousIndex);
    if (index === -1) throw new Error(`${task.id} lifecycle order missing ${type}`);
    previousIndex = index;
  }
  for (let index = 1; index < turnEvents.length; index += 1) {
    if (sequence(turnEvents[index]) <= sequence(turnEvents[index - 1])) throw new Error(`${task.id} sequence regressed`);
  }
  const sessionId = turnEvents[0]?.sessionId;
  if (typeof sessionId !== "string" || turnEvents.some((event) => event.sessionId !== sessionId)) throw new Error(`${task.id} event session identity changed within turn`);
  const evidence = providerEvidence(turnEvents);
  if (!evidence.provider || !evidence.model || !evidence.api) throw new Error(`${task.id} missing provider/model/api evidence in turn`);
  const expectsTool = requiredEvents.includes("tool/start") || requiredEvents.includes("tool/end");
  if (task.tool && expectsTool) {
    const toolStarts = turnEvents.filter((event) => event.type === "tool/start" && payload(event).toolName === task.tool);
    const toolEnds = turnEvents.filter((event) => event.type === "tool/end" && payload(event).toolName === task.tool);
    if (toolStarts.length !== 1 || toolEnds.length !== 1) throw new Error(`${task.id} expected one tool start/end pair: ${task.tool}`);
    if (sequence(toolStarts[0]) >= sequence(toolEnds[0])) throw new Error(`${task.id} tool end preceded tool start`);
    const expectedMarker = turn.marker;
    const exactArgument = toolStarts.some((event) => payload(event).args && payload(event).args.marker === expectedMarker);
    if (!exactArgument) throw new Error(`${task.id} tool marker argument was not exact: ${expectedMarker}`);
    if (!hasMarker(toolEnds[0], expectedMarker)) throw new Error(`${task.id} tool result marker was not observed: ${expectedMarker}`);
  }
  const recallTurns = Array.isArray(task.context?.recallTurns) ? task.context.recallTurns : [1];
  if (task.context?.requiresPriorTurns && recallTurns.includes(turnIndex) && Array.isArray(task.context.markers)) {
    const configuredRecallMarkers = task.context.recallMarkers?.[String(turnIndex)] ?? task.context.markers;
    const priorMarkers = configuredRecallMarkers.filter((marker) => typeof marker === "string");
    const serializedTurn = turnEvents.map((event) => stringify(event.payload ?? event)).join("\n");
    const missingPriorMarkers = priorMarkers.filter((marker) => !serializedTurn.includes(marker));
    if (missingPriorMarkers.length > 0) {
      throw new Error(`${task.id} prior-context marker missing: ${missingPriorMarkers.join(",")}`);
    }
  }
  return turnEvents;
}

const tasks = readFileSync(datasetPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const results = [];
const categoryTotals = new Map();
const categoryPassed = new Map();
for (const task of tasks) {
  const category = task.category ?? "uncategorized";
  categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + 1);
  try {
    const baseCwd = process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-agent-benchmark";
    const taskCwd = `${baseCwd}/${task.id.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
    const created = await rpc("session.create", { cwd: taskCwd, modelId: `custom_anthropic/${modelId}` });
    if (!created?.result?.ok || typeof created.result.value?.sessionId !== "string") throw new Error(safeRpcError(created, `session.create failed for ${task.id}`));
    const sessionId = created.result.value.sessionId;
    if (results.some((result) => result.session === sessionId.slice(0, 12))) throw new Error(`${task.id} reused a prior benchmark session`);
    let cursor = 0;
    let finalEvents = [];
    let lastTurnEvents = [];
    for (const [turnIndex, turn] of task.turns.entries()) {
      const before = await eventLog(sessionId);
      cursor = Math.max(cursor, ...before.map(sequence));
      const prompted = await rpc("session.prompt", { sessionId, text: turn.text });
      if (!prompted?.result?.ok) throw new Error(safeRpcError(prompted, `session.prompt failed for ${task.id}`));
      finalEvents = await waitForSettled(sessionId, cursor);
      const turnEvents = verifyTurn(task, turn, finalEvents, cursor, turnIndex);
      lastTurnEvents = turnEvents;
      if (task.context?.requiresPriorTurns && turnIndex > 0) {
        const inputText = turn.text;
        if (task.context.markers?.some((marker) => inputText.includes(marker))) {
          throw new Error(`${task.id} turn ${turnIndex + 1} repeats a context marker in its input`);
        }
        if (!turnEvents.some((event) => hasInput(event, inputText))) throw new Error(`${task.id} turn input was not recorded`);
      }
      cursor = Math.max(cursor, ...turnEvents.map(sequence));
    }
    const evidence = hasTurnProviderEvidence(lastTurnEvents);
    if (!evidence.provider || !evidence.model || !evidence.api) throw new Error(`${task.id} missing provider metadata`);
    results.push({ ok: true, id: task.id, category, session: sessionId.slice(0, 12), turns: task.turns.length, events: finalEvents.length, evidence, traceDigest: traceDigest(finalEvents) });
    categoryPassed.set(category, (categoryPassed.get(category) ?? 0) + 1);
  } catch (error) {
    results.push({ id: task.id, category, ok: false, errorDigest: errorDigest(error), failure: safeError(error) });
  }
}

const failed = results.filter((result) => result.ok !== true);
const categories = Object.fromEntries([...categoryTotals].sort(([left], [right]) => left.localeCompare(right)).map(([category, total]) => [category, { total, passed: categoryPassed.get(category) ?? 0, failed: total - (categoryPassed.get(category) ?? 0) }]));
const report = { framework: "strict-real-agent-benchmark", provider: "custom_anthropic", model: modelId, api: "anthropic-messages", capabilities: ["session-lifecycle", "multiturn-trace"], total: results.length, passed: results.length - failed.length, failed: failed.length, categories, results };
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR;
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(`${evidenceDir}/strict-real-agent-benchmark.json`, JSON.stringify({
    schema: "openbuddy.redacted-evidence.v1",
    evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
    framework: report.framework,
    provider: report.provider,
    model: report.model,
    api: report.api,
    capabilities: report.capabilities,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    categories: report.categories,
    results: report.results.map(({ id, category, ok, session, turns, events, evidence, traceDigest, errorDigest: failure, failure: detail }) => ({ id, category, ok, session: session ?? null, turns: turns ?? null, events: events ?? null, evidence: evidence ?? null, traceDigest: traceDigest ?? null, errorDigest: failure ?? null, failure: detail ?? null })),
  }, null, 2));
}
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/strict-real-agent-benchmark.json` : null }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
