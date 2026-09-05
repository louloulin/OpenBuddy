import { _electron as electron } from "playwright";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-harness-smoke-"));
const piAgentDir = join(userData, "pi-agent");
const profileDir = join(piAgentDir, "profiles", "desktop");
const extensionPath = join(userData, "harness-smoke-extension.mjs");
const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
let app;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    Promise.resolve(promise).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function socketQueue(socket) {
  const values = [];
  const waiters = [];
  const onMessage = (data) => {
    const value = JSON.parse(String(data));
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else values.push(value);
  };
  socket.on("message", onMessage);
  return {
    next(predicate, label) {
      const existing = values.findIndex(predicate);
      if (existing >= 0) return Promise.resolve(values.splice(existing, 1)[0]);
      return withTimeout(new Promise((resolve) => waiters.push((value) => {
        if (predicate(value)) resolve(value);
        else values.push(value);
      })), 5_000, label);
    },
    dispose() {
      socket.off("message", onMessage);
    },
  };
}

async function openSocket(url, label) {
  const socket = new WebSocket(url);
  await withTimeout(new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  }), 5_000, `${label} open`);
  return { socket, queue: socketQueue(socket) };
}

async function closeSocket(connection) {
  connection?.queue.dispose();
  if (!connection?.socket || connection.socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    connection.socket.once("close", resolve);
    connection.socket.close();
  });
}

async function launchElectron() {
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: electronPath,
    cwd: root,
    timeout: 10_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      PI_CODING_AGENT_DIR: piAgentDir,
      OPENBUDDY_DEBUG_UI: "0",
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });
  const window = await withTimeout(app.firstWindow(), 10_000, "first window");
  await window.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  await window.locator("#root").waitFor({ state: "attached", timeout: 10_000 });
  return window;
}

