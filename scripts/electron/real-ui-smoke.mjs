import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const required = process.env.OPENBUDDY_E2E_REQUIRED === "1";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const baseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";

if (!required || !apiKey || !baseUrl || !modelId) {
  console.error("real-ui-smoke requires OPENBUDDY_E2E_REQUIRED=1 and complete temporary provider credentials");
  process.exit(2);
}

const userData = mkdtempSync(join(tmpdir(), "openbuddy-real-ui-smoke-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

// The extension is loaded by Pi in the real Electron process. It is not a
// provider fixture: the model must request this tool and the result is checked
// through the real Pi event log and the rendered transcript.
const extensionDir = join(piAgentDir, "extensions");
mkdirSync(extensionDir, { recursive: true });
writeFileSync(join(extensionDir, "openbuddy-real-ui-tool.ts"), `import { Type } from "@earendil-works/pi-ai";

export default function (pi) {
  pi.registerTool({
    name: "openbuddy_real_ui_tool",
    label: "OpenBuddy real UI tool",
    description: "Return the exact marker supplied by the user.",
    parameters: Type.Object({ marker: Type.String() }),
    execute: async (_toolCallId, params) => ({
      content: [{ type: "text", text: params.marker }],
      details: { source: "openbuddy-real-ui-smoke" },
    }),
  });
}
`, "utf8");

const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
const {
  OPENBUDDY_E2E_API_KEY: _e2eApiKey,
  OPENBUDDY_E2E_BASE_URL: _e2eBaseUrl,
  OPENBUDDY_E2E_MODEL_ID: _e2eModelId,
  ...inheritedEnv
} = process.env;
const childEnv = {
  ...inheritedEnv,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_FILESYSTEM_SMOKE: "0",
  OPENBUDDY_DEBUG_UI: "0",
};

const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => hash(value).slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .split(apiKey).join("[redacted-api-key]")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .replace(/OPENBUDDY_E2E_API_KEY[^\s]*/g, "OPENBUDDY_E2E_API_KEY=[redacted]")
  .replace(/([?&](?:token|resume|resumeToken|authorization|api[_-]?key)=)[^&\s]*/gi, "$1[redacted]")
  .slice(0, 500);

const isExpectedHarnessDisconnect = (text) => /WebSocket connection to .*\/api\/events\.(?:mux|host)/i.test(text);

let app;
let page;
let startupSurface;
let passed = false;
const rendererErrors = [];
const rendererErrorDigests = [];
let expectedHarnessDisconnects = 0;

function activeSessionFromStorage() {
  return page.evaluate(() => {
    try {
      const value = JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null");
      return value && typeof value.sessionId === "string" ? value : null;
    } catch {
      return null;
    }
  });
}

async function openElectron({ waitForReady = true } = {}) {
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: electronPath,
    cwd: root,
    timeout: 30_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = `console:${message.text()}`;
      if (isExpectedHarnessDisconnect(text)) {
        expectedHarnessDisconnects += 1;
        return;
      }
      rendererErrors.push(text);
      rendererErrorDigests.push(digest(text));
    }
  });
  page.on("pageerror", (error) => {
    const text = `pageerror:${error.message}`;
    rendererErrors.push(text);
    rendererErrorDigests.push(digest(text));
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  startupSurface = await page.evaluate(async () => {
    const debugInfo = await window.api.invoke("debug:info");
    const devtoolsOpened = await window.api.invoke("debug:toggle-devtools");
    const devtoolsClosed = await window.api.invoke("debug:toggle-devtools");
    return {
      apiVersion: window.api?.apiVersion,
      rootNonEmpty: Boolean(document.getElementById("root")?.innerText?.trim()),
      debugInfo: typeof debugInfo?.url === "string" && typeof debugInfo?.webContentsId === "number",
      devtoolsOpened,
      devtoolsClosed,
      debugToolbar: Boolean(document.querySelector("[data-testid=debug-toolbar]")),
    };
  });
  if (startupSurface.apiVersion !== 1 || !startupSurface.rootNonEmpty || !startupSurface.debugInfo
    || startupSurface.devtoolsOpened !== true || startupSurface.devtoolsClosed !== false || startupSurface.debugToolbar) {
    throw new Error(`Electron startup/debug surface failed: ${JSON.stringify(startupSurface)}`);
  }
  if (waitForReady) {
    await page.waitForFunction(() => {
      const textarea = document.querySelector("textarea");
      return textarea && !textarea.disabled;
    }, undefined, { timeout: 90_000 });
  }
}

async function eventLog(sessionId) {
  const events = await page.evaluate((id) => window.api.invoke("agent:event-log", { sessionId: id, limit: 2000 }), sessionId);
  if (!Array.isArray(events)) throw new Error("agent:event-log returned a non-array value");
  return events;
}

async function waitForTrace(sessionId, prompt, marker, cursor, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await eventLog(sessionId);
    const post = latest.filter((event) => event?.sequence > cursor && event?.sessionId === sessionId);
    const input = post.find((event) => event.type === "session/input"
      && (event.payload?.text === prompt || event.payload?.text?.sha256 === hash(prompt)));
    const assistant = post.filter((event) => ["assistant/start", "assistant/update", "assistant/end"].includes(event.type));
    const settled = post.some((event) => event.type === "agent/settled");
    const rendered = await page.locator(".msg--assistant").allTextContents();
    if (input && assistant.length > 0 && settled && rendered.some((text) => text.includes(marker))) {
      return { events: post, allEvents: latest };
    }
    await page.waitForTimeout(500);
  }
  const rendered = await page.locator(".msg--assistant").allTextContents();
  throw new Error(`real UI trace timeout: ${JSON.stringify({
    session: digest(sessionId),
    eventTypes: latest.map((event) => event.type).slice(-30),
    marker,
    rendered: rendered.slice(-5).map((text) => text.slice(0, 500)),
  })}`);
}

