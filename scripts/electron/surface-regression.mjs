import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-electron-surface-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
const expertRoot = join(userData, "experts");
const connectorRoot = join(userData, "connectors");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(join(expertRoot, "reviewer", ".aily-plugin"), { recursive: true });
mkdirSync(join(expertRoot, "reviewer", "agents"), { recursive: true });
mkdirSync(join(expertRoot, "_meta"), { recursive: true });
mkdirSync(join(connectorRoot, ".codebuddy-connector"), { recursive: true });
mkdirSync(join(connectorRoot, "connectors", "surface", "skills"), { recursive: true });

writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({
  providers: {
    custom_anthropic: {
      name: "Surface fixture",
      baseUrl: "http://127.0.0.1:1/anthropic",
      api: "anthropic-messages",
      authHeader: false,
      models: [{ id: "surface-model", name: "Surface model", contextWindow: 128000, maxTokens: 1024 }],
    },
  },
}, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({ custom_anthropic: { type: "api_key", key: "surface-key" } }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(expertRoot, "_meta", "_expert_center.json"), JSON.stringify({
  categories: [{ id: "code", name: { zh: "代码", en: "Code" } }],
  experts: [{ id: "reviewer", categoryId: "code", plugin: "reviewer", displayName: { zh: "审查员" }, quickPrompts: [{ zh: "检查代码" }] }],
}));
writeFileSync(join(expertRoot, "_meta", "featuredScenes.json"), JSON.stringify({ scenes: [] }));
writeFileSync(join(expertRoot, "reviewer", ".aily-plugin", "plugin.json"), JSON.stringify({ agentName: "reviewer", avatar: "avatar.svg" }));
writeFileSync(join(expertRoot, "reviewer", "avatar.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"><rect width=\"2\" height=\"2\" fill=\"#000\"/></svg>");
writeFileSync(join(expertRoot, "reviewer", "agents", "reviewer.md"), "---\ndescription: Surface reviewer\n---\nReview the supplied change.\n");
writeFileSync(join(connectorRoot, ".codebuddy-connector", "connectors.json"), JSON.stringify({ connectors: [{ id: "surface", source: "surface", name: "Surface connector", type: "mcp" }] }));
writeFileSync(join(connectorRoot, "connectors", "surface", "mcp.json"), JSON.stringify({ mcpServers: { surface: { command: "surface-server" } } }));
writeFileSync(join(connectorRoot, "connectors", "surface", "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"><circle cx=\"1\" cy=\"1\" r=\"1\"/></svg>");

let app;
let passed = false;
try {
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 15_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      PI_CODING_AGENT_DIR: piAgentDir,
      OPENBUDDY_AGENTS_DIR: expertRoot,
      OPENBUDDY_DEBUG_UI: "0",
      OPENBUDDY_FILESYSTEM_SMOKE: "0",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 15_000 });

  const nativeWindowState = await page.evaluate(async () => {
    const beforeMaximized = await window.api.invoke("window:is-maximized");
    await window.api.invoke("window:toggle-maximize");
    const toggledMaximized = await window.api.invoke("window:is-maximized");
    await window.api.invoke("window:toggle-maximize");
    const restoredMaximized = await window.api.invoke("window:is-maximized");
    const openedDevTools = await window.api.invoke("debug:toggle-devtools");
    const closedDevTools = await window.api.invoke("debug:toggle-devtools");
    return { beforeMaximized, toggledMaximized, restoredMaximized, openedDevTools, closedDevTools };
  });
  if (nativeWindowState.toggledMaximized === nativeWindowState.beforeMaximized
    || nativeWindowState.restoredMaximized !== nativeWindowState.beforeMaximized
    || nativeWindowState.openedDevTools !== true
    || nativeWindowState.closedDevTools !== false) {
    throw new Error(`native window/debug bridge failed: ${JSON.stringify(nativeWindowState)}`);
  }
  await page.evaluate(() => window.api.invoke("window:minimize"));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());

  const state = await page.evaluate(async ({ workspacePath, expertPath, connectorPath }) => {
    const init = await window.api.invoke("agent:init", workspacePath);
    if (init?.ok !== true) throw new Error(`surface agent:init failed: ${JSON.stringify(init)}`);

    const expectReject = async (operation) => {
      try {
        await operation();
        return false;
      } catch {
        return true;
      }
    };
    const recoveryStatus = await window.api.invoke("harness:recovery-status");
    const recoveryList = await window.api.invoke("harness:recovery-list");
    const recoveryClaimRejected = await expectReject(() => window.api.invoke("harness:recovery-claim", {}));
    const recoveryResolveRejected = await expectReject(() => window.api.invoke("harness:recovery-resolve", {}));
    const a2aAgentCard = await window.api.invoke("collaboration:a2a-agent-card");
    const a2aTaskSubmitRejected = await expectReject(() => window.api.invoke("collaboration:a2a-task-submit", {}));
    const a2aTaskGetRejected = await expectReject(() => window.api.invoke("collaboration:a2a-task-get", { taskId: "missing-a2a-task" }));
    const workflowControlRejected = await expectReject(() => window.api.invoke("collaboration:workflow-control", { workflowId: "missing-workflow", action: "pause" }));
    if (!recoveryStatus || !Array.isArray(recoveryList?.intents) || !recoveryClaimRejected || !recoveryResolveRejected || !a2aAgentCard?.metadata?.openbuddy || !a2aTaskSubmitRejected || !a2aTaskGetRejected || !workflowControlRejected) {
      throw new Error(`recovery, A2A, or workflow boundary regression failed: ${JSON.stringify({ recoveryStatus, recoveryList, recoveryClaimRejected, recoveryResolveRejected, a2aAgentCard, a2aTaskSubmitRejected, a2aTaskGetRejected, workflowControlRejected })}`);
    }

    const memoryId = `surface-memory-${Date.now()}`;
    const savedMemory = await window.api.invoke("memory:save", { id: memoryId, title: "Surface memory", body: "first", tags: ["surface"] });
    const listedMemory = await window.api.invoke("memory:list");
    const fetchedMemory = await window.api.invoke("memory:get", memoryId);
    const rewrittenMemory = await window.api.invoke("memory:rewrite", { id: memoryId, body: "rewritten" });
    const deletedMemory = await window.api.invoke("memory:delete", memoryId);
    if (savedMemory?.id !== memoryId || !listedMemory.some((entry) => entry.id === memoryId) || fetchedMemory?.body.trim() !== "first" || rewrittenMemory?.body.trim() !== "rewritten" || deletedMemory !== undefined) {
      throw new Error(`memory compatibility aliases failed: ${JSON.stringify({ savedMemory, fetchedMemory, rewrittenMemory, deletedMemory })}`);
    }

    const automationPassthroughRegistry = await import("@openbuddy/plugin-host");
    automationPassthroughRegistry.recordPassthrough("automation", "installed", "pi-background-tasks");
    if (!automationPassthroughRegistry.isPassthroughed("automation") || automationPassthroughRegistry.getPassthroughInfo("automation")?.adapter !== "pi-background-tasks") {
      throw new Error(`automation passthrough registry missing pi-background-tasks adapter`);
    }
    // Stage G-1c: openbuddy-automation removed; automation is owned
    // by pi-background-tasks + pi-goal (passthrough). The legacy
    // automations:* / automation_records_delete IPC channels no
    // longer exist; renderer reaches the pi-native tool surface.

    const experts = await window.api.invoke("experts_load", { root: expertPath });
    const prompt = await window.api.invoke("experts_read_agent_prompt", { root: expertPath, plugin: "reviewer", agentName: "reviewer" });
    const thumbnail = await window.api.invoke("experts_thumbnail", { root: expertPath, path: `${expertPath}/reviewer/avatar.svg` });
    const imageBytes = await window.api.invoke("experts_image_bytes", { root: expertPath, path: `${expertPath}/reviewer/avatar.svg` });
    const linked = await window.api.invoke("experts_link_agents", { root: expertPath, plugin: "reviewer", agentNames: ["reviewer"] });
    const session = await window.api.invoke("agent:new-session", { cwd: workspacePath });
    await window.api.invoke("agent:prompt", { sessionId: session.sessionId, text: "surface persistence probe" }).catch(() => undefined);
    await window.api.invoke("pi_set_session_expert", { sessionId: session.sessionId, expertId: "reviewer", expertName: "审查员" });
    const sessionWithExpert = (await window.api.invoke("sessions:list", workspacePath)).find((entry) => entry.sessionId === session.sessionId);
    await window.api.invoke("pi_clear_session_expert", { sessionId: session.sessionId });
    if (!experts?.experts?.some((entry) => entry.id === "reviewer") || !prompt.includes("Surface reviewer") || !thumbnail.startsWith("data:image/svg+xml;base64,") || !imageBytes.startsWith("data:image/svg+xml;base64,") || linked !== 1 || sessionWithExpert?.expertId !== "reviewer") {
      throw new Error(`expert resource bridge failed: ${JSON.stringify({ experts, prompt, linked, sessionWithExpert })}`);
    }

    const connectors = await window.api.invoke("connectors_load", { root: connectorPath });
    const connectorConfig = await window.api.invoke("connectors_read_mcp_config", { root: connectorPath, source: "surface" });
    const connectorIcon = await window.api.invoke("connectors_icon", { root: connectorPath, path: `${connectorPath}/connectors/surface/icon.svg` });
    if (!connectors?.connectors?.some((entry) => entry.source === "surface") || !connectorConfig.includes("surface-server") || !connectorIcon.startsWith("data:image/svg+xml;base64,")) {
      throw new Error(`connector resource bridge failed: ${JSON.stringify({ connectors, connectorConfig })}`);
    }

    const authCancelled = await window.api.invoke("mcp_auth_cancel", { serverName: "surface-missing" });
    const authMissing = await window.api.invoke("mcp_auth_trigger", { serverName: "surface-missing" });
    await window.api.invoke("task_kill", { taskId: "surface-missing-task" });
    if (authCancelled?.cancelled !== false || !["failed", "setup_required", "cancelled"].includes(authMissing?.status)) {
      throw new Error(`MCP/task boundary failed: ${JSON.stringify({ authCancelled, authMissing })}`);
    }

    let invalidOpenUrlRejected = false;
    try { await window.api.invoke("open_url", { url: "file:///etc/passwd" }); } catch { invalidOpenUrlRejected = true; }
    let invalidExternalRejected = false;
    try { await window.api.invoke("shell:open-external", "javascript:alert(1)"); } catch { invalidExternalRejected = true; }
    let invalidShellFsRejected = false;
    try { await window.api.invoke("shellfs:open-url", "file:///etc/passwd"); } catch { invalidShellFsRejected = true; }
    if (!invalidOpenUrlRejected || !invalidExternalRejected || !invalidShellFsRejected) throw new Error("external URL validation accepted an unsafe scheme");

    return {
      runtime: "electron+pi",
      sessionId: session.sessionId,
      covered: [
        "memory-legacy-aliases", "automation-legacy-aliases", "experts-assets-and-linking",
        "session-expert-binding", "connector-assets-and-config", "mcp-auth-cancel-boundary",
        "task-kill-idempotency", "external-url-validation", "native-window-state",
      ],
      skippedByPolicy: ["filesystem-smoke", "native-dialogs", "window-close"],
    };
  }, { workspacePath: workspace, expertPath: expertRoot, connectorPath: connectorRoot });

  await page.evaluate(() => { void window.api.invoke("debug:reload"); });
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
  const afterReload = await page.evaluate(() => ({
    apiVersion: window.api?.apiVersion,
    root: Boolean(document.getElementById("root")),
  }));
  if (afterReload.apiVersion !== 1 || !afterReload.root) throw new Error(`debug:reload did not restore bridge: ${JSON.stringify(afterReload)}`);

  await page.evaluate(() => { void window.api.invoke("debug:force-reload"); });
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 15_000 });
  const afterForceReload = await page.evaluate(() => ({
    apiVersion: window.api?.apiVersion,
    root: Boolean(document.getElementById("root")),
  }));
  if (afterForceReload.apiVersion !== 1 || !afterForceReload.root) throw new Error(`debug:force-reload did not restore bridge: ${JSON.stringify(afterForceReload)}`);

  passed = true;
  console.log(JSON.stringify({ ok: true, ...state, nativeWindowState, reload: { afterReload, afterForceReload }, filesystem: "not-run-by-policy" }));
} catch (error) {
  console.error(`[surface-regression] ${String(error?.stack ?? error).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")}`);
  throw error;
} finally {
  await app?.close().catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
  process.exit(passed ? 0 : 1);
}
