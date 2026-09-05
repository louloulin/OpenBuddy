/**
 * bootstrap/app-lifecycle.ts — wire Electron app lifecycle events.
 *
 * Phase 8.3 §42: extracted from electron/main/index.ts.
 * Owns:
 *   1. Single-instance lock + second-instance handler
 *   2. app.whenReady → installAppMenu → registerIpc → onWindowCreated
 *      → bootBackgroundServices (fire-and-forget) → activate handler
 *   3. window-all-closed (non-darwin: app.quit)
 *   4. before-quit (forwards to onBeforeQuit)
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from index.ts. It only imports Electron,
 *   perfTraceMark, and the bridge status broadcaster. All state mutations
 *   happen via deps callbacks bound in index.ts.
 */
import { app, BrowserWindow } from "electron";
import { perfTraceMark } from "../observability/perf-trace";

export interface AppLifecycleDeps {
  /**
   * Create the main BrowserWindow and return it. The lifecycle module does
   * NOT track the returned window — index.ts holds the mainWindow ref and
   * passes getters to installAppMenu/registerIpc.
   */
  createMainWindow: () => BrowserWindow | null;
  /** Install the application menu (uses the mainWindow getter lazily). */
  installAppMenu: () => void;
  /** Register IPC handlers (uses the mainWindow getter lazily). Async since P1-04. */
  registerIpc: () => Promise<void> | void;
  /**
   * Drain second-instance argv into the casdoor protocol handler. The host
   * passes this so lifecycle doesn't have to import security/casdoor.
   */
  onSecondInstance: (commandLine: ReadonlyArray<string>) => void;
  /** Bridge status broadcaster lifecycle (start + stop hooks). */
  bridgeBroadcaster?: {
    start: (probe: () => { available: boolean; consecutiveFailures: number; lastErrorMessage: string | null; lastUpdated: number }) => void;
    stop: () => void;
  };
  /** Called after the main window has been created, before background boot. */
  onWindowCreated?: () => void;
  /** Fire-and-forget background boot (agent-host + harness + casdoor init). */
  bootBackgroundServices: () => Promise<void> | void;
  /** Cleanup hook called from app "before-quit". */
  onBeforeQuit?: () => void;
}

/**
 * Install Electron app event handlers. Should be called exactly once at startup.
 *
 * Returns nothing. The host can `await installAppLifecycle(deps)` if it wants
 * to know that single-instance-lock / whenReady-await completed, but we don't
 * block on that — whenReady's promise resolves in its own microtask and the
 * actual UI boot happens inside it.
 */
export function installAppLifecycle(deps: AppLifecycleDeps): void {
  const {
    createMainWindow,
    installAppMenu,
    registerIpc,
    onSecondInstance,
    bridgeBroadcaster,
    onWindowCreated,
    bootBackgroundServices,
    onBeforeQuit,
  } = deps;

  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, commandLine) => {
    onSecondInstance(commandLine);
  });

  app.whenReady().then(async () => {
    perfTraceMark("app-whenReady");

    if (bridgeBroadcaster) {
      bridgeBroadcaster.start(() => ({
        available: true,
        consecutiveFailures: 0,
        lastErrorMessage: null,
        lastUpdated: Date.now(),
      }));
      app.on("before-quit", () => bridgeBroadcaster.stop());
    }

    installAppMenu();
    perfTraceMark("connectors-register-start");
    await registerIpc();
    perfTraceMark("connectors-register-end");

    createMainWindow();
    onWindowCreated?.();

    // First-paint happens once createMainWindow's loadURL/loadFile resolves.
    // Heavy agent-host / harness boot runs concurrently without blocking paint.
    void bootBackgroundServices();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    onBeforeQuit?.();
  });
}
