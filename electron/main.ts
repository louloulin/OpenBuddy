import { app, BrowserWindow, safeStorage, shell, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerIpc } from './ipc/register.js';
import { isEvent } from './shared/contract.js';
import { createEngineHandlers } from './ipc/handlers/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const developmentURL = 'http://127.0.0.1:1420/';
let window: BrowserWindow | null = null;
let shutdown: (() => Promise<void>) | undefined;
let quitting = false;
let cleanup: Promise<void> | undefined;
function disposeEngine(): Promise<void> {
  return cleanup ??= Promise.resolve().then(() => shutdown?.()).catch(error => { console.error('Engine shutdown failed', error); });
}

function external(url: string): void {
  try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) void shell.openExternal(parsed.href); } catch { /* Invalid destinations are blocked. */ }
}

async function createWindow(): Promise<void> {
  const trustedURL = app.isPackaged ? pathToFileURL(join(root, '../dist/index.html')).href : developmentURL;
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 800, minHeight: 600,
    frame: false, show: false, backgroundColor: '#ffffff',
    webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false },
  });
  window = win;
  win.webContents.on('console-message', event => { console.log('RENDERER_CONSOLE', event.level, event.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('RENDERER_GONE', details.reason); });
  win.webContents.on('did-fail-load', (_event, code, description) => { console.error('RENDERER_LOAD_FAILED', code, description); });
  const engine = await createEngineHandlers({ userData: app.getPath('userData'), safeStorage, shell, emit: (event: string, payload: unknown) => { if (isEvent(event) && !win.isDestroyed()) win.webContents.send(event, payload); } });
  cleanup = undefined;
  shutdown = async () => { await engine.shutdown(); };
  const unregister = registerIpc(win, engine.handlers, trustedURL);
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== trustedURL) { event.preventDefault(); external(url); } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('resize', () => win.webContents.send('window://resized', {}));
  win.once('ready-to-show', () => win.show());
  let closing = false;
  win.on('close', event => {
    if (closing || quitting) return;
    event.preventDefault();
    closing = true;
    void disposeEngine().then(() => { if (!win.isDestroyed()) win.close(); });
  });
  win.once('closed', () => { unregister(); window = null; });
  await win.loadURL(trustedURL);
  if (process.env.OPENBUDDY_SMOKE_TEST === '1') {
    console.log('OPENBUDDY_RUNTIME', JSON.stringify(process.versions));
    const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      let attempts = 0;
      const inspect = () => {
        if (document.querySelector('#root')?.children.length && window.openbuddy && document.querySelector('button')) {
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
if (process.env.OPENBUDDY_SMOKE_TEST === '1') app.setPath('userData', mkdtempSync(join(tmpdir(), 'openbuddy-smoke-')));
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const dev = !app.isPackaged;
  const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'${dev ? ' ws://127.0.0.1:1420' : ''}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }));
  await createWindow();
  app.on('activate', () => { if (!window) void createWindow(); });
}).catch(error => { console.error('OpenBuddy startup failed', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.OPENBUDDY_SMOKE_TEST === '1') app.quit(); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  void disposeEngine().then(() => { quitting = true; app.quit(); });
});
