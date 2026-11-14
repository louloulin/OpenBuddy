import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, shell, session, type MenuItemConstructorOptions } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerIpc } from './ipc/register.js';
import { isEvent } from './shared/contract.js';
import { WorkspaceAccess } from './shared/workspace-access.js';
import { createEngineHandlers } from './ipc/handlers/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const developmentURL = 'http://127.0.0.1:1420/';
let window: BrowserWindow | null = null;
let shutdown: (() => Promise<void>) | undefined;
let quitting = false;
let runningTasks: (() => Promise<unknown[]>) | undefined;
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
    frame: false, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    // macOS keeps native traffic lights over the custom sidebar header.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } } : {}),
    webPreferences: { preload: join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false },
  });
  window = win;
  win.webContents.on('console-message', event => { console.log('RENDERER_CONSOLE', event.level, event.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('RENDERER_GONE', details.reason); });
  win.webContents.on('did-fail-load', (_event, code, description) => { console.error('RENDERER_LOAD_FAILED', code, description); });
  const engine = await createEngineHandlers({ userData: app.getPath('userData'), safeStorage, shell, emit: (event: string, payload: unknown) => { if (isEvent(event) && !win.isDestroyed()) win.webContents.send(event, payload); } });
  cleanup = undefined;
  shutdown = async () => { await engine.shutdown(); };
  runningTasks = async () => { try { return await engine.handlers.tasks_list({}) as unknown[]; } catch { return []; } };
  const workspaceAccess = await WorkspaceAccess.create(app.getPath('userData'));
  const unregister = registerIpc(win, engine.handlers, trustedURL, workspaceAccess);
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== trustedURL) { event.preventDefault(); external(url); } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('resize', () => win.webContents.send('window://resized', {}));
  win.once('ready-to-show', () => win.show());
  let closing = false;
  win.on('close', event => {
    if (closing || quitting) return;
    event.preventDefault();
    void confirmQuit(win).then(ok => {
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

/** Ask before closing while tasks are still running in background sessions. */
async function confirmQuit(win: BrowserWindow | null): Promise<boolean> {
  if (process.env.OPENBUDDY_SMOKE_TEST === '1' || !runningTasks) return true;
  const tasks = await runningTasks();
  if (!tasks.length) return true;
  const options = { type: 'warning' as const, title: 'OpenBuddy', message: `还有 ${tasks.length} 个任务正在运行`, detail: '退出将停止这些任务，已生成的内容会保留。', buttons: ['取消', '停止并退出'], defaultId: 0, cancelId: 0 };
  const result = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response === 1;
}

/** Application menu: standard edit roles everywhere; reload/devtools only in development. */
function installMenu(): void {
  const dev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: 'OpenBuddy', submenu: [{ role: 'about' as const, label: '关于 OpenBuddy' }, { type: 'separator' as const }, { role: 'hide' as const, label: '隐藏 OpenBuddy' }, { role: 'hideOthers' as const, label: '隐藏其他' }, { type: 'separator' as const }, { role: 'quit' as const, label: '退出 OpenBuddy' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [...(dev ? [{ role: 'reload' as const, label: '重新加载' }, { role: 'toggleDevTools' as const, label: '开发者工具' }, { type: 'separator' as const }] : []), { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, ...(process.platform === 'darwin' ? [{ role: 'front' as const, label: '前置全部窗口' }] : [{ role: 'close' as const, label: '关闭' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('OpenBuddy');
if (process.env.OPENBUDDY_SMOKE_TEST === '1') app.setPath('userData', mkdtempSync(join(tmpdir(), 'openbuddy-smoke-')));
app.whenReady().then(async () => {
  // Only clipboard writes are granted; everything else (camera, notifications, …) stays denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  installMenu();
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
  void confirmQuit(window).then(ok => {
    if (!ok) return;
    void disposeEngine().then(() => { quitting = true; app.quit(); });
  });
});
