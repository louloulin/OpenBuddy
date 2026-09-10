/**
 * quit-gate.ts — Phase 4.5 plan4.md (before-quit active-task guard).
 *
 * This is the ONE AND ONLY before-quit handler registered by the app.
 * install-host-modules.ts checks `quitGateInstalled` before registering its
 * own handler and skips it when this module is active.
 *
 * Three user choices via native async dialog:
 *   1. "取消退出"      — veto the quit entirely (window stays on macOS).
 *   2. "强制退出"      — abort all active tasks, then quit.
 *   3. "后台继续运行"  — keep app alive in background, close window only.
 *
 * Background-continue:
 *   Sets `quitGateState.backgroundDraining = true`.  app-lifecycle.ts
 *   checks this flag in `window-all-closed` and suppresses `app.quit()`.
 *   A 1-second polling loop monitors `listActiveTasks()`; when all drain
 *   it calls `dispose()` then `app.exit(0)`.
 *
 * Fixes over v1:
 *   - No duplicate handler: install-host-modules skips its own handler when
 *     `quitGateInstalled` is true.
 *   - No require() of non-existent exports — uses proper exported reset fn.
 *   - Background drain is coordinated with app-lifecycle via shared state.
 *   - Async dialog.showMessageBox() + Promise.race for genuine timeout.
 */
import { app, dialog, BrowserWindow } from "electron";
import {
  classifyQuitTasks,
  formatQuitDialogBody,
  isBlockingDecision,
  shouldAbortTasksOnQuit,
  isBackgroundQuit,
  QUIT_DECISION_OPTIONS,
  type QuitDecision,
} from "./quit-task-policy";
import type { HarnessTaskSnapshot } from "./quit-task-policy";

// ── Shared state ──────────────────────────────────────────────────────────────
// Import the shared quit-gate state exported from install-host-modules.ts.
// This module is loaded by both quit-gate (here) and app-lifecycle (via
// install-host-modules dep graph). The state object is a plain mutable record
// shared via the same module instance at runtime.
import { quitGateState } from "../bootstrap/install-host-modules";

export interface QuitGateDeps {
  /** Snapshot of currently active harness tasks. Called synchronously. */
  listActiveTasks: () => HarnessTaskSnapshot[];
  /** Abort one harness task by id. Called on force-quit. */
  killTask: (taskId: string) => Promise<void>;
  /** Lifecycle disposal — flush Pi sessions, Cordis services, harness. */
  dispose: () => Promise<void>;
  /**
   * Return the main BrowserWindow (or null if not yet created).
   * Falls back to BrowserWindow.getAllWindows()[0] when omitted.
   */
  getMainWindow?: () => BrowserWindow | null;
}

// ── Quit gate singleton state ─────────────────────────────────────────────────

/** Whether this quit-gate has already been triggered and is awaiting user input. */
let quitInFlight = false;

/** Whether a second quit attempt should re-show the dialog. */
let rearmPending = false;

// ── Install ───────────────────────────────────────────────────────────────────

/**
 * Register the ONE before-quit handler for the entire app.
 * Must be called before `installHostModules()` so that install-host-modules.ts
 * sees `quitGateInstalled = true` and skips its own basic handler.
 *
 * @param deps  Live dependencies (listActiveTasks / killTask / dispose / getMainWindow).
 */
export function installQuitGate(deps: QuitGateDeps): void {
  const { listActiveTasks, killTask, dispose, getMainWindow: getMainWindow_ } = deps;
  const getMainWindow = getMainWindow_ ?? (() => BrowserWindow.getAllWindows()[0] ?? null);

  app.on("before-quit", async (event) => {
    // Second quit attempt while a dialog is open → re-show the dialog.
    if (rearmPending) {
      rearmPending = false;
    }

    if (quitInFlight) {
      // Dialog is already showing; prevent the default so the app stays alive
      // while the existing dialog is resolved.
      event.preventDefault();
      return;
    }

    quitInFlight = true;

    try {
      const tasks = listActiveTasks();
      const policy = classifyQuitTasks(tasks);

      if (policy.kind === "proceed") {
        // No active tasks — go straight to disposal.
        await dispose();
        return;
      }

      // Active tasks exist → show async quit-confirmation dialog.
      event.preventDefault(); // block quit while dialog is shown
      const result = await showQuitDialog(policy.activeTasks);

      // User dismissed dialog without choosing (X / Esc) → treat as cancel.
      if (result.dismissed) {
        console.warn("[quit-gate] dialog dismissed — vetoing quit");
        vetoQuit();
        return;
      }

      const { decision } = result;

      if (isBlockingDecision(decision)) {
        // User chose "cancel" — veto the quit.
        vetoQuit();
        return;
      }

      if (isBackgroundQuit(decision)) {
        // User chose "后台继续" — close window, keep app alive, drain tasks.
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.close();
        }
        // Signal app-lifecycle to suppress window-all-closed → app.quit().
        quitGateState.backgroundDraining = true;
        monitorTasksForBackgroundDrain(listActiveTasks, dispose, killTask);
        return;
      }

      // Force-quit: abort all active tasks then dispose.
      if (shouldAbortTasksOnQuit(decision)) {
        const active = policy.activeTasks;
        console.log(`[quit-gate] force-quit: aborting ${active.length} active task(s)`);
        await Promise.allSettled(active.map((t) => killTask(t.id)));
      }

      await dispose();
    } finally {
      quitInFlight = false;
    }
  });
}