async function run() {
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(extensionPath, `export default function (pi) {
  pi.registerCommand("harness-smoke-command", {
    description: "OpenBuddy Harness smoke command",
    handler: async () => undefined,
  });
}
`, "utf8");
  writeFileSync(join(profileDir, "package.json"), `${JSON.stringify({
    name: "openbuddy-profile-harness-smoke",
    private: true,
    openbuddy: { profile: { bundles: [], piExtensions: [{ id: "harness-smoke-extension", source: extensionPath }] } },
    dsh: { profile: { bundles: [], piExtensions: [{ id: "harness-smoke-extension", source: extensionPath }] } },
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(profileDir, "cordis.patch.yml"), "[]\n", "utf8");
  mkdirSync(piAgentDir, { recursive: true });

  const fixtureCwd = root;
  const fixtureTimestamp = new Date().toISOString();
  const parentId = "01a04373-374a-796c-bdbb-ecd1d67056ee";
  const childId = "01a04373-374a-796c-bdbb-ecd1d67056ef";
  const grandchildId = "01a04373-374a-796c-bdbb-ecd1d67056f0";
  const parentPath = join(piAgentDir, `${fixtureTimestamp.replace(/[:.]/g, "-")}_${parentId}.jsonl`);
  const childPath = join(piAgentDir, `${fixtureTimestamp.replace(/[:.]/g, "-")}_${childId}.jsonl`);
  const grandchildPath = join(piAgentDir, `${fixtureTimestamp.replace(/[:.]/g, "-")}_${grandchildId}.jsonl`);
  const sessionFile = (id, name, parentSession) => [
    { type: "session", version: 3, id, timestamp: fixtureTimestamp, cwd: fixtureCwd, ...(parentSession ? { parentSession } : {}) },
    { type: "session_info", id: `${id}-info`, parentId: null, timestamp: fixtureTimestamp, name },
    { type: "message", id: `${id}-message`, parentId: `${id}-info`, timestamp: fixtureTimestamp, message: { role: "assistant", content: [{ type: "text", text: `${name} fixture history` }], timestamp: Date.now() } },
  ];
  writeFileSync(parentPath, `${sessionFile(parentId, "Harness Parent", undefined).map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  writeFileSync(childPath, `${sessionFile(childId, "Harness One Shot", parentPath).map((entry) => JSON.stringify(entry)).join("\n")}\n${JSON.stringify({ type: "custom", customType: "openbuddy/subagent", id: `${childId}-marker`, parentId: `${childId}-message`, timestamp: fixtureTimestamp, data: { mode: "one-shot", role: "Harness One Shot" } })}\n`, "utf8");
  writeFileSync(grandchildPath, `${sessionFile(grandchildId, "Harness Nested", childPath).map((entry) => JSON.stringify(entry)).join("\n")}\n${JSON.stringify({ type: "custom", customType: "openbuddy/subagent", id: `${grandchildId}-marker`, parentId: `${grandchildId}-message`, timestamp: fixtureTimestamp, data: { mode: "continuable", role: "Harness Nested" } })}\n`, "utf8");

  const window = await launchElectron();

  const init = await window.evaluate(() => window.api.invoke("agent:init"));
  if (init?.ok !== true) throw new Error(`agent:init failed: ${JSON.stringify(init)}`);
  const fixtureSessions = await window.evaluate((cwd) => window.api.invoke("sessions:list", cwd), fixtureCwd);
  if (!fixtureSessions.some((entry) => entry.sessionId === parentId)) {
    throw new Error(`Pi parent fixture was not discovered: ${JSON.stringify(fixtureSessions)}`);
  }
  await window.locator(".sidebar__conv", { hasText: "Harness Parent" }).click();
  await window.locator("button[title='子代理运行时']").waitFor({ state: "visible", timeout: 10_000 });
  const shareToggle = window.locator("button[title='导出 / 分享本会话']");
  if (await shareToggle.count() > 0 && (await shareToggle.getAttribute("class"))?.includes("--active")) {
    await shareToggle.evaluate((button) => button.click());
  }
  await window.locator("button[title='子代理运行时']").evaluate((button) => button.click());
  const subagentPanel = window.locator(".subagent-panel");
  try {
    await subagentPanel.getByRole("button", { name: "Harness One Shot" }).waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const debugText = await window.locator("body").innerText();
    throw new Error(`Harness subagent catalog did not render: ${String(error)}\nbody=${debugText}`);
  }
  await subagentPanel.getByRole("button", { name: "Harness One Shot" }).click();
  try {
    await window.locator(".subagent-readonly-banner").waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const debugText = await window.locator("body").innerText();
    const debugSessions = await window.evaluate((cwd) => window.api.invoke("sessions:list", cwd), fixtureCwd);
    throw new Error(`One-shot route did not become read-only: ${String(error)}\nbody=${debugText}\nsessions=${JSON.stringify(debugSessions)}`);
  }
  if (!(await window.locator("textarea").first().isDisabled())) throw new Error("One-shot subagent composer is not read-only");
  await subagentPanel.getByRole("button", { name: "Harness Nested" }).waitFor({ state: "visible", timeout: 10_000 });
  await subagentPanel.getByRole("button", { name: "Harness Nested" }).click();
  const breadcrumb = window.getByRole("navigation", { name: "子代理路径" });
  await breadcrumb.waitFor({ state: "visible", timeout: 10_000 });
  if (!(await breadcrumb.innerText()).includes("Harness One Shot")) {
    throw new Error("Nested subagent breadcrumb did not retain its parent");
  }
  const address = await window.evaluate(() => window.api.invoke("harness:address"));
  if (!address?.baseUrl || !address.token) throw new Error(`harness:address missing: ${JSON.stringify(address)}`);

  const httpResponse = await fetch(`${address.baseUrl}/api/host.describe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${address.token}` },
    body: JSON.stringify({ type: "client-request", rpcId: "short-host-describe", method: "host.describe", payload: {} }),
  });
  const httpRpc = await httpResponse.json();
  if (httpRpc.rpcId !== "short-host-describe" || httpRpc.result?.ok !== true || httpRpc.result.value?.runtime !== "pi") {
    throw new Error(`Harness host.describe failed: ${JSON.stringify(httpRpc)}`);
  }

  const catalogResponse = await fetch(`${address.baseUrl}/api/typert.catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${address.token}` },
    body: JSON.stringify({ type: "client-request", rpcId: "short-typert-catalog", method: "typert.catalog", payload: {} }),
  });
  const catalogRpc = await catalogResponse.json();
  if (catalogRpc.rpcId !== "short-typert-catalog" || catalogRpc.result?.ok !== true
    || !Array.isArray(catalogRpc.result.value?.packages) || !Array.isArray(catalogRpc.result.value?.diagnostics)) {
    throw new Error(`Harness Typert catalog failed: ${JSON.stringify(catalogRpc)}`);
  }

  const mux = await openSocket(`${address.baseUrl.replace(/^http/, "ws")}/api/events.mux?token=${encodeURIComponent(address.token)}`, "mux");
  const host = await openSocket(`${address.baseUrl.replace(/^http/, "ws")}/api/events.host?token=${encodeURIComponent(address.token)}`, "host");
  await mux.queue.next((message) => message.payload?.type === "session/subscribed", "mux subscription");

  const reloadResponse = await fetch(`${address.baseUrl}/api/pi.extensions.reload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${address.token}` },
    body: JSON.stringify({ type: "client-request", rpcId: "short-pi-reload", method: "pi.extensions.reload", payload: {} }),
  });
  const reloadRpc = await reloadResponse.json();
  const extension = reloadRpc.result?.value?.extensions?.find((entry) => entry.id === "harness-smoke-extension");
  if (reloadRpc.rpcId !== "short-pi-reload" || reloadRpc.result?.ok !== true || extension?.state !== "loaded") {
    throw new Error(`Harness Pi reload failed: ${JSON.stringify(reloadRpc)}`);
  }
  const liveHostEvent = await host.queue.next(
    (message) => (message.payload?.type === "host/plugin-event" || message.payload?.type === "host/remote-event")
      && message.payload?.event === "pi/extensions-reloaded",
    "host reload event",
  );
  if (liveHostEvent.payload.event !== "pi/extensions-reloaded") throw new Error("Missing live host reload event");
  if (!Number.isSafeInteger(liveHostEvent.sequence) || liveHostEvent.sequence < 1) {
    throw new Error(`Harness reload event did not carry a durable sequence: ${JSON.stringify(liveHostEvent)}`);
  }
  const replaySince = liveHostEvent.sequence - 1;

  await closeSocket(mux);
  await closeSocket(host);
  await delay(300);
  const fallback = await window.evaluate(() => new Promise(async (resolve, reject) => {
    let timer;
    const unlisten = window.api.events.on("openbuddy://plugin-event", (event) => {
      if (event?.type !== "pi/extensions-reloaded") return;
      clearTimeout(timer);
      unlisten();
      resolve({ eventType: event.type });
    });
    timer = setTimeout(() => {
      unlisten();
      reject(new Error("IPC fallback did not receive pi/extensions-reloaded"));
    }, 5_000);
    try {
      const result = await window.api.invoke("agent:extensions-reload");
      if (!result.some((entry) => entry.id === "harness-smoke-extension" && entry.state === "loaded")) {
        throw new Error(`IPC reload returned an unexpected extension state: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      clearTimeout(timer);
      unlisten();
      reject(error);
    }
  }));
  if (fallback.eventType !== "pi/extensions-reloaded") throw new Error(`IPC reload fallback failed: ${JSON.stringify(fallback)}`);

  await closeSocket(mux);
  await closeSocket(host);
  await app.close();
  app = undefined;
  const restartedWindow = await launchElectron();
  const restartedInit = await restartedWindow.evaluate(() => window.api.invoke("agent:init"));
  if (restartedInit?.ok !== true) throw new Error(`agent:init after Electron restart failed: ${JSON.stringify(restartedInit)}`);
  const restartedAddress = await restartedWindow.evaluate(() => window.api.invoke("harness:address"));
  if (!restartedAddress?.baseUrl || restartedAddress.token !== address.token) {
    throw new Error(`Harness identity changed across Electron restart: ${JSON.stringify({ first: address, restarted: restartedAddress })}`);
  }
  const replayedHost = await openSocket(
    `${restartedAddress.baseUrl.replace(/^http/, "ws")}/api/events.host?since=${encodeURIComponent(String(replaySince))}&token=${encodeURIComponent(restartedAddress.token)}`,
    "restarted host",
  );
  const replayedEvent = await replayedHost.queue.next(
    (message) => message.payload?.type === "host/plugin-event" && message.payload?.event === "pi/extensions-reloaded",
    "replayed host reload event",
  );
  if (replayedEvent.payload.event !== "pi/extensions-reloaded") throw new Error("Missing replayed host reload event after Electron restart");
  await closeSocket(replayedHost);

  console.log(JSON.stringify({
    ok: true,
    runtime: "pi",
    ui: { subagentCatalog: true, oneShotReadonly: true, nestedBreadcrumb: true },
    harness: { http: true, catalog: true, mux: true, host: true, reload: true, disconnectFallback: true, restartReplay: true },
    extension: { id: extension.id, state: extension.state, managed: extension.managed },
  }));
}

let passed = false;
try {
  await withTimeout(run(), 45_000, "short Electron Harness smoke");
  passed = true;
} finally {
  await Promise.race([app?.close?.(), delay(3_000)]).catch(() => undefined);
  rmSync(userData, { recursive: true, force: true });
}
if (!passed) process.exitCode = 1;