async function sendThroughUi(prompt, marker, sessionId) {
  const before = await eventLog(sessionId);
  const cursor = Math.max(0, ...before.map((event) => typeof event?.sequence === "number" ? event.sequence : 0));
  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const textarea = document.querySelector("textarea");
    return textarea && !textarea.disabled;
  }, undefined, { timeout: 90_000 });
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const trace = await waitForTrace(sessionId, prompt, marker, cursor);
  return { cursor, trace };
}

async function sendFirstThroughUi(prompt, marker) {
  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const textarea = document.querySelector("textarea");
    return textarea && !textarea.disabled;
  }, undefined, { timeout: 90_000 });
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => {
    try {
      const value = JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null");
      return typeof value?.sessionId === "string" && value.sessionId.length > 0;
    } catch {
      return false;
    }
  }, undefined, { timeout: 30_000 });
  const active = await activeSessionFromStorage();
  if (!active?.sessionId) throw new Error("UI did not persist the newly created Pi session");
  const trace = await waitForTrace(active.sessionId, prompt, marker, 0);
  return { sessionId: active.sessionId, trace };
}

function assertTrace(trace, { marker, requireTool = false } = {}) {
  const types = trace.events.map((event) => event.type);
  if (!types.includes("session/input") || !types.includes("agent/start") || !types.includes("assistant/update") || !types.includes("assistant/end") || !types.includes("agent/settled")) {
    throw new Error(`incomplete real Pi trace: ${JSON.stringify(types)}`);
  }
  const sequences = trace.events.map((event) => event.sequence).filter((value) => typeof value === "number");
  if (sequences.some((value, index) => index > 0 && value <= sequences[index - 1])) throw new Error("Pi event sequence is not strictly increasing");
  const assistant = trace.events.find((event) => event.type === "assistant/start")?.payload?.message
    ?? trace.events.find((event) => event.type === "assistant/end")?.payload?.message;
  const assistantWire = trace.events
    .filter((event) => ["assistant/start", "assistant/update", "assistant/end"].includes(event.type))
    .map((event) => JSON.stringify(event.payload ?? event))
    .join("\n");
  if ((assistant?.provider !== "custom_anthropic" && !assistantWire.includes('"provider":"custom_anthropic"'))
    || (assistant?.model !== modelId && !assistantWire.includes(`"model":"${modelId}"`))
    || (assistant?.api !== "anthropic-messages" && !assistantWire.includes('"api":"anthropic-messages"'))) {
    throw new Error(`missing real provider metadata: ${JSON.stringify({ provider: assistant?.provider, model: assistant?.model, api: assistant?.api })}`);
  }
  if (marker && !trace.events.some((event) => JSON.stringify(event.payload ?? event).includes(marker))) {
    throw new Error(`real Pi event log did not contain assistant marker: ${marker}`);
  }
  if (requireTool) {
    const starts = trace.events.filter((event) => event.type === "tool/start" && event.payload?.toolName === "openbuddy_real_ui_tool");
    const ends = trace.events.filter((event) => event.type === "tool/end" && event.payload?.toolName === "openbuddy_real_ui_tool");
    if (starts.length !== 1 || ends.length !== 1) throw new Error(`real Pi tool trace incomplete: ${JSON.stringify({ starts: starts.length, ends: ends.length })}`);
  }
}

