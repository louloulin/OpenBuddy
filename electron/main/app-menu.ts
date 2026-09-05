/**
 * app-menu.ts — P3-1 layered extraction: 应用菜单.
 *
 * 原内联于 electron/main/index.ts 的 `Menu.setApplicationMenu(...)` 块
 * (约 219-272 行, app.whenReady 闭包内).
 * 抽到这里, 通过 `getMainWindow` 回调读当前主窗口 (不持 module-scope 引用).
 *
 * 职责:
 *   - 构造 View 菜单 (Reload / Force Reload / Toggle DevTools + F12)
 *   - editMenu / windowMenu 标准 Electron role
 *
 * 不在职责:
 *   - 主窗口创建 (`./main-window.ts`)
 *   - 应用菜单调用方的主进程启动顺序 (`./index.ts`)
 */
import { BrowserWindow, Menu } from "electron";

export interface InstallAppMenuOptions {
  /**
   * 当前主窗口解析器. 返回 null 时所有菜单点击静默 no-op
   * (菜单已注册但无窗口可操作 — 启动早期 / 关闭后).
   */
  getMainWindow: () => BrowserWindow | null;
}

export function installAppMenu(opts: InstallAppMenuOptions): void {
  const { getMainWindow } = opts;

  const reloadRenderer = (ignoreCache = false) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      console.warn("[openbuddy-pi] reloadRenderer ignored - no main window");
      return false;
    }
    if (ignoreCache) win.webContents.reloadIgnoringCache();
    else win.webContents.reload();
    return true;
  };

  const toggleDevTools = () => {
    const win = getMainWindow();
    const contents = win?.webContents;
    if (!contents) return;
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: "detach", activate: true });
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            id: "reload",
            label: "Reload",
            accelerator: process.platform === "darwin" ? "Command+R" : "Ctrl+R",
            click: () => reloadRenderer(false),
          },
          {
            id: "forceReload",
            label: "Force Reload",
            accelerator: process.platform === "darwin" ? "Command+Shift+R" : "Ctrl+Shift+R",
            click: () => reloadRenderer(true),
          },
          { type: "separator" },
          {
            id: "toggleDevTools",
            label: "Toggle Developer Tools",
            accelerator: process.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
            click: toggleDevTools,
          },
          {
            id: "toggleDevToolsF12",
            label: "Toggle Developer Tools (F12)",
            accelerator: "F12",
            click: toggleDevTools,
          },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}