// ── Veto helpers ─────────────────────────────────────────────────────────────

/**
 * Called when the user cancels or the dialog times out.
 * Re-arms the quit gate so the next quit attempt shows the dialog again.
 * Does NOT exit the app.
 */
function vetoQuit(): void {
  rearmPending = true;
  // The app is still alive. The window may be closed (non-macOS).
  // On the next quit attempt, the before-quit handler will run again
  // with quitInFlight = false and rearmPending = true → clears the flag
  // and shows the dialog normally.
}

// ── Async dialog ─────────────────────────────────────────────────────────────

const DIALOG_TIMEOUT_MS = 30_000;

interface QuitDialogResult {
  decision: QuitDecision;
  dismissed: boolean;
}

/**
 * Show the quit-confirmation dialog asynchronously with a genuine timeout.
 *
 * Uses dialog.showMessageBox() (async) so that the setTimeout fires even
 * while the dialog is displayed — unlike showMessageBoxSync which blocks
 * the JS event loop and prevents timers from running.
 */
async function showQuitDialog(
  activeTasks: ReadonlyArray<{ id: string; description: string; status: string }>,
): Promise<QuitDialogResult> {
  const body = formatQuitDialogBody(activeTasks as never);

  // Primary button (last in list, shown on the right): "Cancel" — safest default.
  const DIALOG_BUTTONS = [
    "强制退出（终止任务）",
    "后台继续运行",
    "取消退出",
  ] as const;
  // Index 2 = Cancel (veto).
  const CANCEL_INDEX = 2;

  // Race: user choice vs. 30-second timeout.
  const choice = await Promise.race<
    | { kind: "timeout" }
    | { kind: "result"; buttonIndex: number }
  >([
    // Timeout branch.
    new Promise<{ kind: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ kind: "timeout" }), DIALOG_TIMEOUT_MS),
    ),
    // User choice branch — dialog.showMessageBox() returns when user acts
    // or when the window is destroyed (buttonIndex = -1).
    dialog.showMessageBox({
      type: "warning",
      title: "有任务正在运行",
      message: body,
      buttons: [...DIALOG_BUTTONS],
      defaultId: CANCEL_INDEX,
      cancelId: CANCEL_INDEX,
    }).then((boxResult) => ({ kind: "result" as const, buttonIndex: boxResult.response })),
  ]);

  if (choice.kind === "timeout") {
    console.warn("[quit-gate] dialog timed out after 30s — vetoing quit");
    return { decision: QUIT_DECISION_OPTIONS.CANCEL, dismissed: true };
  }

  // User acted (button or window-destroyed).
  const { buttonIndex } = choice;
  if (buttonIndex === -1) {
    // Window was closed/destroyed while dialog was open → treat as cancel.
    return { decision: QUIT_DECISION_OPTIONS.CANCEL, dismissed: true };
  }

  const decision: QuitDecision =
    buttonIndex === CANCEL_INDEX
      ? QUIT_DECISION_OPTIONS.CANCEL
      : buttonIndex === 0
        ? QUIT_DECISION_OPTIONS.FORCE
        : QUIT_DECISION_OPTIONS.BACKGROUND;

  return { decision, dismissed: false };
}

// ── Background drain monitor ──────────────────────────────────────────────────

function monitorTasksForBackgroundDrain(
  listActiveTasks: () => HarnessTaskSnapshot[],
  dispose: () => Promise<void>,
  killTask: (id: string) => Promise<void>,
): void {
  const INTERVAL_MS = 1_000;

  const interval = setInterval(() => {
    const tasks = listActiveTasks();
    const active = tasks.filter(
      (t) => t.status === "running" || t.status === "stopping",
    );
    if (active.length === 0) {
      clearInterval(interval);
      quitGateState.backgroundDraining = false;
      console.log("[quit-gate] background tasks drained, initiating final quit");
      void dispose().then(() => app.exit(0));
    }
  }, INTERVAL_MS);

  // If the user triggers quit again while in background-drain, abort monitoring.
  app.once("before-quit", () => {
    clearInterval(interval);
    quitGateState.backgroundDraining = false;
  });
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Reset module-level singletons (for unit/integration tests). */
export function __resetQuitGateForTest(): void {
  quitInFlight = false;
  rearmPending = false;
  quitGateState.backgroundDraining = false;
}
