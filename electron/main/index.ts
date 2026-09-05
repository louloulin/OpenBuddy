import { EventEmitter } from "node:events";
// PR-D: raise default max-listener threshold so heavy pi-subagents fan-out
// (one listener per child session) does not pollute the run with
// `MaxListenersExceededWarning`. The 12-listener count observed during the
// real-pi E2E suite is a soft footprint of pi-subagents spawning sub-sessions;
// the 64-cap leaves headroom for ~5x growth without making the warning useless.
EventEmitter.defaultMaxListeners = 64;
process.setMaxListeners(64);
/**
 * OpenBuddy Pi — Electron main process entry.
 *
 * Phase 1 (LUM-38): loads the React UI in a frameless BrowserWindow with a custom
 * titlebar drag region, matching the frameless Electron window UX.
 *
 * Phase 2 (LUM-39): boots the Pi SDK in-process via `agentHost.init()` and wires
 * the renderer-facing IPC surface via `registerIpc(getWindow)`. The Pi
 * `AgentSession` lives for the lifetime of the Electron main process.
 *
 * Phase 3 (LUM-40..48): additional 9 Pi extensions + 10 host modules are loaded
 * by extending the `extensions` array passed to `createAgentSession` and adding
 * their IPC handlers in `ipc.ts`.
 *
 * See docs/migration-pi-electron.md.
 */
import { app, BrowserWindow, Menu, shell } from "electron";
import { createMainLogger } from "@openbuddy/logging-main";
import { generateTraceId } from "@openbuddy/logging-shared";

import { existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { installDragRegion } from "./window";
import { dispatchHarnessRpc, registerIpc, bindAgentHost, bindRendererEventEmitterFn } from "./ipc/index";
import { setActiveHarnessServer } from "./harness/harness-server";
import type { HarnessServer } from "./harness/harness-server";
import { createBridgeStatusBroadcaster, notifyBridgeUnavailable } from "./collaboration/send-safe";
import { bootHarnessServer } from "./bootstrap/boot-harness-server";
import { installAppLifecycle } from "./bootstrap/app-lifecycle";
import { casdoorAuth } from "./casdoor/casdoor-auth";
import { initCasdoorSecurity, type CasdoorSecurityController } from "./security/casdoor";
import { perfTraceMark } from "./observability/perf-trace";
import { createMainWindow as buildMainWindow } from "./main-window";
import { installAppMenu } from "./app-menu";

// Heavy module (138 top-level imports including @earendil-works/pi-coding-agent and
// the OpenBuddy Pi SDK) — lazy-loaded inside bootBackgroundServices so module
// evaluation does not sit on the critical path between app.whenReady and
// first-paint. The deferred binding is hoisted here so every callsite
// (processCasdoorProtocol, setStatusListener, activate) reaches it via a single
// reference.
let agentHost!: typeof import("./agent/agent-host").agentHost;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFileAsync = promisify(execFile);

app.setName("OpenBuddy");

let mainLogger: ReturnType<typeof createMainLogger> | null = null;
function ensureMainLogger(): ReturnType<typeof createMainLogger> {
  if (mainLogger) return mainLogger;
  let filePath = "";
  try {
    if (app.isReady()) {
      const logsDir = app.getPath("logs");
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      filePath = logsDir + "/openbuddy.log";
    }
  } catch {
    filePath = "";
  }
  const traceId = generateTraceId();
  mainLogger = createMainLogger({
    filePath,
    serviceName: "openbuddy-main",
    baseContext: { scope: "main", traceId },
  });
  // Emit a startup line so operators (and the chat-resilience smoke test) can
  // confirm the file logger + pino-roll transport are wired correctly.
  mainLogger.info(
    { msg: "main.started", traceId, electronVersion: process.versions.electron ?? null, logsDir: filePath ? filePath.slice(0, filePath.lastIndexOf("/")) : null },
    "openbuddy main started",
  );
  return mainLogger;
}

const developmentUserData = process.env.OPENBUDDY_DEV_USER_DATA?.trim();
if (developmentUserData || process.env.NODE_ENV_ELECTRON_VITE === "development") {
  app.setPath("userData", developmentUserData || join(app.getPath("appData"), "OpenBuddy-dev"));
}

const devRendererUrl = process.env.ELECTRON_RENDERER_URL;
const rendererIndex = join(__dirname, "../../out/renderer/index.html");
const preloadCandidates = [
  join(__dirname, "../preload/index.cjs"),
  join(__dirname, "../preload/index.js"),
];
const preloadPath = preloadCandidates.find((path) => existsSync(path)) ?? preloadCandidates[0];

// Harness HTTP server handle. Owned at module scope so `installAppLifecycle`'s
// `onBeforeQuit` callback can reach the same reference that `bootBackgroundServices`
// writes during boot. Without this declaration, the assignment in
// `bootBackgroundServices` and the read in `onBeforeQuit` both target an
// undeclared identifier, which under ESM strict mode throws
// `ReferenceError: harnessServer is not defined` (the warning users saw at startup).
let mainWindow: BrowserWindow | null = null;
let harnessServer: HarnessServer | null = null;
// Phase 8.3 §40: casdoor protocol + state extracted to security/casdoor.ts.
// The controller owns pendingCasdoorUrls, lastCasdoorScope, lifecycleQueue,
// and registers the macOS open-url handler at module init.
let casdoorController: CasdoorSecurityController | null = null;

// Phase 8.3 §40: wire the casdoor controller at module init so the macOS
// open-url listener is registered before any URLs arrive. The agent-host
// bindings are resolved lazily via callbacks, so this is safe to call
// before agentHost is imported.
casdoorController = initCasdoorSecurity({
  getMainWindow: () => mainWindow,
  syncWorkbenchScope: async (force) => {
    if (!agentHost) return;
    await agentHost.syncWorkbenchScope(force);
  },
  bindCurrentSessionToTenant: () => {
    if (!agentHost) return;
    (agentHost as any).bindCurrentSessionToTenant();
  },
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    for (const argument of commandLine) casdoorController!.handleCasdoorProtocol(argument);
  });
}

