import { app, BrowserWindow, crashReporter, dialog, nativeImage, nativeTheme, protocol, safeStorage, shell, session, globalShortcut, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerIpc } from '../ipc/register.js';
import { createEngineEventHub, startMobileBridge, type MobileBridge } from './mobile-bridge.js';
import { createMobileGateway, type MobileGateway } from './mobile-gateway.js';
import { notifier } from './notifier.js';
import { installMenu } from './menu.js';
import { TrayController } from './tray.js';
import { confirmQuit, external } from './window.js';
import { loginShellPath } from './shell-path.js';
import { guardRenderer, startEventLoopMonitor, startMainHangWatchdog, startMemoryMonitor } from './stability.js';
import { pruneCrashDumps, reportNewCrashDumps } from './crash-dumps.js';
import { isEvent } from '@openbuddy/protocol/contract';
import { WorkspaceAccess } from '@openbuddy/host/security/workspace-access';
import { createEngineHandlers } from '@openbuddy/host';
import type { HostShell } from '@openbuddy/kernel';
import { NATIVE_COMMANDS, DESKTOP_EVENTS } from '../native/index.js';
import { PREVIEW_SCHEME, previewResponse } from '@openbuddy/services/preview/preview';
import { StructuredLogger } from '@openbuddy/services/support/logger';

const root = dirname(fileURLToPath(import.meta.url));
const developmentURL = 'http://127.0.0.1:1420/';
const trustedURL = app.isPackaged ? () => pathToFileURL(join(root, '../dist/index.html')).href : () => developmentURL;
/** Every app window (main, independent sessions, quick input). IPC accepts calls from all of them. */
const windows = new Set<BrowserWindow>();
let mainWindow: BrowserWindow | null = null;
let quickWindow: BrowserWindow | null = null;
let engine: Awaited<ReturnType<typeof createEngineHandlers>> | null = null;
const events = createEngineEventHub();
let notifyMain: ((event: string, payload: unknown) => void) | null = null;
let notificationsEnabled = () => true;
let shutdown: (() => Promise<void>) | undefined;
let quitting = false;
let runningTasks: (() => Promise<unknown[]>) | undefined;
let cleanup: Promise<void> | undefined;
let previewRoots: () => string[] = () => [];
let tray: TrayController | null = null;
let mobileBridge: MobileBridge | null = null;
let mobileGateway: MobileGateway | undefined;
let unregisterIpc: (() => void) | undefined;
let registeredShortcut = '';
const DEFAULT_QUICK_SHORTCUT = 'CommandOrControl+Shift+Space';

/** 结构化日志 (O1): one rotating, redacted JSONL stream under <userData>/logs. */
let fileLogger: StructuredLogger | undefined;
const log = () => (fileLogger ??= new StructuredLogger(join(app.getPath('userData'), 'logs')));