try {
  await openElectron({ waitForReady: false });

  // Configure provider and model through the actual Settings UI.
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.waitFor({ state: "visible", timeout: 15_000 });
  await settings.getByRole("button", { name: "添加厂商", exact: true }).click();
  const providerDialog = page.locator(".models-settings-panel__editor-overlay[role=dialog]").last();
  await providerDialog.waitFor({ state: "visible", timeout: 15_000 });
  await providerDialog.locator("select").first().selectOption("custom_anthropic");
  await providerDialog.locator("input[type=password]").fill(apiKey);
  await providerDialog.locator('input[placeholder="https://api.example.com/v1"]').fill(baseUrl);
  if (await providerDialog.locator("select").nth(1).inputValue() !== "messages") throw new Error("custom Anthropic protocol was not locked to messages");
  if (await providerDialog.locator("select").nth(2).inputValue() !== "x_api_key") throw new Error("custom Anthropic auth was not locked to x_api_key");
  await providerDialog.getByRole("button", { name: "保存", exact: true }).click();
  await providerDialog.waitFor({ state: "hidden", timeout: 20_000 });

  const detail = page.locator(".models-settings-panel__provider-detail");
  await detail.getByRole("button", { name: "手动添加", exact: true }).click();
  const modelDialog = page.locator(".models-settings-panel__editor-overlay[role=dialog]").last();
  await modelDialog.waitFor({ state: "visible", timeout: 15_000 });
  await modelDialog.locator("input").first().fill(modelId);
  await modelDialog.getByRole("button", { name: "保存", exact: true }).click();
  await modelDialog.waitFor({ state: "hidden", timeout: 20_000 });
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();

  await page.waitForFunction((expected) => document.body.innerText.includes(expected), modelId, { timeout: 30_000 });
  const configuredCatalog = await page.evaluate(async () => ({
    providers: await window.api.invoke("agent:providers-list"),
    auth: await window.api.invoke("agent:auth-status"),
  }));
  const configuredCatalogText = JSON.stringify(configuredCatalog);
  if (!configuredCatalog.providers?.providers?.some((entry) => entry.id === "custom_anthropic")
    || !configuredCatalog.providers?.models?.some((entry) => entry.providerId === "custom_anthropic" && entry.modelId === modelId)
    || configuredCatalog.auth?.ready !== true
    || configuredCatalogText.includes(apiKey)) {
    throw new Error(`Settings UI did not persist a redacted custom provider/model: ${JSON.stringify({
      providerCount: configuredCatalog.providers?.providers?.length,
      modelCount: configuredCatalog.providers?.models?.length,
      ready: configuredCatalog.auth?.ready,
      keyEchoed: configuredCatalogText.includes(apiKey),
    })}`);
  }
  const modelPicker = page.locator(".model-selector__trigger").first();
  await modelPicker.waitFor({ state: "visible", timeout: 15_000 });
  await modelPicker.click();
  await page.locator(".model-selector__item").filter({ hasText: modelId }).first().click();
  if (!(await modelPicker.innerText()).includes(modelId)) throw new Error("UI model selection did not update the Composer picker");
  const composer = page.locator("textarea.wb-composer__input").first();
  const pasteText = "真实 Electron 粘贴第一行\n真实 Electron 粘贴第二行 🚀\nEND-REAL-UI-PASTE";
  await page.evaluate((text) => window.api.invoke("clipboard:write-text", text), pasteText);
  await composer.fill("");
  await composer.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await page.waitForFunction((expected) => document.querySelector("textarea")?.value === expected, pasteText, { timeout: 15_000 });
  if (await composer.inputValue() !== pasteText) throw new Error("real Electron system clipboard paste did not preserve Unicode/multiline text");
  await composer.fill("");

  const first = await sendFirstThroughUi("记住校验词 REAL-UI-CONTEXT-7314，只回复 REAL-UI-TURN-1。", "REAL-UI-TURN-1");
  const sessionId = first.sessionId;
  assertTrace(first.trace, { marker: "REAL-UI-TURN-1" });
  const second = await sendThroughUi("不要重新询问，基于同一个 Pi session 只回复你刚才记住的校验词。", "REAL-UI-CONTEXT-7314", sessionId);
  assertTrace(second.trace, { marker: "REAL-UI-CONTEXT-7314" });
  const third = await sendThroughUi("必须调用 openbuddy_real_ui_tool，参数 marker 填 REAL-UI-TOOL-3；工具返回后只回复 REAL-UI-TOOL-3。", "REAL-UI-TOOL-3", sessionId);
  assertTrace(third.trace, { marker: "REAL-UI-TOOL-3", requireTool: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  await page.getByText("REAL-UI-CONTEXT-7314", { exact: false }).first().waitFor({ state: "visible", timeout: 90_000 });
  const afterReload = await activeSessionFromStorage();
  if (afterReload?.sessionId !== sessionId) throw new Error("renderer reload changed the active Pi session");
  const fourth = await sendThroughUi("reload 后继续同一个 Pi session，只回复 REAL-UI-TURN-4。", "REAL-UI-TURN-4", sessionId);
  assertTrace(fourth.trace, { marker: "REAL-UI-TURN-4" });

  await app.close();
  app = null;
  await openElectron();
  await page.getByText("REAL-UI-TURN-4", { exact: false }).first().waitFor({ state: "visible", timeout: 90_000 });
  const afterRestart = await activeSessionFromStorage();
  if (afterRestart?.sessionId !== sessionId) throw new Error("Electron restart changed the active Pi session");
  if (!(await page.locator("body").innerText()).includes(modelId)) throw new Error("provider/model did not persist across Electron restart");
  const persisted = await page.evaluate(async () => ({
    model: await window.api.invoke("agent:current-model"),
    providers: await window.api.invoke("agent:providers-list"),
    auth: await window.api.invoke("agent:auth-status"),
  }));
  if (persisted.model?.provider !== "custom_anthropic" || persisted.model?.id !== modelId
    || !persisted.providers?.models?.some((entry) => entry.providerId === "custom_anthropic" && entry.modelId === modelId)
    || persisted.auth?.ready !== true) {
    throw new Error(`provider/model/auth did not persist across Electron restart: ${JSON.stringify({
      provider: persisted.model?.provider,
      model: persisted.model?.id,
      modelCount: persisted.providers?.models?.length,
      ready: persisted.auth?.ready,
    })}`);
  }
  const fifth = await sendThroughUi("Electron 重启后继续同一个 Pi session，只回复 REAL-UI-TURN-5。", "REAL-UI-TURN-5", sessionId);
  assertTrace(fifth.trace, { marker: "REAL-UI-TURN-5" });

  const finalEvents = await eventLog(sessionId);
  const allTypes = finalEvents.map((event) => event.type);
  if (!allTypes.includes("session/input") || !allTypes.includes("assistant/update") || !allTypes.includes("assistant/end") || !allTypes.includes("agent/settled")) {
    throw new Error(`final event log is incomplete: ${JSON.stringify(allTypes.slice(-40))}`);
  }
  passed = true;
  const report = {
    schema: "openbuddy.redacted-evidence.v1",
    evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
    ok: true,
    runtime: "electron+pi",
    capabilities: ["startup-bridge", "debug-surface", "multiturn-trace", "provider-model-crud", "persistence-restart"],
    evidence: {
      provider: "custom_anthropic",
      model: modelId,
      api: "anthropic-messages",
      session: digest(sessionId),
      turns: 5,
      tool: "openbuddy_real_ui_tool",
      rendererReload: true,
      electronRestart: true,
      eventCount: finalEvents.length,
      rendererErrors: rendererErrors.length,
      rendererErrorDigests,
      rendererErrorMessages: rendererErrors.map(safeError),
      expectedHarnessDisconnects,
      startupSurface,
      filesystem: "not-run-by-policy",
    },
  };
  if (process.env.OPENBUDDY_EVIDENCE_DIR) {
    mkdirSync(process.env.OPENBUDDY_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.OPENBUDDY_EVIDENCE_DIR, "real-ui-smoke.json"), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ ...report, evidenceArtifact: process.env.OPENBUDDY_EVIDENCE_DIR ? join(process.env.OPENBUDDY_EVIDENCE_DIR, "real-ui-smoke.json") : null }));
} catch (error) {
  console.error(`[real-ui-smoke] ${safeError(error)}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  if (!passed && rendererErrors.length > 0) console.error(`[real-ui-smoke] renderer-errors=${rendererErrors.map(safeError).join(" | ")}`);
}