async function ensureRendererBuild(): Promise<boolean> {
  if (devRendererUrl || existsSync(rendererIndex) || app.isPackaged || process.env.ELECTRON_SKIP_AUTO_BUILD === "1") {
    return existsSync(rendererIndex) || Boolean(devRendererUrl);
  }

  const projectRoot = join(__dirname, "../..");
  const electronVite = join(projectRoot, "node_modules", ".bin", "electron-vite");
  if (!existsSync(electronVite)) {
    console.error(`[openbuddy-pi] renderer build missing and electron-vite was not found: ${electronVite}`);
    return false;
  }

  console.warn(`[openbuddy-pi] renderer build missing; building before startup: ${rendererIndex}`);
  try {
    await execFileAsync(electronVite, ["build"], {
      cwd: projectRoot,
      env: process.env,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    console.error("[openbuddy-pi] automatic renderer build failed:", error);
    return false;
  }
  return existsSync(rendererIndex);
}

// P3-1: 主窗口工厂抽到 main-window.ts, 这里仅持有 mainWindow 引用并附加 closed 清理
function createMainWindow(): BrowserWindow {
  const win = buildMainWindow({
    preloadPath,
    rendererIndex,
    devRendererUrl,
    perfTraceMark,
    notifyBridgeUnavailable,
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

// P3-1 §42: lifecycle wiring delegated to bootstrap/app-lifecycle.ts.
// The lifecycle module owns app.whenReady / activate / window-all-closed /
// before-quit. Index.ts only owns the wiring details (which callbacks fire
// when each event arrives) and the module-level state those callbacks close
// over (mainWindow, harnessServer, casdoorController).
installAppLifecycle({
  createMainWindow,
  installAppMenu: () => installAppMenu({ getMainWindow: () => mainWindow }),
  registerIpc: () => registerIpc(() => mainWindow),
  onSecondInstance: (commandLine) => {
    for (const argument of commandLine) casdoorController!.handleCasdoorProtocol(argument);
  },
  bridgeBroadcaster: createBridgeStatusBroadcaster(),
  onWindowCreated: () => {
    // ensureMainLogger must run inside whenReady so app.getPath("logs") works
    // and the file logger gets a real path. Calling it at module top would
    // produce mainLogger.filePath === "" (logs go to stderr only).
    ensureMainLogger();
    // casdoorController owns the listener wiring — see security/casdoor.ts.
    // We just init the controller here so the listener registration is the
    // final piece of bootstrap before the first paint fires.
    casdoorController!.setStatusListener();
  },
  bootBackgroundServices,
  onBeforeQuit: () => {
    const server = harnessServer;
    harnessServer = null;
    if (server) {
      setActiveHarnessServer(undefined);
      void server.close().catch((error) => console.error("[openbuddy-harness] server close failed:", error));
    }
  },
});

async function bootBackgroundServices(): Promise<void> {
  perfTraceMark("background-services-spawn");

  // Lazy-import the agent-host module here. This pulls the 138 top-level imports
  // (pi-coding-agent, plugin-host, bundle-base, ...) off the critical path. The
  // variable is hoisted at module top so other references stay valid.
  // P1-04: also bind into ipc/index.ts's lazy Proxy so registerIpc()
  // (which already ran synchronously at app.whenReady time) sees the
  // real module through the Proxy.
  if (!agentHost) {
    const mod = await import("./agent/agent-host");
    agentHost = mod.agentHost;
    bindAgentHost(agentHost);
    bindRendererEventEmitterFn(mod.bindRendererEventEmitter);
  }

  // ensureRendererBuild has a fast-path (existsSync(rendererIndex) → true). When
  // the fast-path is hit, mark it and skip the 180s electron-vite shell. When
  // it's missed, fire the build concurrently with auth/harness/agent-host work
  // so we never block paint on it.
  perfTraceMark("renderer-build-fastpath", { exists: existsSync(rendererIndex), packaged: app.isPackaged, dev: Boolean(devRendererUrl) });
  void ensureRendererBuild().catch((error) => {
    console.error("[openbuddy-pi] automatic renderer build failed:", error);
  });

  perfTraceMark("casdoor-init-start");
  try {
    await casdoorAuth.init();
  } catch (error) {
    console.error("[openbuddy-pi] casdoor init failed:", error);
  }
  perfTraceMark("casdoor-init-end");
  casdoorController!.setLastScope(casdoorController!.casdoorScope());
  casdoorController!.markInitialized();
  // Drain command-line casdoor:// URLs the same way the inline implementation did.
  for (const argument of process.argv) casdoorController!.handleCasdoorProtocol(argument);

  harnessServer = await bootHarnessServer({
    agent: agentHost,
    dispatchRpc: dispatchHarnessRpc as any,
  });

  try {
    await agentHost.init();
  } catch (err) {
    console.error("[openbuddy-pi] agent host init failed:", err);
  }
}

