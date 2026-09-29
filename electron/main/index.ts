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
import { applyDataDirOverride, captureDefaultUserDataPath } from "./data-dir";
import { dispatchHarnessRpc, registerIpc, bindAgentHost, bindRendererEventEmitterFn } from "./ipc/index";
import { setActiveHarnessServer } from "./harness/harness-server";
import type { HarnessServer } from "./harness/harness-server";
import { createBridgeStatusBroadcaster, notifyBridgeUnavailable } from "./collaboration/send-safe";
import { bootHarnessServer } from "./bootstrap/boot-harness-server";
import { installAppLifecycle } from "./bootstrap/app-lifecycle";
import { bootHostCore } from "./host-boot";
import { attachHostCorePermissions } from "./agent/agent-permission-bridge";
import { attachHostCoreSecretStore } from "./agent/agent-secret-store-bridge";
import { attachHostCoreSessionSearch } from "./agent/agent-session-search-bridge";
import { attachHostCoreWorkspace } from "./agent/agent-workspace-bridge";
import { attachHostCoreAudit } from "./agent/agent-audit-bridge";
import { getCrashpadDir, recordMainCrash, startCrashpad } from "./runtime/crashpad";
import { casdoorAuth } from "./casdoor/casdoor-auth";
import { initCasdoorSecurity, type CasdoorSecurityController } from "./security/casdoor";
import { perfTraceMark } from "./observability/perf-trace";
import { createMainWindow as buildMainWindow } from "./main-window";
import { installAppMenu } from "./app-menu";
import { installAutoUpdater, type AutoUpdaterHandle } from "./auto-updater";
import { agentHome, pinPiAgentDirEnv, isPiAgentDirPinnedByUs } from "@openbuddy/storage";

// Heavy module (138 top-level imports including @earendil-works/pi-coding-agent and
// the OpenBuddy Pi SDK) — lazy-loaded inside bootBackgroundServices so module
// evaluation does not sit on the critical path between app.whenReady and
// first-paint. The deferred binding is hoisted here so every callsite
// (processCasdoorProtocol, setStatusListener, activate) reaches it via a single
// reference.
let agentHost!: typeof import("./agent/agent-host").agentHost;

const mainFilename = fileURLToPath(import.meta.url);
const mainDirname = dirname(mainFilename);
const execFileAsync = promisify(execFile);

app.setName("OpenBuddy");

// R95 — 把 agent 根钉进 `PI_CODING_AGENT_DIR`,必须发生在**任何 pi 模块被求值之前**。
//
// 为什么放在模块顶层、`app.whenReady` 之前:pi-coding-agent 的
// `getAgentDir()` 只读环境变量(不看 `createAgentSession({ agentDir })`),而
// 一些扩展在**扩展注册时**就解析自己的目录 —— 等 agent host 懒加载起来再设
// 已经太晚。这里是 main 进程源文件里最早能设的时机:本模块是入口,而且这段
// 代码在 `bootBackgroundServices()` 之前同步执行。
//
// 为什么必须整体做:不设的话 SDK 会解析到 `~/.pi/agent`(实测见
// `@openbuddy/storage` 的 `pinPiAgentDirEnv()` 注释),于是 OpenBuddy 与 pi
// 两个产品互相写对方的数据目录 —— 本机 `~/.pi/agent/agents/Designer.md`
// 停在 2026-09-04 而 `~/.openbuddy/agent/` 每天在写,就是这个分叉。
pinPiAgentDirEnv();

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
    {
      msg: "main.started",
      traceId,
      electronVersion: process.versions.electron ?? null,
      logsDir: filePath ? filePath.slice(0, filePath.lastIndexOf("/")) : null,
      // R95 — 记下 agent 根与它是否由我们钉入。排查"数据写到 ~/.pi/agent"
      // 这类问题时,这一行就能区分"用户显式覆盖"与"我们补的默认值"。
      agentHome: agentHome(),
      piAgentDirPinnedByUs: isPiAgentDirPinnedByUs(),
    },
    "openbuddy main started",
  );
  return mainLogger;
}

