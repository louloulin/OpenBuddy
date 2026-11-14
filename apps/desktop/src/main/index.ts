import { app, BrowserWindow, nativeTheme, protocol, safeStorage, shell, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerIpc } from '../ipc/register.js';
import { notifier } from './notifier.js';
import { installMenu } from './menu.js';
import { confirmQuit, external } from './window.js';
import { isEvent } from '@openbuddy/protocol/contract';
import { WorkspaceAccess } from '@openbuddy/host/security/workspace-access';
import { createEngineHandlers } from '@openbuddy/host';
import { NATIVE_COMMANDS, DESKTOP_EVENTS } from '../native/index.js';
import { PREVIEW_SCHEME, previewResponse } from '@openbuddy/services/preview/preview';

const root = dirname(fileURLToPath(import.meta.url));
const developmentURL = 'http://127.0.0.1:1420/';
let window: BrowserWindow | null = null;
let shutdown: (() => Promise<void>) | undefined;
let quitting = false;
let runningTasks: (() => Promise<unknown[]>) | undefined;
let cleanup: Promise<void> | undefined;
let previewRoots: () => string[] = () => [];
function disposeEngine(): Promise<void> {
  return cleanup ??= Promise.resolve().then(() => shutdown?.()).catch(error => { console.error('Engine shutdown failed', error); });
}

async function createWindow(): Promise<void> {
  const trustedURL = app.isPackaged ? pathToFileURL(join(root, '../dist/index.html')).href : developmentURL;
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 800, minHeight: 600,
    frame: false, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    // macOS keeps native traffic lights over the custom sidebar header.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    // plugins: Chromium's PDF viewer inside the artifact preview iframe.
    webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, plugins: true },
  });
  window = win;
  win.webContents.on('console-message', event => { console.log('RENDERER_CONSOLE', event.level, event.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('RENDERER_GONE', details.reason); });
  win.webContents.on('did-fail-load', (_event, code, description) => { console.error('RENDERER_LOAD_FAILED', code, description); });
  let notificationsEnabled = () => true;
  const notify = notifier(win, () => notificationsEnabled());
  const engine = await createEngineHandlers({ userData: app.getPath('userData'), safeStorage, shell, platform: { kind: 'desktop', commands: NATIVE_COMMANDS, events: DESKTOP_EVENTS }, emit: (event: string, payload: unknown) => { if (isEvent(event) && !win.isDestroyed()) { win.webContents.send(event, payload); notify(event, payload); } } });
  previewRoots = engine.previewRoots;
  notificationsEnabled = engine.notificationsEnabled;
  cleanup = undefined;
  shutdown = async () => { await engine.shutdown(); };
  runningTasks = async () => { try { return await engine.handlers.tasks_list({}) as unknown[]; } catch { return []; } };
  const workspaceAccess = await WorkspaceAccess.create(app.getPath('userData'));
  const unregister = registerIpc(win, engine.handlers, trustedURL, workspaceAccess, { attachmentsDir: join(app.getPath('userData'), 'attachments'), exportHtml: engine.exportHtml });
  win.on('focus', () => { if (process.platform !== 'win32') app.setBadgeCount(0); });
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== trustedURL) { event.preventDefault(); external(url); } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('resize', () => win.webContents.send('window://resized', {}));
  win.once('ready-to-show', () => win.show());
  let closing = false;
  win.on('close', event => {
    if (closing || quitting) return;
    event.preventDefault();
    void confirmQuit(win, runningTasks).then(ok => {
      if (!ok) return;
      closing = true;
      void disposeEngine().then(() => { if (!win.isDestroyed()) win.close(); });
    });
  });
  win.once('closed', () => { unregister(); window = null; });
  await win.loadURL(trustedURL);
  if (process.env.OPENBUDDY_SMOKE_TEST === '1') {
    console.log('OPENBUDDY_RUNTIME', JSON.stringify(process.versions));
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
}

app.setName('OpenBuddy');
// Must be registered before ready: artifacts preview on their own standard, secure origin.
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.OPENBUDDY_SMOKE_TEST === '1') app.setPath('userData', mkdtempSync(join(tmpdir(), 'openbuddy-smoke-')));
app.whenReady().then(async () => {
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
  await createWindow();
  app.on('activate', () => { if (!window) void createWindow(); });
}).catch(error => { console.error('OpenBuddy startup failed', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.OPENBUDDY_SMOKE_TEST === '1') app.quit(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  void confirmQuit(window, runningTasks).then(ok => {
    if (!ok) return;
    void disposeEngine().then(() => { quitting = true; app.quit(); });
  });
});
