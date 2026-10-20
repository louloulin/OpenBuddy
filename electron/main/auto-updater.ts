/**
 * electron/main/auto-updater.ts — wire `electron-updater` at app start.
 *
 * Goal: rb-autoupdater (mu7rpkze-gc769z). This is the minimal wire-up:
 *  - Reads `app-update.yml` that electron-builder already drops at
 *    `Contents/Resources/app-update.yml` (auto-generated from
 *    `electron-builder.yml:194-200` `publish:` block).
 *  - Logs every event via `createMainLogger` so the same log sink that
 *    catches `uncaughtException` (process-guards) also captures update
 *    traffic.
 *  - Broadcasts `app:auto-update-available|progress|downloaded` to every
 *    live `BrowserWindow.webContents` so a future renderer can drive the
 *    "What's New" gate without re-implementing feed plumbing. Today no
 *    renderer subscribes; that surface is reserved.
 *  - `autoDownload=false` so a chat in flight does not silently eat
 *    bandwidth; `autoInstallOnAppQuit=true` so the prepared update
 *    applies on next quit.
 *
 * The platform-specific updater (`MacUpdater` / `NsisUpdater`) is
 * instantiated lazily by `electron-updater`'s `doLoadAutoUpdater()` the
 * first time `autoUpdater` is *accessed*, NOT at module load. Importing
 * the package here is therefore safe to evaluate at top-of-module.
 */
import { BrowserWindow, ipcMain } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { createMainLogger, type MainLogger } from "@openbuddy/logging-main";

export interface AutoUpdaterOptions {
  /** Auto-download when an update is found. Default `false` (user-driven). */
  autoDownload?: boolean;
  /** Install the prepared update when the app quits. Default `true`. */
  autoInstallOnAppQuit?: boolean;
  /**
   * IPC channel prefix used to forward events to every live BrowserWindow.
   * Default `"app:auto-update"`. Renderer-facing channels are reserved:
   * `-available`, `-progress`, `-downloaded` are appended by this module.
   */
  channelPrefix?: string;
}

export interface AutoUpdaterHandle {
  /**
   * Trigger a single update check. Idempotent: subsequent calls within the
   * lifetime of this handle are no-ops. Returns the underlying promise so
   * callers may `await` it; resolution is best-effort — rejections are
   * caught and logged, never re-thrown.
   */
  trigger: () => Promise<void>;
  /** Detach every event listener this handle owns. Safe to call multiple times. */
  stop: () => void;
}

/**
 * Install the auto-updater wiring. Must be called after `app.whenReady()`
 * so the platform-specific updater can resolve `app.getPath("userData")`.
 *
 * @example
 *   const handle = installAutoUpdater();
 *   void handle.trigger();
 *   app.on("before-quit", handle.stop);
 */
export function installAutoUpdater(opts: AutoUpdaterOptions = {}): AutoUpdaterHandle {
  const log: MainLogger = createMainLogger({ name: "auto-updater" });
  autoUpdater.autoDownload = opts.autoDownload ?? false;
  autoUpdater.autoInstallOnAppQuit = opts.autoInstallOnAppQuit ?? true;

  const prefix = opts.channelPrefix ?? "app:auto-update";

  const onError = (err: Error, message?: string) => {
    log.error({ err: err?.message, stack: err?.stack, message }, "auto-updater error");
  };
  const onChecking = () => log.info("checking-for-update");
  const onAvailable = (info: UpdateInfo) => log.info({ version: info.version }, "update-available");
  const onNotAvailable = (info: UpdateInfo) => log.info({ version: info.version }, "update-not-available");
  const onProgress = (p: ProgressInfo) =>
    log.info(
      { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond },
      "download-progress",
    );
  const onDownloaded = (info: UpdateInfo) =>
    log.info({ version: info.version }, "update-downloaded (will install on next quit)");

  autoUpdater.on("error", onError);
  autoUpdater.on("checking-for-update", onChecking);
  autoUpdater.on("update-available", onAvailable);
  autoUpdater.on("update-not-available", onNotAvailable);
  autoUpdater.on("download-progress", onProgress);
  autoUpdater.on("update-downloaded", onDownloaded);

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  };
  // P0(发布工程):渲染端可查询的状态 + 主动检查/安装通道。此前事件只广播
  // 一次,渲染端错过即永久丢失;状态通道补齐这个缺口。全部状态更新并入下方
  // *Ipc 监听器,stop() 统一摘除。
  type UpdateState = {
    status: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
    version?: string;
    percent?: number;
    error?: string;
  };
  let state: UpdateState = { status: "idle" };
  const setState = (patch: UpdateState) => {
    state = { ...state, ...patch };
    broadcast(`${prefix}-state`, state);
  };

  const onCheckingIpc = () => setState({ status: "checking" });
  const onAvailableIpc = (info: UpdateInfo) => {
    setState({ status: "available", version: info.version });
    broadcast(`${prefix}-available`, { version: info.version });
  };
  const onNotAvailableIpc = (info: UpdateInfo) => setState({ status: "not-available", version: info.version });
  const onProgressIpc = (p: ProgressInfo) => {
    setState({ status: "downloading", percent: p.percent });
    broadcast(`${prefix}-progress`, { percent: p.percent });
  };
  const onDownloadedIpc = (info: UpdateInfo) => {
    setState({ status: "downloaded", version: info.version });
    broadcast(`${prefix}-downloaded`, { version: info.version });
  };
  const onErrorIpc = (err: Error) => setState({ status: "error", error: err?.message });

  autoUpdater.on("checking-for-update", onCheckingIpc);
  autoUpdater.on("update-available", onAvailableIpc);
  autoUpdater.on("update-not-available", onNotAvailableIpc);
  autoUpdater.on("download-progress", onProgressIpc);
  autoUpdater.on("update-downloaded", onDownloadedIpc);
  autoUpdater.on("error", onErrorIpc);

  ipcMain.handle("app:auto-update-state", () => state);
  ipcMain.handle("app:check-updates", async () => {
    started = false;
    await triggerCheck();
    return state;
  });
  ipcMain.handle("app:install-updates", () => {
    if (state.status !== "downloaded") return { ok: false, error: "no downloaded update" };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  let started = false;
  const triggerCheck = async (): Promise<void> => {
    if (started) return;
    started = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "checkForUpdates threw");
    }
  };
  return {
    trigger: triggerCheck,
    stop: () => {
      autoUpdater.off("error", onError);
      autoUpdater.off("checking-for-update", onChecking);
      autoUpdater.off("update-available", onAvailable);
      autoUpdater.off("update-not-available", onNotAvailable);
      autoUpdater.off("download-progress", onProgress);
      autoUpdater.off("update-downloaded", onDownloaded);
      autoUpdater.off("checking-for-update", onCheckingIpc);
      autoUpdater.off("update-available", onAvailableIpc);
      autoUpdater.off("update-not-available", onNotAvailableIpc);
      autoUpdater.off("download-progress", onProgressIpc);
      autoUpdater.off("update-downloaded", onDownloadedIpc);
      autoUpdater.off("error", onErrorIpc);
    },
  };
}