// R23 — 数据目录解析顺序(必须在 app ready 之前定下来,之后没人再改它):
//   1. OPENBUDDY_DEV_USER_DATA / dev 构建 → 开发目录(指针文件在开发态不参与,
//      否则跑一次"换目录"就会把开发环境也一起搬走);
//   2. `<appData>/OpenBuddy/data-dir.json` → 用户在设置里选过的目录;
//   3. Electron 默认 userData。
// 指针文件里的目录若不可用(外接盘没插上 / 只读挂载),`applyDataDirOverride`
// 会安静地降级成默认目录,不让应用起不来。
captureDefaultUserDataPath();
const developmentUserData = process.env.OPENBUDDY_DEV_USER_DATA?.trim();
if (developmentUserData || process.env.NODE_ENV_ELECTRON_VITE === "development") {
  app.setPath("userData", developmentUserData || join(app.getPath("appData"), "OpenBuddy-dev"));
} else {
  applyDataDirOverride();
}

// R26 (PI-Desktop借鉴) — PI_OPENBUDDY_DATA_DIR 环境变量强制指定 host-core
// 子进程的 userData 目录,优先级高于现有 dev/指针机制。这条路径供 Rust
// 侧的 `DataDir::resolve()` 直接消费(参考 PI-Desktop
// `crates/host-core/src/process-model.md §3`),把"产品数据"与"开发数据"
// 解耦——CI/沙盒/profile 场景下用同一个二进制换数据目录,不必重启 Electron。
if (process.env.PI_OPENBUDDY_DATA_DIR) {
  app.setPath("userData", process.env.PI_OPENBUDDY_DATA_DIR);
}

// R26 + Phase 3 — Crashpad local-only 与 main 进程未捕获异常落盘。
// 在 userData 落地之后、申请单实例锁之前装上,这样:
//   - Crashpad 的 dump 目录钉在真实数据目录,跨升级不丢;
//   - 即便 startCrashpad 在 app.whenReady 之前抛错,异常处理也已就位。
startCrashpad({ dataDir: app.getPath("userData") });
const MAIN_CRASH_DUMP_DIR = getCrashpadDir() ?? join(app.getPath("userData"), "crash-dumps");

/**
 * 把 main 进程的未捕获异常落盘到 Crashpad 目录后,**不再尝试恢复**:
 * Electron main 是单例,异常逃出这个处理器意味着进程已经在退出通道,
 * 让它干净退出比挣扎式 recovery 更可靠(测试覆盖见
 * `electron/main/runtime/crashpad.test.ts`)。
 *
 * handler 必须保持 `void` —— Electron 的事件循环下一拍会把异常吞掉,
 * 同步抛错只会让日志里再叠一条 uncaughtException,反而掩盖原始信息。
 */
function dumpMainCrash(kind: "uncaughtException" | "unhandledRejection", err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : undefined;
  const stack = err instanceof Error ? err.stack : undefined;
  try {
    recordMainCrash(MAIN_CRASH_DUMP_DIR, { kind, name, message, stack });
  } catch (dumpErr) {
    // 不能让落盘本身把进程再炸一次 —— 用 stderr 兜底。
    // eslint-disable-next-line no-console
    console.error(`[openbuddy-crashpad] failed to persist ${kind} dump:`, dumpErr);
  }
  // eslint-disable-next-line no-console
  console.error(`[openbuddy-crashpad] main ${kind}:`, err);
}

