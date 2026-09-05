/**
 * main-window.ts — P3-1 layered extraction: 主窗口工厂.
 *
 * 原内联于 electron/main/index.ts 的 createMainWindow() (190-289 行).
 * 抽到这里, 依赖通过参数注入. 不持有全局 `mainWindow` 状态
 * — 调用方 (index.ts) 负责赋值与清理 (closed 回调).
 *
 * 设计原则:
 *   - 函数纯度: 不读 module-scope 变量, 全部从 opts 传入
 *   - 副作用限定: perfTraceMark / notifyBridgeUnavailable 都是 callbacks
 *   - 调用方持有 mainWindow 引用与 closed 清理
 */
import { BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { installDragRegion } from "./window";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererIndex: string;
  devRendererUrl: string | undefined;
  perfTraceMark: (label: string, payload?: Record<string, unknown>) => void;
  notifyBridgeUnavailable: (reason: string) => void;
}

export function createMainWindow(opts: CreateMainWindowOptions): BrowserWindow {
  const { preloadPath, rendererIndex, devRendererUrl, perfTraceMark, notifyBridgeUnavailable } = opts;

  perfTraceMark("window-create", { phase: "before-construct" });
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "OpenBuddy",
    backgroundColor: "#f7f7f8",
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "darwin"
        ? { color: "#00000000", symbolColor: "#ffffff", height: 32 }
        : false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let shown = false;
  let loadFailureShown = false;
  const showFailurePage = (title: string, message: string) => {
    if (loadFailureShown || win.isDestroyed()) return;
    loadFailureShown = true;
    const escapedMessage = message.replace(
      /[&<>]/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
    );
    const failurePage = `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:0;padding:32px;background:#f7f7f8;color:#202124;font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:820px;margin:8vh auto;padding:28px;border:1px solid #d9dce1;border-radius:12px;background:#fff;box-shadow:0 8px 30px #00000012}h1{font-size:20px;margin:0 0 12px}pre{white-space:pre-wrap;word-break:break-word;color:#5f6368}</style><main><h1>${title}</h1><pre>${escapedMessage}</pre><p>请使用 View → Toggle Developer Tools 或快捷键检查渲染器错误，然后重新加载。</p></main>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(failurePage)}`);
    showWindow();
  };
  const showWindow = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  // P0-01: ready-to-show fires on first frame (DOMContentLoaded + first paint),
  // which is significantly earlier than did-finish-load (waits for all subresources).
  // backgroundColor avoids white flash before first paint.
  win.once("ready-to-show", () => {
    perfTraceMark("window-ready");
    showWindow();
  });
  win.webContents.once("did-finish-load", () => {
    perfTraceMark("window-resources-ready");
  });
  win.webContents.once("paint", () => {
    perfTraceMark("first-paint");
  });
  // Safety: if ready-to-show never fires within 5s (e.g. GPU hang, white screen),
  // fall back to did-finish-load so the window is still visible.
  const readyShowTimeout = setTimeout(() => {
    if (!shown && !win.isDestroyed()) {
      perfTraceMark("window-ready-timeout-fallback");
      showWindow();
    }
  }, 5000);
  win.once("closed", () => clearTimeout(readyShowTimeout));
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[openbuddy-pi] renderer failed to load (${errorCode}): ${errorDescription} ${validatedURL}`);
    showFailurePage(
      "OpenBuddy 无法加载界面",
      `OpenBuddy renderer failed to load\n\n${errorDescription} (${errorCode})\n${validatedURL}`,
    );
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.warn(`[openbuddy-pi] renderer console level=${level} ${sourceId}:${line} ${message}`);
  });
  win.webContents.on("before-input-event", (event, input) => {
    const isPlatformDevToolsShortcut =
      process.platform === "darwin"
        ? input.key.toLowerCase() === "i" && input.alt && input.meta
        : input.key.toLowerCase() === "i" && input.control && input.shift;
    if (input.key === "F12" || isPlatformDevToolsShortcut) {
      event.preventDefault();
      const contents = win.webContents;
      if (contents.isDevToolsOpened()) contents.closeDevTools();
      else contents.openDevTools({ mode: "detach", activate: true });
    }
  });
  win.webContents.on("preload-error", (_event, preload, error) => {
    console.error(`[openbuddy-pi] preload failed: ${preload}`, error);
    showFailurePage("OpenBuddy bridge 加载失败", `Electron preload bridge unavailable\n\n${preload}\n${String(error)}`);
    notifyBridgeUnavailable("preload-error");
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[openbuddy-pi] renderer process gone:", details);
    if (details.reason !== "clean-exit") {
      showFailurePage(
        "OpenBuddy 渲染器已停止",
        `Renderer process exited unexpectedly.\n\nreason=${details.reason}\nexitCode=${details.exitCode}`,
      );
    }
    notifyBridgeUnavailable(`render-process-gone:${details.reason ?? "unknown"}`);
  });
  win.setTitle("OpenBuddy");

  // External links open in the default browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  installDragRegion(win);

  if (devRendererUrl) {
    perfTraceMark("window-fire-load", { mode: "dev-url" });
    void win.loadURL(devRendererUrl);
  } else if (existsSync(rendererIndex)) {
    perfTraceMark("window-fire-load", { mode: "file" });
    void win.loadFile(rendererIndex);
  } else {
    const message = `Renderer build not found: ${rendererIndex}`;
    console.error(`[openbuddy-pi] ${message}`);
    showFailurePage("OpenBuddy 构建缺失", message);
  }

  return win;
}
