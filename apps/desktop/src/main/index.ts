import { app, BrowserWindow, nativeImage, nativeTheme, protocol, safeStorage, shell, session, globalShortcut, net } from 'electron';
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
app.on('child-process-gone', (_event, details) => {
  log().warn('main', 'child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode });
});

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
  win.webContents.on('render-process-gone', (_event, details) => {
    log().error('renderer', 'render-process-gone', { reason: details.reason, exitCode: details.exitCode });
    console.error('RENDERER_GONE', details.reason);
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    log().warn('renderer', 'did-fail-load', { code, description });
    console.error('RENDERER_LOAD_FAILED', code, description);
  });
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
app.whenReady().then(async () => {
  log().info('main', 'ready', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });
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
  // 默认应用 (2026-11-27)：首次启动从官方 Git 源装 UpUp（幂等，后台执行）。
  // `OPENBUDDY_DEFAULT_APPS=off` 可关闭（走查/测试需要"未安装"空态时用）。
  if (process.env.OPENBUDDY_DEFAULT_APPS !== 'off') {
    void (async () => {
      try {
        const result = await engine!.handlers.apps_ensure_default({});
        log().info('main', 'default-app', result as Record<string, unknown>);
      } catch (error) {
        log().warn('main', 'default-app-failed', { message: error instanceof Error ? error.message : String(error) });
      }
    })();
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
