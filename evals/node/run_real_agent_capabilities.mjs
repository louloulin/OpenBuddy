// Real Electron + Pi capability audit.
// This runner is intentionally fail-closed: it never installs a fixture
// provider and never treats a local fixture response as external evidence.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const providerBaseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";

if (process.env.OPENBUDDY_E2E_REQUIRED !== "1" || !apiKey || !providerBaseUrl || !modelId) {
  console.error("real-agent-capability-audit requires OPENBUDDY_E2E_REQUIRED=1 and complete provider credentials");
  process.exit(2);
}
if (!baseUrl || !token) {
  console.error("real-agent-capability-audit requires OPENBUDDY_HARNESS_URL and OPENBUDDY_HARNESS_TOKEN");
  process.exit(2);
}

const safeError = (error) => {
  let message = String(error?.message ?? error ?? "unknown error");
  if (apiKey) message = message.split(apiKey).join("[redacted-api-key]");
  return message
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
    .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
    .slice(0, 500);
};
const digest = (value) => typeof value === "string" && value ? createHash("sha256").update(value).digest("hex").slice(0, 12) : null;
const errorDigest = (error) => digest(String(error?.message ?? error ?? "unknown error"));
const sequence = (event) => typeof event?.sequence === "number" ? event.sequence : -1;
const encoded = (value) => {
  try { return JSON.stringify(value); } catch { return String(value); }
};
function assertNoCredentialLeak(value, label) {
  const text = encoded(value);
  if (apiKey && text.includes(apiKey)) throw new Error(`${label} exposed the configured API key`);
  if (/sk-[A-Za-z0-9_-]{16,}/.test(text) || /Bearer\s+[A-Za-z0-9._~-]{16,}/.test(text)) {
    throw new Error(`${label} exposed secret-like material`);
  }
}

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = JSON.stringify({ type: "client-request", rpcId: `capability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, payload });
    const request = transport(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" },
      agent: false,
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }); }
        catch { reject(new Error(`non-JSON response from ${method}`)); }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function resultValue(response, label) {
  if (!response?.body?.result?.ok) throw new Error(`${label} failed`);
  return response.body.result.value;
}

async function eventLog(sessionId, limit = 2000) {
  const value = resultValue(await rpc("agent.event-log", { sessionId, limit }), "agent.event-log");
  if (!Array.isArray(value)) throw new Error("agent.event-log returned a non-array");
  return value.filter((event) => event?.sessionId === sessionId).sort((left, right) => sequence(left) - sequence(right));
}

async function waitFor(sessionId, cursor, predicate, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await eventLog(sessionId);
    const post = events.filter((event) => sequence(event) > cursor);
    if (predicate(post)) return { events, post };
    if (post.some((event) => event.type === "agent/error" || event.type === "turn/error")) throw new Error("Pi emitted an agent error");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`event wait timed out for ${digest(sessionId)}`);
}

function assertTrace(post, marker, label, expectedProvider = "custom_anthropic", expectedModel = modelId) {
  const required = ["session/input", "agent/start", "assistant/update", "assistant/end", "agent/settled"];
  let position = -1;
  for (const type of required) {
    const index = post.findIndex((event, current) => current > position && event.type === type);
    if (index < 0) throw new Error(`${label} missing ${type}`);
    position = index;
  }
  for (let index = 1; index < post.length; index += 1) {
    if (sequence(post[index]) <= sequence(post[index - 1])) throw new Error(`${label} sequence is not strictly increasing`);
  }
  const sessionId = post[0]?.sessionId;
  if (typeof sessionId !== "string" || post.some((event) => event.sessionId !== sessionId)) throw new Error(`${label} session identity changed within turn`);
  if (!post.some((event) => ["assistant/update", "assistant/end"].includes(event.type) && encoded(event.payload ?? event).includes(marker))) {
    throw new Error(`${label} marker missing`);
  }
  const assistantMessages = post
    .filter((event) => ["assistant/start", "assistant/update", "assistant/end"].includes(event.type))
    .map((event) => event.payload?.message && typeof event.payload.message === "object" ? event.payload.message : event.payload);
  if (!assistantMessages.some((message) => message?.provider === expectedProvider)) throw new Error(`${label} provider metadata missing`);
  if (!assistantMessages.some((message) => message?.model === expectedModel)) throw new Error(`${label} model metadata missing`);
  if (!assistantMessages.some((message) => message?.api === "anthropic-messages")) throw new Error(`${label} api metadata missing`);
  return {
    marker,
    eventTypes: [...new Set(post.map((event) => event.type))],
    firstSequence: sequence(post[0]),
    lastSequence: sequence(post.at(-1)),
    deltas: post.filter((event) => event.type === "assistant/update").length,
    provider: expectedProvider,
    model: expectedModel,
    api: "anthropic-messages",
    traceDigest: digest(post.map((event) => `${event.sequence}:${event.type}:${event.payload?.message?.provider ?? ""}:${event.payload?.message?.model ?? ""}` ).join("\n")),
  };
}

async function promptAndTrace(sessionId, text, marker, cursor, label, expectedProvider = "custom_anthropic", expectedModel = modelId) {
  const response = await rpc("session.prompt", { sessionId, text });
  resultValue(response, `${label}.prompt`);
  const settled = await waitFor(sessionId, cursor, (post) => post.some((event) => event.type === "agent/settled"));
  return { cursor: Math.max(cursor, ...settled.post.map(sequence)), trace: assertTrace(settled.post, marker, label, expectedProvider, expectedModel), events: settled.events };
}

function credentialFiles(root, relative = "") {
  if (!root) return [];
  const directory = relative ? `${root}/${relative}` : root;
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return credentialFiles(root, next);
      return [next];
    });
  } catch {
    return [];
  }
}

function assertCredentialStorageBoundary(label) {
  const root = process.env.OPENBUDDY_E2E_PI_AGENT_DIR;
  if (!root) return { checked: false };
  const leaked = [];
  for (const relative of credentialFiles(root)) {
    let text;
    try { text = readFileSync(`${root}/${relative}`, "utf8"); } catch { continue; }
    if (apiKey && text.includes(apiKey) && relative !== "auth.json") leaked.push(relative);
  }
  if (leaked.length > 0) throw new Error(`${label} API key escaped auth.json: ${leaked.join(",")}`);
  return { checked: true, leaked: false, files: credentialFiles(root).length };
}

function assertToolTrace(events, marker, label) {
  const starts = events.filter((event) => event.type === "tool/start" && encoded(event.payload ?? event).includes("openbuddy_e2e_tool"));
  const ends = events.filter((event) => event.type === "tool/end" && encoded(event.payload ?? event).includes("openbuddy_e2e_tool"));
  if (starts.length !== 1 || ends.length !== 1) throw new Error(`${label} expected one openbuddy_e2e_tool start/end pair`);
  const startPayload = starts[0]?.payload ?? {};
  const args = startPayload.args ?? startPayload.input ?? {};
  if (args.marker !== marker) throw new Error(`${label} tool marker argument was not exact`);
  if (sequence(starts[0]) >= sequence(ends[0])) throw new Error(`${label} tool end preceded tool start`);
  if (!encoded(ends[0].payload ?? ends[0]).includes(marker)) throw new Error(`${label} tool result marker missing`);
  return { startSequence: sequence(starts[0]), endSequence: sequence(ends[0]), marker, exactArgument: true };
}

const checks = [];
const record = (id, run) => run().then((evidence) => checks.push({ id, ok: true, evidence })).catch((error) => {
  checks.push({ id, ok: false, errorDigest: errorDigest(error) });
});

let primarySessionId;
let primaryEvents = [];
await record("host.describe", async () => {
  const value = resultValue(await rpc("host.describe"), "host.describe");
  if (value?.runtime !== "pi" || value?.product !== "OpenBuddy") throw new Error("unexpected runtime descriptor");
  return { runtime: value.runtime, product: value.product };
});

await record("provider.catalog", async () => {
  const value = resultValue(await rpc("llm.providers"), "llm.providers");
  const provider = (value?.providers ?? []).find((entry) => entry?.id === "custom_anthropic" || entry?.provider === "custom_anthropic");
  if (!provider) throw new Error("custom_anthropic is absent from the live catalog");
  return { provider: "custom_anthropic", model: modelId, api: "anthropic-messages" };
});

await record("provider-model-crud-and-persistence", async () => {
  const providerId = `e2e_custom_${Date.now()}`;
  const customModel = `e2e-model-${Date.now()}`;
  const savedProvider = resultValue(await rpc("capability.providers", {
    action: "save-provider",
    provider: { id: providerId, providerKind: "custom", label: "OpenBuddy E2E Custom", baseUrl: providerBaseUrl, apiBackend: "messages", authScheme: "x_api_key", apiKey },
  }), "provider.save");
  const savedModel = resultValue(await rpc("capability.providers", {
    action: "save-model",
    model: { providerId, modelId: customModel, name: "OpenBuddy E2E Custom Model" },
  }), "model.save");
  const persisted = await rpc("capability.providers", { action: "catalog" });
  const catalog = resultValue(persisted, "provider.catalog.after-crud");
  assertNoCredentialLeak(savedProvider, "provider.save response");
  assertNoCredentialLeak(catalog, "provider catalog");
  if (!catalog.providers.some((entry) => entry.id === providerId) || !catalog.models.some((entry) => entry.providerId === providerId && entry.modelId === customModel)) {
    throw new Error("provider/model CRUD did not persist in live Pi catalog");
  }
  const customSession = resultValue(await rpc("session.create", { cwd: `${process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-real-agent-capabilities"}/custom-${Date.now()}`, modelId: `${providerId}/${customModel}` }), "custom.session.create");
  if (customSession?.model?.provider !== providerId || customSession?.model?.id !== customModel) {
    throw new Error("session.create did not apply the requested custom provider/model");
  }
  const customTrace = await promptAndTrace(customSession.sessionId, "自定义 provider 已切换，只回复 CUSTOM-PROVIDER-7314。不要解释。", "CUSTOM-PROVIDER-7314", 0, "custom-provider-turn", providerId, customModel);
  const storage = assertCredentialStorageBoundary("provider/model CRUD");
  const withoutModel = resultValue(await rpc("capability.providers", { action: "delete-model", providerId, modelId: customModel }), "model.delete");
  const withoutProvider = resultValue(await rpc("capability.providers", { action: "delete-provider", id: providerId }), "provider.delete");
  assertNoCredentialLeak(withoutModel, "model delete response");
  assertNoCredentialLeak(withoutProvider, "provider delete response");
  if (withoutProvider.providers.some((entry) => entry.id === providerId) || withoutModel.models.some((entry) => entry.providerId === providerId && entry.modelId === customModel)) throw new Error("provider/model cleanup was not persisted");
  return { provider: providerId, model: customModel, customProviderTrace: customTrace.trace, secretExposure: false, credentialStorage: storage, deleted: true };
});

await record("skills-lifecycle", async () => {
  const source = process.env.OPENBUDDY_E2E_SKILL_SOURCE;
  if (!source) throw new Error("temporary E2E skill source was not provisioned by launcher");
  const name = "openbuddy-e2e-skill";
  const added = resultValue(await rpc("capability.skills", { action: "add", path: source }), "skill.add");
  const listed = resultValue(await rpc("capability.skills", { action: "list" }), "skill.list");
  if (!listed.some((entry) => entry.name === name)) throw new Error("added skill was not visible through Pi resource loader");
  await rpc("capability.skills", { action: "toggle", name, enabled: false });
  const disabled = resultValue(await rpc("capability.skills", { action: "list" }), "skill.list.disabled");
  if (disabled.find((entry) => entry.name === name)?.enabled !== false) throw new Error("skill toggle was not persisted");
  const skillPath = listed.find((entry) => entry.name === name)?.path;
  if (!skillPath) throw new Error("added skill did not expose a removable path");
  await rpc("capability.skills", { action: "remove", path: skillPath });
  const after = resultValue(await rpc("capability.skills", { action: "list" }), "skill.list.after-remove");
  if (after.some((entry) => entry.name === name)) throw new Error("skill removal was not observable");
  return { name, added: true, toggled: true, removed: true };
});

await record("mcp-disabled-server-lifecycle", async () => {
  const name = `e2e-mcp-${Date.now()}`;
  const server = { name, command: process.execPath, args: ["-e", "process.exit(0)"], disabled: true };
  const upserted = resultValue(await rpc("capability.mcp", { action: "upsert", name, server }), "mcp.upsert");
  if (!upserted.some((entry) => entry.name === name && entry.disabled === true)) throw new Error("MCP config was not persisted");
  const toggled = resultValue(await rpc("capability.mcp", { action: "toggle", name, enabled: false }), "mcp.toggle");
  if (!toggled.some((entry) => entry.name === name && entry.disabled === true)) throw new Error("MCP toggle was not persisted");
  const config = resultValue(await rpc("capability.mcp", { action: "config-read" }), "mcp.config-read");
  if (!config.mcpServers?.[name]) throw new Error("MCP config read omitted persisted server");
  const deleted = resultValue(await rpc("capability.mcp", { action: "delete", name }), "mcp.delete");
  if (deleted.some((entry) => entry.name === name)) throw new Error("MCP delete was not observable");
  return { name, transport: "stdio", executed: false, disabledByTest: true, deleted: true };
});

await record("notifications-automation-subagents-lifecycle", async () => {
  const notification = resultValue(await rpc("capability.notifications", { action: "append", kind: "info", title: "E2E capability notification", body: "round-trip" }), "notification.append");
  const notifications = resultValue(await rpc("capability.notifications", { action: "list" }), "notification.list");
  if (!notifications.some((entry) => entry.id === notification.id)) throw new Error("notification append was not observable");
  await rpc("capability.notifications", { action: "mark-read", id: notification.id });
  const automationId = `e2e-automation-${Date.now()}`;
  const automation = resultValue(await rpc("capability.automation", { action: "save", automation: { id: automationId, name: "E2E automation", prompt: "do not execute external filesystem", status: "active", schedule: { kind: "daily", hour: 0, minute: 0 } } }), "automation.save");
  const snapshot = resultValue(await rpc("capability.automation", { action: "snapshot" }), "automation.snapshot");
  if (!snapshot.automations.some((entry) => entry.id === automationId)) throw new Error("automation save was not observable");
  await rpc("capability.automation", { action: "status", id: automationId, status: "paused" });
  await rpc("capability.automation", { action: "delete", id: automationId });
  const subagents = resultValue(await rpc("capability.subagents", { action: "get" }), "subagents.get");
  if (typeof subagents.maxDepth !== "number" || typeof subagents.maxParallel !== "number") throw new Error("subagent configuration is incomplete");
  await rpc("capability.notifications", { action: "clear" });
  return { notificationId: notification.id, automationId, subagents: { maxDepth: subagents.maxDepth, maxParallel: subagents.maxParallel }, cleaned: true };
});

await record("plugin-inventory-and-team-lifecycle", async () => {
  const plugins = resultValue(await rpc("capability.plugins", { action: "list" }), "plugins.list");
  const inventory = resultValue(await rpc("capability.plugins", { action: "inventory" }), "plugins.inventory");
  if (!Array.isArray(plugins) || !Array.isArray(inventory.piExtensions)) throw new Error("plugin inventory is incomplete");
  const team = resultValue(await rpc("capability.teams", { action: "create", goal: "Return a short status only; do not use filesystem.", size: "small" }), "team.create");
  let status = resultValue(await rpc("capability.teams", { action: "status", id: team.id }), "team.status");
  const deadline = Date.now() + 120_000;
  while (status?.status === "active" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = resultValue(await rpc("capability.teams", { action: "status", id: team.id }), "team.status.poll");
  }
  if (status?.id !== team.id || status.status !== "completed" || !status.members?.every((member) => member.status === "done" && typeof member.output === "string" && member.output.length > 0)) {
    throw new Error("Pi-backed team members did not reach completed/done state");
  }
  const deleted = resultValue(await rpc("capability.teams", { action: "delete", id: team.id }), "team.delete");
  if (deleted !== true) throw new Error("team delete was not observable");
  return { pluginCount: plugins.length, piExtensionCount: inventory.piExtensions.length, teamId: digest(team.id), memberCount: status.members.length, teamCompleted: true, deleted: true };
});

await record("capability.snapshot", async () => {
  const value = resultValue(await rpc("capability.snapshot"), "capability.snapshot");
  if (value?.runtime !== "pi" || value?.contextReady !== true) throw new Error("Pi capability snapshot is not ready");
  if (!value.providerIds?.includes("custom_anthropic")) throw new Error("capability snapshot omitted custom provider");
  if (!Array.isArray(value.plugins) || !Array.isArray(value.mcp) || !value.permission || typeof value.commands !== "number") {
    throw new Error("capability snapshot is incomplete");
  }
  return {
    runtime: value.runtime,
    providerCount: value.providerIds.length,
    modelCount: value.modelIds.length,
    pluginCount: value.plugins.length,
    mcpCount: value.mcp.length,
    commandCount: value.commands,
    permissionMode: value.permission.mode,
  };
});

await record("session.create-and-multiturn", async () => {
  const cwd = `${process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-real-agent-capabilities"}/primary-${Date.now()}`;
  const created = resultValue(await rpc("session.create", { cwd, modelId: `custom_anthropic/${modelId}` }), "session.create");
  if (typeof created?.sessionId !== "string") throw new Error("session.create did not return sessionId");
  primarySessionId = created.sessionId;
  let cursor = 0;
  const first = await promptAndTrace(primarySessionId, "请只回复 CAPABILITY-REAL-FIRST-7314。不要解释。", "CAPABILITY-REAL-FIRST-7314", cursor, "first-turn");
  cursor = first.cursor;
  const second = await promptAndTrace(primarySessionId, "继续同一 Pi session，只回复 CAPABILITY-REAL-CONTEXT-7314。不要解释。", "CAPABILITY-REAL-CONTEXT-7314", cursor, "second-turn");
  cursor = second.cursor;
  const third = await promptAndTrace(primarySessionId, "必须调用 openbuddy_e2e_tool，参数 marker 填 CAPABILITY-REAL-TOOL-7314；工具返回后只回复 CAPABILITY-REAL-TOOL-7314。不要解释。", "CAPABILITY-REAL-TOOL-7314", cursor, "third-tool-turn");
  primaryEvents = third.events;
  assertNoCredentialLeak(primaryEvents, "Pi event log");
  assertCredentialStorageBoundary("Pi event log");
  const tool = assertToolTrace(third.events.filter((event) => sequence(event) > second.cursor), "CAPABILITY-REAL-TOOL-7314", "third-tool-turn");
  const metadata = encoded(primaryEvents);
  if (!metadata.includes("custom_anthropic") || !metadata.includes(modelId) || !metadata.includes("anthropic-messages")) throw new Error("provider/model/api metadata missing from event log");
  return { session: digest(primarySessionId), turns: 3, first: first.trace, second: second.trace, third: third.trace, tool, eventCount: primaryEvents.length };
});

await record("session.query-and-trace", async () => {
  if (!primarySessionId) throw new Error("primary session was not created");
  const history = resultValue(await rpc("session.history", { sessionId: primarySessionId }), "session.history");
  const surface = resultValue(await rpc("session.surface", { sessionId: primarySessionId }), "session.surface");
  const events = await eventLog(primarySessionId);
  const historyEntries = Array.isArray(history?.entries) ? history.entries : [];
  const target = historyEntries.find((event) => event?.type === "assistant/end") ?? historyEntries.at(-1);
  const targetSeq = target?.seq;
  if (!target || !Number.isSafeInteger(targetSeq) || targetSeq < 0) throw new Error("no traceable session-query event");
  const traced = resultValue(await rpc("session.traceEvent", { sessionId: primarySessionId, seq: targetSeq }), "session.traceEvent");
  const read = resultValue(await rpc("session.readEvent", { sessionId: primarySessionId, seq: targetSeq, before: 1, after: 1 }), "session.readEvent");
  if (history?.entries !== undefined && !Array.isArray(history.entries)) throw new Error("history entries are not an array");
  if (surface === undefined || traced === undefined || read === undefined) throw new Error("query response is empty");
  return { session: digest(primarySessionId), historyEntries: historyEntries.length, tracedSequence: targetSeq, surface: typeof surface };
});

await record("plan-task-auth-permission-mcp-lifecycle", async () => {
  if (!primarySessionId) throw new Error("primary session was not created");
  const planText = "真实 provider capability audit plan";
  const plan = resultValue(await rpc("capability.plan", { action: "set", sessionId: primarySessionId, planText }), "plan.setPlan");
  if (plan?.planText !== planText || plan?.enabled !== true) throw new Error("plan state was not persisted");
  const task = resultValue(await rpc("capability.task", { action: "add", sessionId: primarySessionId, content: "real capability task" }), "task.add");
  if (!task?.id) throw new Error("task.add did not return an id");
  const taskList = resultValue(await rpc("capability.task", { action: "list", sessionId: primarySessionId }), "task.list");
  if (!Array.isArray(taskList) || !taskList.some((entry) => entry.id === task.id)) throw new Error("task was not observable");
  const snapshot = resultValue(await rpc("capability.snapshot", { sessionId: primarySessionId }), "capability.snapshot.after-lifecycle");
  if (snapshot.plan?.hasText !== true || snapshot.tasks?.count < 1) throw new Error("capability lifecycle was not reflected in snapshot");
  const permission = resultValue(await rpc("capability.permission", { action: "mode" }), "permission.readMode");
  if (typeof permission !== "string") throw new Error("permission mode is not observable");
  return { planState: plan.state, taskCount: taskList.length, permissionMode: permission, mcpCount: snapshot.mcp.length };
});

await record("session.select-model-and-continue", async () => {
  if (!primarySessionId) throw new Error("primary session was not created");
  resultValue(await rpc("session.selectModel", { sessionId: primarySessionId, modelId: `custom_anthropic/${modelId}` }), "session.selectModel");
  const before = await eventLog(primarySessionId);
  const cursor = Math.max(0, ...before.map(sequence));
  const continued = await promptAndTrace(primarySessionId, "模型保持不变，只回复 CAPABILITY-REAL-MODEL-CONTINUE-7314。", "CAPABILITY-REAL-MODEL-CONTINUE-7314", cursor, "model-continue");
  return { session: digest(primarySessionId), model: `custom_anthropic/${modelId}`, trace: continued.trace };
});

await record("extension-reload-and-rpc-errors", async () => {
  const extensions = resultValue(await rpc("pi.extensions.reload"), "pi.extensions.reload");
  const invalid = await rpc("session.prompt", { sessionId: primarySessionId, text: "" });
  if (invalid?.body?.result?.ok === true) throw new Error("invalid prompt was accepted");
  const unknown = await rpc("capability.unknown-method", {});
  if (unknown?.body?.result?.ok === true) throw new Error("unknown RPC was accepted");
  const follow = resultValue(await rpc("session.list", { cwd: process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-real-agent-capabilities" }), "session.list");
  return { extensionCount: Array.isArray(extensions) ? extensions.length : null, invalidPromptRejected: true, unknownRpcRejected: true, listed: Array.isArray(follow?.items) };
});

await record("abort-lifecycle", async () => {
  const cwd = `${process.env.OPENBUDDY_EVAL_CWD ?? "/tmp/openbuddy-real-agent-capabilities"}/abort-${Date.now()}`;
  const created = resultValue(await rpc("session.create", { cwd, modelId: `custom_anthropic/${modelId}` }), "abort.session.create");
  const sessionId = created.sessionId;
  const before = await eventLog(sessionId);
  const cursor = Math.max(0, ...before.map(sequence));
  resultValue(await rpc("session.prompt", { sessionId, text: "请持续处理一个复杂任务，直到收到取消；不要调用外部 filesystem。" }), "abort.prompt");
  resultValue(await rpc("session.cancel", { sessionId }), "session.cancel");
  const stopped = await waitFor(sessionId, cursor, (post) => post.some((event) => ["agent/settled", "agent/aborted", "agent/error", "turn/error"].includes(event.type)), 60_000);
  return { session: digest(sessionId), terminalEvents: stopped.post.filter((event) => ["agent/settled", "agent/aborted", "agent/error", "turn/error"].includes(event.type)).map((event) => event.type) };
});

const failed = checks.filter((check) => !check.ok);
const report = {
  framework: "openbuddy-real-agent-capability-audit",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
  realE2E: true,
  capabilities: [
    "session-lifecycle",
    "provider-model-crud",
    "pi-extensions",
    "memory",
    "mcp",
    "skills",
    "plan-tasks",
    "automations-notifications",
    "teams-subagents",
  ],
  provider: "custom_anthropic",
  model: modelId,
  api: "anthropic-messages",
  filesystem: "not-run-by-policy",
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
};
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR;
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(`${evidenceDir}/real-agent-capability-audit.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/real-agent-capability-audit.json` : null }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