process.on('uncaughtException', (error) => {
  log().error('main', 'uncaughtException', { message: error.message, stack: error.stack });
  console.error('UNCAUGHT', error);
});
process.on('unhandledRejection', (reason) => {
  log().error('main', 'unhandledRejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  console.error('UNHANDLED_REJECTION', reason);
});
/** 原生崩溃转储 (§1.17): crashpad 只落本地；启动时和每次子进程/渲染进程异常退出后汇总新转储。 */
let dumpScan: ReturnType<typeof setTimeout> | undefined;
const scanCrashDumps = (delayMs: number) => {
  if (dumpScan) return;
  dumpScan = setTimeout(() => {
    dumpScan = undefined;
    const crashpadDir = app.getPath('crashDumps');
    void reportNewCrashDumps({ crashpadDir, stateFile: join(app.getPath('userData'), 'logs', '.native-dumps-seen.json'), log: log() })
      .then(() => pruneCrashDumps(crashpadDir))
      .catch(error => log().warn('crash', 'dump-scan-failed', { message: error instanceof Error ? error.message : String(error) }));
  }, delayMs);
  dumpScan.unref?.();
};
const abnormal = (reason: string) => reason !== 'clean-exit';
app.on('child-process-gone', (_event, details) => {
  log().warn('main', 'child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode });
  if (abnormal(details.reason)) scanCrashDumps(3_000);
});
app.on('render-process-gone', (_event, _contents, details) => { if (abnormal(details.reason)) scanCrashDumps(3_000); });

function disposeEngine(): Promise<void> {
  return cleanup ??= Promise.resolve().then(() => shutdown?.()).catch(error => { console.error('Engine shutdown failed', error); });
}

function quickShortcutFile(): string {
  return join(app.getPath('userData'), 'quick.json');
}
function readQuickShortcut(): string {
  try {
    const value = JSON.parse(readFileSync(quickShortcutFile(), 'utf8')) as { accelerator?: unknown };
    return typeof value.accelerator === 'string' && value.accelerator.trim() ? value.accelerator : DEFAULT_QUICK_SHORTCUT;
  } catch {
    return DEFAULT_QUICK_SHORTCUT;
  }
}
function writeQuickShortcut(accelerator: string): void {
  try { writeFileSync(quickShortcutFile(), JSON.stringify({ accelerator }, null, 2)); } catch { /* keep running */ }
}
/** 全局快速输入 (W7.2): one accelerator at a time; a failed registration keeps the previous one. */
function registerQuickShortcut(accelerator: string): boolean {
  const previous = registeredShortcut;
  if (previous) globalShortcut.unregister(previous);
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => { void openQuickWindow(); });
  } catch { ok = false; }
  if (!ok) {
    registeredShortcut = '';
    if (previous) { try { globalShortcut.register(previous, () => { void openQuickWindow(); }); registeredShortcut = previous; } catch { /* gone */ } }
    return false;
  }
  registeredShortcut = accelerator;
  writeQuickShortcut(accelerator);
  return true;
}

async function openQuickWindow(): Promise<void> {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    return;
  }
  const win = await createWindow('/quick');
  if (win) quickWindow = win;
}

