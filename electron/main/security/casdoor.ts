/**
 * security/casdoor.ts — Casdoor protocol + status broadcast layer.
 *
 * Phase 8.3 §40: extracted from electron/main/index.ts so the Electron
 * main entry stays focused on app-lifecycle orchestration. The previous
 * inline implementation had 4 functions (casdoorScope,
 * publishCasdoorStatus, processCasdoorProtocol, handleCasdoorProtocol)
 * and 3 pieces of state (casdoorInitialized, pendingCasdoorUrls,
 * lastCasdoorScope, lifecycleQueue) that all belonged together — they
 * form a small state machine for "did casdoor finish initializing, and
 * what URL callbacks arrived before that?".
 *
 * Why a controller object (not module-level singletons):
 *   - The state is per-app-instance, not per-process — Electron tests
 *     launch fresh app instances via --user-data-dir and would otherwise
 *     cross-contaminate if we exported a module-level singleton.
 *   - index.ts already owns mainWindow + harnessServer as locals, so a
 *     parallel casdoorController local is consistent with that pattern.
 *
 * Reverse-dependency invariant:
 *   This module does NOT import from index.ts. It imports:
 *   - electron (BrowserWindow for the webContents send)
 *   - @openbuddy/auth-casdoor (types)
 *   - ./workbench-scope (the scope helper that was already extracted)
 *   - ../casdoor/casdoor-auth (the actual Casdoor client)
 */
import { app, type BrowserWindow } from "electron";
import { casdoorAuth } from "../casdoor/casdoor-auth";
import { workbenchScopeKey } from "./workbench-scope";
import type { CasdoorLifecycleEvent, CasdoorLifecycleKind } from "@openbuddy/auth-casdoor";

/**
 * Dependencies the casdoor controller needs from index.ts.
 *
 * `getMainWindow` is a callback (not the window itself) because the
 * main window is created later, after whenReady, and may be replaced
 * (e.g. on macOS `activate` events).
 *
 * `syncWorkbenchScope` / `bindCurrentSessionToTenant` come from the
 * agent-host facade, which is lazy-loaded by index.ts after this
 * controller is created. They're resolved on every call so the
 * controller never sees a stale `null` agentHost reference.
 */
export interface CasdoorSecurityDeps {
  getMainWindow: () => BrowserWindow | null;
  syncWorkbenchScope: (force?: boolean) => Promise<void>;
  bindCurrentSessionToTenant: () => void | Promise<void>;
}

/**
 * Controller returned by initCasdoorSecurity(). index.ts holds the
 * reference and calls into it; the controller owns its private state.
 */
export interface CasdoorSecurityController {
  casdoorScope: () => string;
  publishCasdoorStatus: () => void;
  processCasdoorProtocol: (url: string) => void;
  handleCasdoorProtocol: (url: string) => void;
  /** Mark casdoor as initialized; flush any pending URLs collected before init. */
  markInitialized: () => void;
  /** Update lastCasdoorScope from index.ts after agentHost.syncWorkbenchScope. */
  setLastScope: (scope: string) => void;
  /** Read lastCasdoorScope; used by index.ts when building lifecycle events. */
  getLastScope: () => string | undefined;
  /**
   * Append a task to the lifecycle queue so casdoor status updates are
   * serialized instead of racing each other. Returns a Promise that
   * resolves when the appended task settles.
   */
  appendLifecycle: <T>(task: () => Promise<T>) => Promise<T>;
  /** Wire a status listener that publishes lifecycle events to the renderer. */
  setStatusListener: () => void;
}

/**
 * Initialize the casdoor security layer. Idempotent — calling it twice
 * resets the pending URL queue but preserves the listener wiring.
 *
 * Returns the controller object that index.ts uses to wire casdoor into
 * the rest of the app lifecycle (status broadcasts, protocol URLs,
 * lifecycle events).
 */
export function initCasdoorSecurity(deps: CasdoorSecurityDeps): CasdoorSecurityController {
  let casdoorInitialized = false;
  const pendingCasdoorUrls: string[] = [];
  let lastCasdoorScope: string | undefined;
  let lifecycleQueue: Promise<void> = Promise.resolve();

  function casdoorScope(): string {
    const status = casdoorAuth.status();
    return workbenchScopeKey({
      configured: status.config.configured,
      tenantId: status.tenantContext.activeTenantId,
      subject: status.identity?.subject,
    });
  }

  function publishCasdoorStatus(): void {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("casdoor://auth", casdoorAuth.status());
    }
  }

  function processCasdoorProtocol(url: string): void {
    const normalizedUrl = url.replace(/^casdoor:/i, "casdoor:");
    if (!normalizedUrl.startsWith("casdoor://")) return;
    void casdoorAuth.handleCallback(normalizedUrl).then(() => {
      return deps.syncWorkbenchScope();
    }).then(() => {
      void deps.bindCurrentSessionToTenant();
      publishCasdoorStatus();
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }

  function handleCasdoorProtocol(url: string): void {
    const normalizedUrl = url.trim();
    if (!normalizedUrl.toLowerCase().startsWith("casdoor://")) return;
    if (!casdoorInitialized) {
      if (pendingCasdoorUrls.length < 16) pendingCasdoorUrls.push(normalizedUrl);
      return;
    }
    processCasdoorProtocol(normalizedUrl);
  }

  function markInitialized(): void {
    casdoorInitialized = true;
    for (const url of pendingCasdoorUrls.splice(0)) processCasdoorProtocol(url);
  }

  function setLastScope(scope: string): void {
    lastCasdoorScope = scope;
  }

  function getLastScope(): string | undefined {
    return lastCasdoorScope;
  }

  function appendLifecycle<T>(task: () => Promise<T>): Promise<T> {
    const next = lifecycleQueue.then(() => task().catch((error) => {
      console.error("[openbuddy-pi] failed to publish Casdoor lifecycle event:", error);
    }));
    lifecycleQueue = next.then(() => undefined);
    return next as Promise<T>;
  }

  function setStatusListener(): void {
    casdoorAuth.setStatusListener((kind: CasdoorLifecycleKind) => {
      publishCasdoorStatus();
      void appendLifecycle(async () => {
        const previousScope = lastCasdoorScope ?? casdoorScope();
        await deps.syncWorkbenchScope(kind === "session-invalidated" || kind === "config-change");
        const status = casdoorAuth.status();
        const scope = casdoorScope();
        const event: CasdoorLifecycleEvent = {
          kind,
          at: new Date().toISOString(),
          status: status.status,
          scope,
          previousScope,
          scopeChanged: previousScope !== scope,
          ...(status.tenantContext.activeTenantId ? { tenantId: status.tenantContext.activeTenantId } : {}),
        };
        lastCasdoorScope = scope;
        setLastScope(scope);
        const win = deps.getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send("casdoor://lifecycle", event);
      });
    });
  }

  // Register the open-url handler at module init time (macOS only).
  // This matches the original index.ts behavior — register early so
  // URLs delivered before casdoor init are queued, not dropped.
  if (process.platform === "darwin") {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      handleCasdoorProtocol(url);
    });
  }

  return {
    casdoorScope,
    publishCasdoorStatus,
    processCasdoorProtocol,
    handleCasdoorProtocol,
    markInitialized,
    setLastScope,
    getLastScope,
    appendLifecycle,
    setStatusListener,
  };
}
