import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const baseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
const providerId = "custom_anthropic";
if (!required || !apiKey || !baseUrl || !modelId) {
  console.error("expert-graph-smoke requires OPENBUDDY_E2E_REQUIRED=1 and complete provider credentials");
  process.exit(2);
}

const userData = mkdtempSync(join(tmpdir(), "openbuddy-expert-graph-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
const expertRoot = join(userData, "experts");
mkdirSync(join(piAgentDir, "agents"), { recursive: true });
mkdirSync(join(piAgentDir, "agent-presets", "graph-standing"), { recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(join(expertRoot, "_meta"), { recursive: true });
mkdirSync(join(expertRoot, "reviewer", ".aily-plugin"), { recursive: true });
mkdirSync(join(expertRoot, "reviewer", "agents"), { recursive: true });
mkdirSync(join(expertRoot, "reviewer-team", ".aily-plugin"), { recursive: true });
mkdirSync(join(expertRoot, "reviewer-team", "agents"), { recursive: true });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: apiKey } }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({
  providers: {
    custom_anthropic: {
      name: "OpenBuddy expert graph",
      baseUrl,
      api: "anthropic-messages",
      authHeader: false,
      models: [{ id: modelId, name: modelId, contextWindow: 128000, maxTokens: 4096 }],
    },
  },
}, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "agent-presets.json"), `${JSON.stringify({ default: "graph-standing" }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "agent-presets", "graph-standing", "preset.yml"), "name: Graph standing preset\ndescription: Evidence-only preset for child composition inheritance\n", "utf8");
writeFileSync(join(piAgentDir, "agent-presets", "graph-standing", "preset-plugin.mjs"), `
export default {
  name: "graph-standing-preset",
  apply(ctx) {
    const tools = ctx.get("toolRegistry");
    const prompt = ctx.get("systemPrompt");
    const removeTool = tools.registerTool({
      name: "graph_standing_preset_tool",
      label: "Graph standing preset tool",
      description: "Evidence-only tool proving preset composition inheritance.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: "text", text: "GRAPH-STANDING-PRESET-TOOL" }] }),
    });
    const removePrompt = prompt.section({
      name: "graph-standing-preset",
      order: 10,
      text: "You are GRAPH-STANDING-PRESET-ROLE-7314. Preserve this standing preset context.",
    });
    return () => { removePrompt(); removeTool(); };
  },
};
`, "utf8");
writeFileSync(join(piAgentDir, "agent-presets", "graph-standing", "agent.cordis.yml"), "- id: graph-standing-preset\n  name: ./preset-plugin.mjs\n", "utf8");
writeFileSync(join(expertRoot, "_meta", "_expert_center.json"), JSON.stringify({
  categories: [{ id: "code", name: { zh: "代码", en: "Code" } }],
  experts: [
    {
      id: "reviewer",
      categoryId: "code",
      plugin: "reviewer",
      displayName: { zh: "图谱审查员", en: "Graph Reviewer" },
      profession: { zh: "专家图审查", en: "Graph Review" },
      displayDescription: { zh: "验证专家目录、Pi agent 与真实对话链路" },
      quickPrompts: [{ zh: "只回复 EXPERT-GRAPH-REPLY-7314" }],
      expertType: "agent",
    },
    {
      id: "reviewer-team",
      categoryId: "code",
      plugin: "reviewer-team",
      displayName: { zh: "图谱审查团队", en: "Graph Review Team" },
      displayDescription: { zh: "包含多个 Pi agent 成员" },
      expertType: "team",
    },
  ],
}), "utf8");
writeFileSync(join(expertRoot, "reviewer", ".aily-plugin", "plugin.json"), JSON.stringify({ agentName: "reviewer", avatar: "avatar.svg" }), "utf8");
writeFileSync(join(expertRoot, "reviewer", "avatar.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"><rect width=\"2\" height=\"2\" fill=\"#000\"/></svg>", "utf8");
writeFileSync(join(expertRoot, "reviewer", "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Graph reviewer\n---\nYou are EXPERT-GRAPH-ROLE-7314. Always preserve that role while reviewing.\n", "utf8");
writeFileSync(join(expertRoot, "reviewer-team", ".aily-plugin", "plugin.json"), JSON.stringify({}), "utf8");
writeFileSync(join(expertRoot, "reviewer-team", "agents", "planner.md"), "---\nname: planner\ndescription: Graph planner\n---\nPlan graph checks.\n", "utf8");
writeFileSync(join(expertRoot, "reviewer-team", "agents", "explorer.md"), "---\nname: explorer\ndescription: Graph explorer\n---\nExplore graph checks.\n", "utf8");

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const fullHash = (value) => createHash("sha256").update(String(value)).digest("hex");
const safeError = (error) => String(error?.message ?? error ?? "unknown")
  .split(apiKey).join("[redacted-api-key]")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .slice(0, 500);
const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? pathJoin(root, "node_modules", ".bin", "electron");
const childEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_AGENTS_DIR: expertRoot,
  OPENBUDDY_FILESYSTEM_SMOKE: "0",
  OPENBUDDY_DEBUG_UI: "0",
};
let app;
let page;
let passed = false;
const rendererErrors = [];
const failedRequests = [];

async function events(sessionId) {
  const value = await page.evaluate((id) => window.api.invoke("agent:event-log", { sessionId: id, limit: 2000 }), sessionId);
  if (!Array.isArray(value)) throw new Error("agent:event-log returned a non-array");
  return value.filter((event) => event?.sessionId === sessionId);
}

async function waitForSettled(sessionId, expectedInputHash) {
  const deadline = Date.now() + Number(process.env.OPENBUDDY_EXPERT_GRAPH_TURN_TIMEOUT_MS ?? 45_000);
  let latest = [];
  while (Date.now() < deadline) {
    const current = await events(sessionId);
    latest = current;
    const inputIndex = current.findIndex((event) => event.type === "session/input" && event.payload?.text?.sha256 === expectedInputHash);
    const post = inputIndex >= 0 ? current.slice(inputIndex) : [];
    const terminal = post.some((event) => event.type === "agent/settled" || event.type === "agent/agent_settled" || event.type === "agent/agent_settle")
      || (post.some((event) => event.type === "agent/end") && post.some((event) => event.type === "turn/end"));
    if (terminal) return { current, post };
    if (post.some((event) => event.type === "agent/error" || event.type === "turn/error")) throw new Error("Pi emitted an agent error");
    await page.waitForTimeout(300);
  }
  throw new Error(`expert graph event wait timed out for ${digest(sessionId)}: ${JSON.stringify({ expectedInputHash: String(expectedInputHash).slice(0, 12), eventCount: latest.length, eventTypes: [...new Set(latest.map((event) => event.type))], inputHashes: latest.filter((event) => event.type === "session/input").map((event) => event.payload?.text?.sha256).slice(-4), lastEvents: latest.slice(-8).map((event) => ({ sequence: event.sequence, sessionSequence: event.sessionSequence, type: event.type, sessionId: digest(event.sessionId) })) })}`);
}

function assertTrace(post, expectedInputHash) {
  const requiredTypes = ["session/input", "agent/start", "assistant/update", "assistant/end"];
  let cursor = -1;
  for (const type of requiredTypes) {
    const index = post.findIndex((event, offset) => offset > cursor && event.type === type);
    if (index < 0) throw new Error(`expert graph trace missing ${type}`);
    cursor = index;
  }
  if (!post.some((event) => event.type === "agent/settled" || event.type === "agent/agent_settled" || event.type === "agent/agent_settle")
    && !(post.some((event) => event.type === "agent/end") && post.some((event) => event.type === "turn/end"))) throw new Error("expert graph trace missing terminal agent event");
  const input = post.find((event) => event.type === "session/input");
  const inputText = input?.payload?.text;
  if (!inputText || typeof inputText !== "object" || inputText.sha256 !== expectedInputHash) throw new Error("hidden expert persona hash did not reach Pi session/input");
  if (!post.some((event) => JSON.stringify(event.payload ?? event).includes("EXPERT-GRAPH-REPLY-7314"))) throw new Error("expert conversation reply marker missing");
  const wire = post.filter((event) => ["assistant/start", "assistant/update", "assistant/end"].includes(event.type)).map((event) => JSON.stringify(event.payload ?? event)).join("\n");
  if (!wire.includes('"provider":"custom_anthropic"') || !wire.includes(`"model":"${modelId}"`) || !wire.includes('"api":"anthropic-messages"')) throw new Error("expert trace provider metadata missing");
  return { inputDigest: digest(inputText), eventTypes: [...new Set(post.map((event) => event.type))], eventCount: post.length, traceDigest: digest(post.map((event) => `${event.sequence}:${event.type}`).join("\n")) };
}

try {
  app = await electron.launch({ args: [`--user-data-dir=${userData}`, root], executablePath: electronPath, cwd: root, timeout: 30_000, env: childEnv });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      rendererErrors.push(`${message.text()} @ ${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`);
    }
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  const sessionCwd = workspace;

  const catalog = await page.evaluate((rootPath) => window.api.invoke("experts_load", { root: rootPath }), expertRoot);
  const reviewer = catalog?.experts?.find((entry) => entry.id === "reviewer");
  const team = catalog?.experts?.find((entry) => entry.id === "reviewer-team");
  if (!reviewer || reviewer.type !== "agent" || reviewer.plugin !== "reviewer") throw new Error("expert catalog node is incomplete");
  if (!team || team.type !== "team") throw new Error("expert team catalog node is incomplete");
  const prompt = await page.evaluate(({ rootPath }) => window.api.invoke("experts_read_agent_prompt", { root: rootPath, plugin: "reviewer", agentName: "reviewer" }), { rootPath: expertRoot });
  if (!String(prompt).includes("EXPERT-GRAPH-ROLE-7314")) throw new Error("agent prompt node is incomplete");
  const linked = await page.evaluate(({ rootPath }) => window.api.invoke("experts_link_agents", { root: rootPath, plugin: "reviewer-team" }), { rootPath: expertRoot });
  if (linked !== 2) throw new Error(`team link count mismatch: ${linked}`);
  const linkedAgents = await page.evaluate(() => window.api.invoke("agents_list"));
  if (!linkedAgents.some((entry) => entry.name === "planner") || !linkedAgents.some((entry) => entry.name === "explorer")) throw new Error("team agent files were not linked into Pi");

  await page.getByRole("button", { name: "专家·技能·连接器", exact: true }).click();
  await page.getByRole("tab", { name: "专家", exact: true }).nth(1)
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("图谱审查员", { exact: true }).first().click();
  await page.getByRole("button", { name: "召唤 专家图审查", exact: true }).click();
  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  const expertBadge = page.locator(".wb-composer__expert-badge").first();
  await expertBadge.waitFor({ state: "visible", timeout: 15_000 });
  const badgeText = (await expertBadge.innerText()).replace(/\s+/g, "").trim();
  if (!badgeText.includes("专家图审查")) throw new Error(`unexpected active expert badge: ${badgeText}`);
  await composer.fill("只回复 EXPERT-GRAPH-REPLY-7314");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => {
    try { return typeof JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null")?.sessionId === "string"; } catch { return false; }
  }, undefined, { timeout: 30_000 });
  const sessionId = await page.evaluate(() => JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null")?.sessionId);
  const expectedInput = `<!--EXPERT_PERSONA_BEGIN-->\nYou are EXPERT-GRAPH-ROLE-7314. Always preserve that role while reviewing.\n<!--EXPERT_PERSONA_END-->\n\n只回复 EXPERT-GRAPH-REPLY-7314`;
  const traceResult = await waitForSettled(sessionId, fullHash(expectedInput));
  const trace = assertTrace(traceResult.post, fullHash(expectedInput));

  // === Multi-turn expert persona persistence ===
  // Verifies the hidden persona survives subsequent turns in the same Pi
  // session: each turn re-emits a session/input that still carries the
  // EXPERT_PERSONA_BEGIN/END envelope, and the model replies with the
  // expected markers proving the same session/context is reused.
  // Persona is only injected on the first turn (App.tsx clears the pending
  // expert after the first prompt), so subsequent turns record the raw user
  // prompt in session/input. We verify three things across multi-turn:
  //   1. the same Pi session ID is reused (turn cursor advances, session stays);
  //   2. the model remembers context from earlier turns (reply markers match);
  //   3. expert binding survives across turns in sessions:list metadata.
  const multiTurnTurns = [
    { turn: 2, prompt: "记住 MULTI-EXPERT-7314，只回复 ACK-MULTI-EXPERT", marker: "ACK-MULTI-EXPERT" },
    { turn: 3, prompt: "基于上一轮记忆，只回复 MULTI-EXPERT-7314，不要重新询问", marker: "MULTI-EXPERT-7314" },
  ];
  const multiTurnEvidence = [];
  for (const item of multiTurnTurns) {
    const expectedRawHash = fullHash(item.prompt);
    await composer.fill(item.prompt);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const turnResult = await waitForSettled(sessionId, expectedRawHash);
    const turnInput = turnResult.post.find((event) => event.type === "session/input");
    if (!turnInput) throw new Error(`multi-turn ${item.turn} missing session/input`);
    const turnText = turnInput?.payload?.text;
    if (!turnText || typeof turnText !== "object" || turnText.sha256 !== expectedRawHash) {
      throw new Error(`multi-turn ${item.turn} session/input hash mismatch: expected ${expectedRawHash.slice(0, 12)} (raw prompt) got ${String(turnText?.sha256 ?? "?").slice(0, 12)}`);
    }
    if (!turnResult.post.some((event) => JSON.stringify(event.payload ?? event).includes(item.marker))) {
      throw new Error(`multi-turn ${item.turn} reply marker ${item.marker} missing`);
    }
    const wire = turnResult.post
      .filter((event) => ["assistant/start", "assistant/update", "assistant/end"].includes(event.type))
      .map((event) => JSON.stringify(event.payload ?? event))
      .join("\n");
    if (!wire.includes(`"provider":"${providerId}"`) || !wire.includes(`"model":"${modelId}"`) || !wire.includes('"api":"anthropic-messages"')) {
      throw new Error(`multi-turn ${item.turn} provider metadata missing`);
    }
    multiTurnEvidence.push({ turn: item.turn, marker: item.marker, inputHashPrefix: expectedRawHash.slice(0, 12), inputKind: "raw-prompt", eventCount: turnResult.post.length, eventDigest: digest(turnResult.post.map((event) => `${event.sequence}:${event.type}`).join("\n")) });
    const stillBound = await page.evaluate(async ({ sessionId, cwdCandidates }) => {
      for (const cwd of cwdCandidates) {
        const entries = await window.api.invoke("sessions:list", cwd);
        const match = entries.find((entry) => entry.sessionId === sessionId);
        if (match) return match;
      }
      return null;
    }, { sessionId, cwdCandidates: [...new Set([sessionCwd, root, workspace])] });
    if (!stillBound || stillBound.expertId !== "reviewer" || stillBound.expertName !== "专家图审查") {
      throw new Error(`multi-turn ${item.turn} expert binding lost`);
    }
  }

  let session;
  let lastSessions = [];
  const sessionDeadline = Date.now() + 10_000;
  while (Date.now() < sessionDeadline && !session) {
    const cwdCandidates = [...new Set([sessionCwd, root, workspace])];
    const batches = await Promise.all(cwdCandidates.map((cwd) => page.evaluate((value) => window.api.invoke("sessions:list", value), cwd)));
    lastSessions = batches.flat();
    session = lastSessions.find((entry) => entry.sessionId === sessionId);
    if (!session) await page.waitForTimeout(250);
  }
  if (!session || session.expertId !== "reviewer" || session.expertName !== "专家图审查") {
    throw new Error(`session expert binding metadata missing: ${JSON.stringify({ sessionId: digest(sessionId), sessionCwd, seen: lastSessions.slice(0, 8).map((entry) => ({ sessionId: digest(entry.sessionId), expertId: entry.expertId, expertName: entry.expertName })) })}`);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  if (!(await page.locator("body").innerText()).includes("专家图审查")) throw new Error("expert badge did not survive renderer reload");
  const restoredSession = await page.evaluate(async ({ sessionId, cwdCandidates }) => {
    for (const cwd of cwdCandidates) {
      const entries = await window.api.invoke("sessions:list", cwd);
      const match = entries.find((entry) => entry.sessionId === sessionId);
      if (match) return match;
    }
    return null;
  }, { sessionId, cwdCandidates: [...new Set([sessionCwd, root, workspace])] });
  if (!restoredSession || restoredSession.expertId !== "reviewer" || restoredSession.expertName !== "专家图审查") {
    throw new Error("expert binding metadata did not survive renderer reload");
  }

  const teamRecord = await page.evaluate(() => window.api.invoke("teams:create", {
    goal: "每个成员都必须完成任务，并返回非空的团队成员结果。只需说明你完成了团队角色工作。",
    size: "small",
  }));
  if (!teamRecord?.id || !Array.isArray(teamRecord.members) || teamRecord.members.length !== 2) {
    throw new Error("team runtime did not create the expected small team");
  }
  let teamStatus = teamRecord;
  const teamDeadline = Date.now() + 180_000;
  while (Date.now() < teamDeadline && teamStatus?.status === "active") {
    await page.waitForTimeout(500);
    teamStatus = await page.evaluate((teamId) => window.api.invoke("teams:status", teamId), teamRecord.id);
  }
  if (!teamStatus || teamStatus.status !== "completed") {
    throw new Error(`team execution did not complete: ${JSON.stringify({ teamId: digest(teamRecord.id), status: teamStatus?.status, members: teamStatus?.members?.map((member) => ({ role: member.role, status: member.status, hasOutput: Boolean(member.output) })) })}`);
  }
  if (!teamStatus.members.every((member) => member.status === "done" && typeof member.output === "string" && member.output.trim().length > 0)) {
    throw new Error(`team member output/status evidence is incomplete: ${JSON.stringify(teamStatus.members.map((member) => ({ role: member.role, status: member.status, hasOutput: Boolean(member.output) })))}`);
  }
  const activePreset = await page.evaluate(() => window.api.invoke("agent:preset-current"));
  if (activePreset?.id !== "graph-standing") throw new Error(`standing preset was not mounted: ${JSON.stringify(activePreset)}`);
  const teamEvents = await page.evaluate(() => window.api.invoke("agent:event-log", { limit: 2000 }));
  const teamTraceEvents = Array.isArray(teamEvents)
    ? teamEvents.filter((event) => event?.payload?.teamId === teamRecord.id)
    : [];
  const memberEvents = teamTraceEvents.filter((event) => ["subagent/start", "subagent/end"].includes(event.type));
  const memberIds = new Set(teamStatus.members.map((member) => member.id));
  const observedMemberIds = new Set(memberEvents.map((event) => event.payload?.memberId).filter((id) => memberIds.has(id)));
  if (observedMemberIds.size !== teamStatus.members.length || !memberEvents.some((event) => event.type === "subagent/start") || !memberEvents.some((event) => event.type === "subagent/end")) {
    throw new Error(`team Pi member trace is incomplete: ${JSON.stringify({ teamId: digest(teamRecord.id), memberCount: teamStatus.members.length, observedMemberCount: observedMemberIds.size, eventTypes: [...new Set(memberEvents.map((event) => event.type))] })}`);
  }
const memberSessionIds = new Map(memberEvents
    .filter((event) => event.type === "subagent/start" && typeof event.payload?.memberId === "string" && typeof event.payload?.id === "string")
    .map((event) => [event.payload.memberId, event.payload.id]));
  if (memberSessionIds.size !== teamStatus.members.length) {
    throw new Error(`team member Pi session identities are incomplete: ${JSON.stringify({ teamId: digest(teamRecord.id), expected: teamStatus.members.length, observed: memberSessionIds.size })}`);
  }
  const presetStarts = memberEvents
    .filter((event) => event.type === "subagent/start")
    .map((event) => event.payload ?? {});
  if (presetStarts.some((payload) => payload.presetId !== "graph-standing" || payload.presetPromptIncluded !== true || !Array.isArray(payload.customToolNames) || !payload.customToolNames.includes("graph_standing_preset_tool") || !Array.isArray(payload.registeredCustomToolNames) || !payload.registeredCustomToolNames.includes("graph_standing_preset_tool"))) {
    throw new Error(`standing preset was not inherited by every child: ${JSON.stringify(presetStarts.map((payload) => ({ presetId: payload.presetId, presetPromptIncluded: payload.presetPromptIncluded, customHasTool: Array.isArray(payload.customToolNames) && payload.customToolNames.includes("graph_standing_preset_tool"), registeredHasTool: Array.isArray(payload.registeredCustomToolNames) && payload.registeredCustomToolNames.includes("graph_standing_preset_tool"), customCount: payload.customToolNames?.length, registeredCount: payload.registeredCustomToolNames?.length, modelFacingCount: payload.modelFacingToolNames?.length })))}`);
  }
  const sessionHeaders = (await Promise.all(
    [...new Set([sessionCwd, root, workspace])].map((cwd) => page.evaluate((value) => window.api.invoke("sessions:list", value), cwd)),
  )).flat();
  const memberTraces = teamStatus.members.map((member) => {
    const childSessionId = memberSessionIds.get(member.id);
    if (!childSessionId) throw new Error(`missing child session for team member ${member.role}`);
    const childEvents = teamTraceEvents
      .filter((event) => event.sessionId === childSessionId)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence));
    const requiredChildTypes = ["session/input", "agent/start", "assistant/update", "assistant/end"];
    let position = -1;
    for (const type of requiredChildTypes) {
      const index = childEvents.findIndex((event, current) => current > position && event.type === type);
      if (index < 0) throw new Error(`child session ${member.role} is missing ${type}`);
      position = index;
    }
    if (!childEvents.some((event) => event.type === "agent/settled" || event.type === "agent/agent_settled" || event.type === "agent/agent_settle")
      && !(childEvents.some((event) => event.type === "agent/end") && childEvents.some((event) => event.type === "turn/end"))) throw new Error(`child session ${member.role} is missing terminal agent event`);
    for (let index = 1; index < childEvents.length; index += 1) {
      if (Number(childEvents[index].sequence) <= Number(childEvents[index - 1].sequence)) {
        throw new Error(`child session ${member.role} event sequence is not strictly increasing`);
      }
    }
    const wire = childEvents.map((event) => JSON.stringify(event.payload ?? event)).join("\n");
    if (!wire.includes(`"provider":"${providerId}"`) || !wire.includes(`"model":"${modelId}"`) || !wire.includes('"api":"anthropic-messages"')) {
      const metadata = childEvents.flatMap((event) => {
        const payload = event?.payload;
        return payload && typeof payload === "object" ? [{
          type: event.type,
          provider: payload.provider,
          model: payload.model,
          api: payload.api,
          modelId: payload.modelId,
        }] : [];
      }).filter((entry) => entry.provider || entry.model || entry.api || entry.modelId);
      throw new Error(`child session ${member.role} provider metadata is incomplete: ${JSON.stringify(metadata.slice(-8))}`);
    }
    const header = sessionHeaders.find((entry) => entry.sessionId === childSessionId);
  if (!header || header.parentSessionId !== sessionId) {
    throw new Error(`child session ${member.role} parent binding is incomplete: ${JSON.stringify({ child: digest(childSessionId), expectedParent: digest(sessionId), actualParent: header?.parentSessionId ? digest(header.parentSessionId) : null, cwd: header?.cwd ?? null })}`);
  }
    return {
      role: member.role,
      session: digest(childSessionId),
      parentSession: digest(header.parentSessionId),
      eventTypes: [...new Set(childEvents.map((event) => event.type))],
      eventCount: childEvents.length,
      traceDigest: digest(childEvents.map((event) => `${event.sequence}:${event.type}`).join("\n")),
    };
  });
  const teamTraceDigest = digest(memberEvents.map((event) => `${event.sequence}:${event.type}:${event.payload?.memberId ?? ""}`).join("\n"));
  const teamDeleted = await page.evaluate((teamId) => window.api.invoke("teams:delete", teamId), teamRecord.id);
  if (!teamDeleted) throw new Error("team cleanup failed");

  // === Electron restart persistence of the expert binding ===
  // Closes the real Electron Main process and relaunches it with the same
  // userData and Pi home. Verifies that the expert binding, the full event
  // history and the hidden persona all survive an actual process restart,
  // and that the next turn in the reopened session still injects the persona.
  const beforeRestartEvents = await page.evaluate((id) => window.api.invoke("agent:event-log", { sessionId: id, limit: 2000 }), sessionId);
  const beforeRestartSequenceMax = beforeRestartEvents.reduce((max, event) => Math.max(max, Number(event?.sequence ?? 0)), 0);
  await page.close().catch(() => undefined);
  await app.close();
  app = await electron.launch({ args: [`--user-data-dir=${userData}`, root], executablePath: electronPath, cwd: root, timeout: 30_000, env: childEnv });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      rendererErrors.push(`${message.text()} @ ${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`);
    }
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  const restartSession = await page.evaluate(async ({ sessionId, cwdCandidates }) => {
    for (const cwd of cwdCandidates) {
      const entries = await window.api.invoke("sessions:list", cwd);
      const match = entries.find((entry) => entry.sessionId === sessionId);
      if (match) return match;
    }
    return null;
  }, { sessionId, cwdCandidates: [...new Set([sessionCwd, root, workspace])] });
  if (!restartSession || restartSession.expertId !== "reviewer" || restartSession.expertName !== "专家图审查") {
    throw new Error(`expert binding did not survive Electron restart`);
  }
  await page.evaluate(({ sessionId, cwd }) => window.api.invoke("agent:load-session", { sessionId, cwd }), { sessionId, cwd: restartSession.cwd ?? sessionCwd });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.waitForFunction((id) => {
    try { return JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null")?.sessionId === id; } catch { return false; }
  }, sessionId, { timeout: 30_000 });
  const restartEvents = await page.evaluate((id) => window.api.invoke("agent:event-log", { sessionId: id, limit: 2000 }), sessionId);
  if (!Array.isArray(restartEvents) || restartEvents.length === 0) {
    throw new Error("event log was not persisted across Electron restart");
  }
  const restartSequenceMax = restartEvents.reduce((max, event) => Math.max(max, Number(event?.sequence ?? 0)), 0);
  if (restartSequenceMax < beforeRestartSequenceMax) {
    throw new Error(`event log lost history across Electron restart: before=${beforeRestartSequenceMax} after=${restartSequenceMax}`);
  }
  const restoredInput = restartEvents.find((event) => event.type === "session/input");
  if (!restoredInput || restoredInput.payload?.text?.sha256 !== fullHash(expectedInput)) {
    throw new Error("restored expert session input history is incomplete");
  }
  const restartEvidence = {
    sessionBindingRestored: true,
    beforeSequenceMax: beforeRestartSequenceMax,
    afterSequenceMax: restartSequenceMax,
    restoredInputHashPrefix: fullHash(expectedInput).slice(0, 12),
    restoredPersonaReplyMarker: "EXPERT-GRAPH-REPLY-7314",
    restoredEventDigest: digest(restartEvents.map((event) => `${event.sequence}:${event.type}`).join("\n")),
  };

  const report = {
    schema: "openbuddy.redacted-evidence.v1",
    evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
    ok: true,
    runtime: "electron+pi",
    capability: "expert-graph",
    capabilities: ["expert-graph"],
    graph: {
      nodes: ["expert-catalog:reviewer", "expert-catalog:reviewer-team", "plugin:reviewer", "plugin:reviewer-team", "agent-file:reviewer", "team-member:planner", "team-member:explorer", `pi-session:${digest(sessionId)}`, `team-runtime:${digest(teamRecord.id)}`, ...[...memberSessionIds.values()].map((memberSessionId) => `pi-member-session:${digest(memberSessionId)}`), "provider:custom_anthropic", `electron-restart:app${digest(sessionId)}`],
      edges: ["catalog->plugin", "plugin->agent-file", "team->member:planner", "team->member:explorer", "agent-file->persona", "persona->session-input", "persona->multi-turn-input", "session->provider", "session->expert-binding", "binding->reload", "binding->electron-restart", "team->pi-member-session", "pi-member-session->provider", "pi-member-session->completed"],
    },
    evidence: {
      expertId: "reviewer",
      expertName: "专家图审查",
      expertType: "agent",
      teamMemberCount: linked,
      teamExecution: true,
      standingPreset: {
        id: activePreset.id,
        childCount: presetStarts.length,
        inheritedByAllChildren: true,
        tool: "graph_standing_preset_tool",
        promptMarker: "GRAPH-STANDING-PRESET-ROLE-7314",
      },
      teamIdDigest: digest(teamRecord.id),
      teamStatus: teamStatus.status,
      teamMemberStatuses: teamStatus.members.map((member) => ({ role: member.role, status: member.status, hasOutput: Boolean(member.output) })),
      teamMemberSessionDigests: teamStatus.members.map((member) => ({ role: member.role, session: digest(memberSessionIds.get(member.id)) })),
      memberTraces,
      teamTraceDigest,
      teamTraceEventTypes: [...new Set(memberEvents.map((event) => event.type))],
      agentLinked: true,
      promptDigest: digest(prompt),
      multiTurn: multiTurnEvidence,
      electronRestart: restartEvidence,
      electronRestartPreservedPersona: true,
      sessionDigest: digest(sessionId),
      realConversation: true,
      eventTypes: trace.eventTypes,
      eventCount: trace.eventCount,
      traceDigest: trace.traceDigest,
      rendererReload: true,
      expertBindingRestored: true,
      rendererErrors: rendererErrors.length,
      rendererErrorDigests: rendererErrors.map((error) => digest(safeError(error))),
      filesystem: "not-run-by-policy",
    },
  };
  if (rendererErrors.length > 0) {
    const requests = failedRequests.length ? `; failed requests: ${failedRequests.map(safeError).join(" | ")}` : "";
    throw new Error(`renderer errors detected: ${rendererErrors.map(safeError).join(" | ")}${requests}`);
  }
  if (process.env.OPENBUDDY_EVIDENCE_DIR) {
    mkdirSync(process.env.OPENBUDDY_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.OPENBUDDY_EVIDENCE_DIR, "expert-graph.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  passed = true;
  console.log(JSON.stringify({ ...report, evidenceArtifact: process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "expert-graph.json") : null }));
} catch (error) {
  console.error(`[expert-graph-smoke] ${safeError(error)}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  if (!passed && rendererErrors.length) {
    console.error(`[expert-graph-smoke] renderer-errors=${rendererErrors.map(safeError).join(" | ")}`);
    if (failedRequests.length) console.error(`[expert-graph-smoke] failed-requests=${failedRequests.map(safeError).join(" | ")}`);
  }
}