process.on("uncaughtException", (err) => {
  dumpMainCrash("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  dumpMainCrash("unhandledRejection", reason);
});

// R26 — 单实例锁。第二个 OpenBuddy 进程启动时直接退出,避免两个 host-core
// 同时写同一个数据目录造成 SQLite 锁竞争 / 日志交错(参考 PI-Desktop
// `docs/spec/03-runtime/07-process-model.md §3`)。"second-instance" 事件
// 把已经存在的那一个唤醒并聚焦。
const SINGLE_INSTANCE_TAG = "openbuddy-desktop";
const gotSingleInstanceLock = app.requestSingleInstanceLock({
  additionalData: [SINGLE_INSTANCE_TAG],
});
if (!gotSingleInstanceLock) {
  // Another instance owns the userData dir; let it take over and quit
  // cleanly so the user only ever interacts with one window.
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  // The first instance handles this — focus its main window if one exists.
  const all = BrowserWindow.getAllWindows();
  if (all.length > 0) {
    const win = all[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    // No window yet (still booting) — nothing to focus.
  }
});

const devRendererUrl = process.env.ELECTRON_RENDERER_URL;
const rendererIndex = join(mainDirname, "../../dist/renderer/index.html");
const preloadCandidates = [
  join(mainDirname, "../preload/index.cjs"),
  join(mainDirname, "../preload/index.js"),
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
let autoUpdaterHandle: AutoUpdaterHandle | null = null;
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

async function ensureRendererBuild(): Promise<boolean> {
  if (devRendererUrl || existsSync(rendererIndex) || app.isPackaged || process.env.ELECTRON_SKIP_AUTO_BUILD === "1") {
    return existsSync(rendererIndex) || Boolean(devRendererUrl);
  }

  const projectRoot = join(mainDirname, "../..");
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
    // Wire electron-updater (Phase 1 of rb-autoupdater). The handle is kept
    // on a module-level ref so onBeforeQuit can detach the listeners.
    autoUpdaterHandle = installAutoUpdater();
    void autoUpdaterHandle.trigger();
  },
  bootBackgroundServices,
  onBeforeQuit: () => {
    const server = harnessServer;
    harnessServer = null;
    if (server) {
      setActiveHarnessServer(undefined);
      void server.close().catch((error) => console.error("[openbuddy-harness] server close failed:", error));
    }
    autoUpdaterHandle?.stop();
    autoUpdaterHandle = null;
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

  // Phase 0 — bring up the Rust host-core sidecar. Failure here is logged
  // but non-fatal for Phase 0 so the UI still loads while we land Phase 1
  // capability wiring (secrets / permissions / audit). Phase 1 will turn
  // the boot failure into a hard error once the capabilities are live.
  try {
    const { host, handshake } = await bootHostCore({
      onSlowHint: () => console.warn("[openbuddy-boot] host-core boot > 30s"),
      onStalled: () => console.error("[openbuddy-boot] host-core boot > 180s; please restart"),
    });
    perfTraceMark("host-core-ready", { capabilities: handshake.capabilities.length });
    // P2.1 — wire host-core into the permission bridge so 9 调用点
    // (agent-host + 4 ipc/* handlers + hook-permission) 走 host-core IPC,
    // 失败时静默降级到 @openbuddy/auth-permission.
    attachHostCorePermissions(host.inner);
    // P2.1-secrets — wire host-core into the secret-store bridge used by
    // McpAuthStore (pi-resources/shared.ts:mcpAuthStore). host-core 不存在时
    // 桥接器自动 fall back 到 createPlatformSecretStore (keychain / ephemeral)。
    attachHostCoreSecretStore(host.inner);
    // P2.1-session-search — wire host-core into session_search.
    // host-core 不存在时返回空索引,不阻塞 UI。
    attachHostCoreSessionSearch(host.inner);
    // P2.1-workspace — wire host-core into workspace 路径解析/边界检查。
    // host-core 不存在时返回 null,业务层 fallback 到 _host-paths.ts 的 isPathWithin。
    attachHostCoreWorkspace(host.inner);
    // P2.1-audit — wire host-core into audit.jsonl (统一审计日志,
    // 与 casdoor-audit.jsonl 是两条独立审计流)。
    // 失败时 fallback 到 <userData>/audit-fallback.jsonl JSONL append。
    attachHostCoreAudit(host.inner, {
      fallbackPath: join(app.getPath("userData"), "audit-fallback.jsonl"),
    });
  } catch (err) {
    console.error("[openbuddy-boot] host-core boot failed:", err);
  }
}