async function createWindow(route?: string): Promise<BrowserWindow | null> {
  const url = trustedURL();
  const quick = route === '/quick';
  const win = new BrowserWindow({
    ...(quick
      ? { width: 560, height: 190, minWidth: 420, minHeight: 150, resizable: true, alwaysOnTop: true, skipTaskbar: true, frame: false }
      : { width: 1440, height: 960, minWidth: 800, minHeight: 600, frame: false }),
    show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    // macOS keeps native traffic lights over the custom sidebar header.
    ...(!quick && process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    // plugins: Chromium's PDF viewer inside the artifact preview iframe.
    webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, plugins: true },
  });
  const isMain = !mainWindow;
  if (isMain) mainWindow = win;
  windows.add(win);
  win.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') log().warn('renderer', event.message);
    console.log('RENDERER_CONSOLE', event.level, event.message);
  });
  // 稳定性守护 (§1.16)：渲染进程崩溃自动重载（60 秒内最多 3 次），超出才让用户决定。
  win.webContents.on('render-process-gone', (_event, details) => console.error('RENDERER_GONE', details.reason));
  guardRenderer(win, log(), {
    unresponsiveGraceMs: Number(process.env.OPENBUDDY_UNRESPONSIVE_GRACE_MS) || 60_000,
    onGiveUp: reason => {
      if (win.isDestroyed()) return;
      void dialog.showMessageBox(win, {
        type: 'error', buttons: ['重新加载', '关闭窗口'], defaultId: 0, cancelId: 1,
        message: reason === 'unresponsive' ? '界面长时间无响应' : '界面多次崩溃',
        detail: reason === 'unresponsive' ? '已自动重启两次仍无响应。可以再试一次，或关闭窗口。' : `渲染进程反复退出或加载失败（${reason}）。可以再试一次，或关闭窗口。`,
      }).then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) win.webContents.reload(); else win.destroy();
      });
    },
  });
  win.webContents.on('did-fail-load', (_event, code, description) => console.error('RENDERER_LOAD_FAILED', code, description));
  if (isMain) {
    notifyMain = notifier(win, () => notificationsEnabled());
    // 任务栏角标 (W7.3): Windows overlay dot while a task waits for approval; cleared on focus.
    win.on('focus', () => {
      if (process.platform !== 'win32') app.setBadgeCount(0);
      else win.setOverlayIcon(null, '');
    });
  }
  win.webContents.setWindowOpenHandler(({ url: target }) => { external(target); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, target) => { if (target.split('#')[0] !== url) { event.preventDefault(); external(target); } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('resize', () => { if (!win.isDestroyed()) win.webContents.send('window://resized', {}); });
  win.once('ready-to-show', () => win.show());
  let closing = false;
  win.on('close', event => {
    // Secondary and quick windows simply close; only the main window owns quit / tray behaviour.
    if (!isMain || closing || quitting) return;
    event.preventDefault();
    // 托盘常驻：关闭只隐藏，后台自动化继续；正在运行的任务也不打断。
    if (tray?.enabled) { win.hide(); return; }
    void confirmQuit(win, runningTasks).then(ok => {
      if (!ok) return;
      closing = true;
      void disposeEngine().then(() => { if (!win.isDestroyed()) win.close(); });
    });
  });
  win.once('closed', () => {
    windows.delete(win);
    if (win === quickWindow) quickWindow = null;
    if (win === mainWindow) {
      mainWindow = null;
      notifyMain = null;
    }
  });
  await win.loadURL(route ? `${url}#${route}` : url);
  return win;
}

// 访达启动的 PATH 不含 Homebrew/mise 等目录，应用安装 spawn npm 会 ENOENT（§1.13）。
const fixedPath = loginShellPath();
if (fixedPath) process.env.PATH = fixedPath;
// 应用安装走 git：私有/需登录的源不能弹终端或凭据窗口把安装挂住，直接失败并给出可读原因（§1.14）。
process.env.GIT_TERMINAL_PROMPT ??= '0';
process.env.GCM_INTERACTIVE ??= 'never';
app.setName('OpenBuddy');
// Must be registered before ready: artifacts preview on their own standard, secure origin.
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.OPENBUDDY_SMOKE_TEST === '1') app.setPath('userData', mkdtempSync(join(tmpdir(), 'openbuddy-smoke-')));
// 崩溃转储只落本地 (<userData>/Crashpad)，不上传；必须在 userData 定下之后尽早启动。
app.setPath('crashDumps', join(app.getPath('userData'), 'Crashpad'));
crashReporter.start({ uploadToServer: false, ignoreSystemCrashHandler: true });
// 单实例 (§1.17)：同一 profile 只跑一个主进程，第二次启动把已有窗口拉到前台。开发态不加锁，方便和已装版本并存。
const primaryInstance = !app.isPackaged || process.env.OPENBUDDY_SMOKE_TEST === '1' || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  log().info('main', 'second-instance');
  const current = mainWindow ?? [...windows][0];
  if (current && !current.isDestroyed()) { if (current.isMinimized()) current.restore(); current.show(); current.focus(); }
});
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  log().info('main', 'ready', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });
  startMainHangWatchdog(join(app.getPath('userData'), 'logs'));
  startEventLoopMonitor(log());
  startMemoryMonitor(log(), () => app.getAppMetrics(), { intervalMs: Number(process.env.OPENBUDDY_MEMORY_INTERVAL_MS) || 60_000, warnTotalMb: Number(process.env.OPENBUDDY_MEMORY_WARN_MB) || 3072 });
  scanCrashDumps(5_000);
  // Only clipboard writes are granted; everything else (camera, notifications, …) stays denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  installMenu();
  session.defaultSession.protocol.handle(PREVIEW_SCHEME, request => previewResponse(request.url, previewRoots()));
  const dev = !app.isPackaged;
  const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'${dev ? ' ws://127.0.0.1:1420' : ''}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src ${PREVIEW_SCHEME}:`;
  // The app policy belongs to the app's own pages. Preview responses carry their own, stricter
  // CSP, and Chromium's PDF viewer (chrome-extension:) needs its chrome:// resources.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback(/^(https?|file):/.test(details.url) ? { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } } : {}));

  // 网络代理 (S15): Chromium does not read the conventional proxy env vars, so a proxied
  // desktop could not reach the npm registry for the Pi package market. Apply them to the
  // default session (loopback stays direct so local model servers / fixtures still work).
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxy) await session.defaultSession.setProxy({ proxyRules: proxy, proxyBypassRules: '127.0.0.1,localhost,::1' });

  // One engine for every window (W7.1): events fan out to all of them, notifications use the main window.
  const hostShell: HostShell = { openPath: path => shell.openPath(path), openExternal: url => shell.openExternal(url), showItemInFolder: path => shell.showItemInFolder(path), trash: path => shell.trashItem(path) };
  engine = await createEngineHandlers({
    userData: app.getPath('userData'), safeStorage, shell: hostShell,
    // Electron's net.fetch follows the session proxy above; the runtime fetch does not.
    fetchImpl: ((input: string | URL | Request, init?: RequestInit) => net.fetch(input as string, init)) as typeof fetch,
    platform: { kind: 'desktop', commands: NATIVE_COMMANDS, events: DESKTOP_EVENTS },
    appVersion: app.getVersion(),
    // 内置 UpUp (§1.15)：打包后在 <resources>/upup（electron-builder extraResources），开发态是仓库 vendor/upup。
    bundledApps: [app.isPackaged ? join(process.resourcesPath, 'upup') : join(app.getAppPath(), 'vendor', 'upup')],
    ...(process.env.OPENBUDDY_UPDATE_FEED ? { updateFeed: process.env.OPENBUDDY_UPDATE_FEED } : {}),
    emit: (event: string, payload: unknown) => {
      events.emit(event, payload);
      if (isEvent(event)) for (const win of windows) if (!win.isDestroyed()) win.webContents.send(event, payload);
      notifyMain?.(event, payload);
      // 任务栏角标 (W7.3): a pending approval lights the Windows overlay icon.
      if (process.platform === 'win32' && event === 'agent://permission' && mainWindow) {
        const dot = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8z8Dwn4EIwESMolGFowoHFQ5qHNQ4qHFQ46DGAQMAoAcBAX0lS9kAAAAASUVORK5CYII=');
        mainWindow.setOverlayIcon(dot, '有任务待确认');
      }
    },
  });
  previewRoots = engine.previewRoots;
  notificationsEnabled = engine.notificationsEnabled;
  cleanup = undefined;
  shutdown = async () => { await engine!.shutdown(); };
  // 内置应用 (§1.15)：UpUp 随安装包分发，启动时登记为本地 Pi 包（只记路径，不跑 git/npm，幂等）。
  // 放在开窗口之前，第一个会话就有 UpUp 的工具。`OPENBUDDY_DEFAULT_APPS=off` 可关闭（走查要「未安装」空态时用）。
  if (process.env.OPENBUDDY_DEFAULT_APPS !== 'off') {
    try {
      const started = Date.now();
      const result = await engine.handlers.apps_ensure_bundled({});
      log().info('main', 'bundled-apps', { ...(result as Record<string, unknown>), ms: Date.now() - started });
    } catch (error) {
      log().warn('main', 'bundled-apps-failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }
  runningTasks = async () => { try { return await engine!.handlers.tasks_list({}) as unknown[]; } catch { return []; } };
  const workspaceAccess = await WorkspaceAccess.create(app.getPath('userData'));
  // 托盘常驻 (W4.4): closing the main window only hides it; automations keep running.
  tray ??= new TrayController({
    show: () => {
      const current = mainWindow ?? [...windows][0];
      if (current && !current.isDestroyed()) { if (current.isMinimized()) current.restore(); current.show(); current.focus(); }
      else void createWindow();
    },
    quit: () => app.quit(),
  });
  // 手机接入 (§4.4): opt-in via env; one bridge for the process.
  if (process.env.OPENBUDDY_GATEWAY_URL && process.env.OPENBUDDY_GATEWAY_ADMIN_TOKEN) {
    mobileGateway = createMobileGateway({
      gatewayUrl: process.env.OPENBUDDY_GATEWAY_URL,
      adminToken: process.env.OPENBUDDY_GATEWAY_ADMIN_TOKEN,
      ...(process.env.OPENBUDDY_GATEWAY_DESKTOP_ID ? { desktopId: process.env.OPENBUDDY_GATEWAY_DESKTOP_ID } : {}),
    });
  }
  unregisterIpc = registerIpc(
    () => [...windows], engine.handlers, trustedURL(), workspaceAccess,
    {
      attachmentsDir: join(app.getPath('userData'), 'attachments'),
      exportHtml: engine.exportHtml,
      tray: { get: () => tray!.enabled, set: enabled => tray!.setEnabled(enabled) },
      ...(mobileGateway ? { mobileGateway } : {}),
      // 独立窗口 (W7.1) + 全局快速输入 (W7.2).
      openSessionWindow: (sessionId: string) => { void createWindow(`/session/${encodeURIComponent(sessionId)}`); },
      openArtifactWindow: (sessionId: string, path: string) => {
        void createWindow(`/artifact/${encodeURIComponent(sessionId)}?path=${encodeURIComponent(path)}`);
      },
      openQuickWindow: () => { void openQuickWindow(); },
      quickShortcut: { get: () => readQuickShortcut(), set: accelerator => registerQuickShortcut(accelerator) },
    },
  );
  if (process.env.OPENBUDDY_GATEWAY_URL) {
    mobileBridge = await startMobileBridge({
      handlers: engine.handlers,
      hub: events,
      uploadsDir: join(app.getPath('userData'), 'mobile-uploads'),
      gatewayUrl: process.env.OPENBUDDY_GATEWAY_URL,
      agentToken: process.env.OPENBUDDY_GATEWAY_AGENT_TOKEN,
    });
  }
  registerQuickShortcut(readQuickShortcut());
  await createWindow();
  if (process.env.OPENBUDDY_SMOKE_TEST === '1') {
    console.log('OPENBUDDY_RUNTIME', JSON.stringify(process.versions));
    const win = mainWindow!;
    const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      let attempts = 0;
      const inspect = () => {
        if (document.querySelector('#root')?.children.length && window.openbuddy && document.querySelector('textarea')) {
          resolve({ title: document.title, rootChildren: document.querySelector('#root').children.length, bodyText: document.body.innerText, controls: [...document.querySelectorAll('button, textarea, input')].map(el => ({tag:el.tagName,text:el.innerText,placeholder:el.getAttribute('placeholder'),label:el.getAttribute('aria-label')})), bridge: Object.keys(window.openbuddy), nodeRequire: typeof window.require, nodeProcess: typeof window.process });
        } else if (++attempts >= 100) reject(new Error('renderer smoke timed out'));
        else setTimeout(inspect, 100);
      };
      inspect();
    })`);
    const screenshotPath = join(app.getPath('userData'), 'renderer.png');
    writeFileSync(screenshotPath, (await win.webContents.capturePage()).toPNG());
    console.log('OPENBUDDY_SMOKE_SCREENSHOT', screenshotPath);
    console.log('OPENBUDDY_SMOKE_DOM', JSON.stringify(result));
    console.log('OPENBUDDY_SMOKE_LOADED', win.webContents.getURL());
    app.quit();
  }
  app.on('activate', () => {
    if (!mainWindow) void createWindow();
    else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
}).catch(error => { log().error('main', 'startup-failed', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }); console.error('OpenBuddy startup failed', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.OPENBUDDY_SMOKE_TEST === '1') app.quit(); });
app.on('will-quit', () => { log().info('main', 'will-quit'); globalShortcut.unregisterAll(); unregisterIpc?.(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  void confirmQuit(mainWindow, runningTasks).then(ok => {
    if (!ok) return;
    void disposeEngine().then(async () => {
      quitting = true;
      await mobileBridge?.close();
      mobileBridge = null;
      app.quit();
    });
  });
});
