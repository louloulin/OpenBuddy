/**
 * quit-gate.ts — Phase 4.5 plan4.md (before-quit active-task guard).
 *
 * Main-process quit guard: intercepts the Electron "before-quit" event,
 * queries active harness tasks, and either proceeds with disposal or
 * blocks with a native quit-confirmation dialog.
 *
 * Three user choices (native dialog buttons):
 *   1. "取消退出"      — veto the quit entirely.
 *   2. "强制退出"      — abort all active tasks, then quit.
 *   3. "后台继续运行"  — keep app alive, close window only; drain tasks.
 *
 * Background-continue behavior:
 *   The window is closed immediately. `app` stays alive (non-darwin
 *   platform: we prevent `window-all-closed` from calling `app.quit()`).
 *   The app will quit on the next explicit quit request or when the
 *   last active task drains (tracked by watching listActiveTasks until empty).
 *
 * Task abortion on force-quit:
 *   Each active task's id is passed to killTask so the harness fiber is
 *   torn down cleanly before dispose() runs.
 *
 * Timeout fallback:
 *   If the user dismisses the dialog without choosing (e.g. click X),
 *   Electron sends "closed" with buttonIndex -1. We treat that as "cancel"
 *   (veto the quit). After a 30-second timeout (dialog.detachedClose),
 *   we also veto and log a warning.
 *
 * Reverse-dependency invariant:
 *   This module imports from before-quit-handler.ts (the handler it wraps),
 *   harness-subagent-runtime (for killTask), and lifecycle/quit-task-policy.
 *   It does NOT import agent-host.ts directly — all deps are passed in.
 */
import { app, dialog, BrowserWindow } from "electron";
import { installBeforeQuitHandler } from "../bootstrap/before-quit-handler";
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

export interface QuitGateDeps {
  /**
   * Snapshot of currently active harness tasks.
   * Called synchronously at before-quit time.
   */
  listActiveTasks: () => HarnessTaskSnapshot[];
  /**
   * Abort one harness task by id.
   * Called for every active task on force-quit.
   */
  killTask: (taskId: string) => Promise<void>;
  /**
   * Lifecycle disposal — must flush all Pi sessions, Cordis services,
   * and release the harness. Same thunk used by the original before-quit
   * handler before this gate was introduced.
   */
  dispose: () => Promise<void>;
  /**
   * Return the main BrowserWindow (or null if not yet created).
   * Used to close the window on background-continue quit.
   * Falls back to BrowserWindow.getAllWindows()[0] when omitted.
   */
  getMainWindow?: () => BrowserWindow | null;
  /**
   * Callback invoked when the quit gate decides to keep the app alive
   * (user chose "cancel" or background-continue).
   * Allows the caller to restore readiness signals for the reopened window.
   */
  onQuitVetoed?: (decision: "cancel" | "background") => void;
}

/** Installs the quit gate, replacing the plain before-quit handler. */
export function installQuitGate(deps: QuitGateDeps): void {
  const { listActiveTasks, killTask, dispose, getMainWindow: getMainWindow_, onQuitVetoed } = deps;
  const getMainWindow = getMainWindow_ ?? (() => BrowserWindow.getAllWindows()[0] ?? null);

  installBeforeQuitHandler({
    dispose: async () => {
      const tasks = listActiveTasks();
      const policy = classifyQuitTasks(tasks);

      if (policy.kind === "proceed") {
        // No active tasks — go straight to disposal.
        await dispose();
        return;
      }

      // Active tasks exist — show native quit-confirmation dialog.
      const { decision, timedOut } = await showQuitDialog(policy.activeTasks);

      if (timedOut) {
        // Timeout: veto the quit, let the app stay alive.
        console.warn("[quit-gate] dialog timed out — vetoing quit");
        onQuitVetoed?.("cancel");
        // Do NOT dispose; re-enable quit for the next attempt.
        rearmQuitForRetry();
        return;
      }

      if (isBlockingDecision(decision)) {
        // User chose "cancel" — veto the quit, keep app alive.
        onQuitVetoed?.("cancel");
        rearmQuitForRetry();
        return;
      }

      if (isBackgroundQuit(decision)) {
        // User chose "后台继续" — close window but keep app alive.
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.close();
        } else {
          // No window yet or already destroyed — nothing to close.
          // App stays alive either way.
        }
        // Keep app alive. Monitor tasks; quit when all drain.
        onQuitVetoed?.("background");
        monitorTasksForBackgroundDrain(listActiveTasks, async () => {
          // All tasks drained — quit now.
          console.log("[quit-gate] background tasks drained, initiating quit");
          void dispose().then(() => app.exit(0));
        });
        return;
      }

      // Force-quit: abort all active tasks then dispose.
      if (shouldAbortTasksOnQuit(decision)) {
        const active = policy.activeTasks;
        console.log(`[quit-gate] force-quit: aborting ${active.length} active task(s)`);
        await Promise.allSettled(active.map((t) => killTask(t.id)));
      }

      await dispose();
    },
  });
}

/** Re-arm the before-quit handler after a veto so the user can try again. */
function rearmQuitForRetry(): void {
  // The module-level singleton inside before-quit-handler.ts tracks its own
  // "quitting / disposedForQuit" state. After a veto (cancel/background) we
  // need to reset those flags so the next before-quit is processed again.
  // We import and call the test-reset helper — this is intentional; the
  // production re-arm path also needs this reset.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { __resetBeforeQuitHandlerForTest } = require("../bootstrap/before-quit-handler");
  __resetBeforeQuitHandlerForTest();
}

// ---------------------------------------------------------------------------
// Native dialog (platform-appropriate)
// ---------------------------------------------------------------------------

interface QuitDialogResult {
  decision: QuitDecision;
  timedOut: boolean;
}

async function showQuitDialog(
  activeTasks: ReadonlyArray<{ id: string; description: string; status: string }>,
): Promise<QuitDialogResult> {
  const body = formatQuitDialogBody(activeTasks as never);

  const DIALOG_TIMEOUT_MS = 30_000;

  return new Promise<QuitDialogResult>((resolve) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ decision: QUIT_DECISION_OPTIONS.CANCEL, timedOut: true });
      }
    }, DIALOG_TIMEOUT_MS);

    // Determine button order: "Cancel" first (veto) then action buttons.
    // Electron shows buttons in reverse label order (last button is primary).
    // We want the primary button to be the safest choice (Cancel / 后台继续).
    // Button indices: 0=CANCEL, 1=FORCE, 2=BACKGROUND (primary).
    const result = dialog.showMessageBoxSync({
      type: "warning",
      title: "有任务正在运行",
      message: body,
      buttons: [
        "强制退出（终止任务）",
        "后台继续运行",
        "取消退出",
      ],
      // Default to "Cancel" (last button = index 2).
      // Escape and X → cancelId = 2 → treated as cancel.
      defaultId: 2,
      cancelId: 2,
    });

    clearTimeout(timeout);

    if (finished) return; // timed-out resolved first
    finished = true;

    // Electron button order: 0=first button, 1=second, 2=third.
    const decision: QuitDecision =
      result === 2
        ? QUIT_DECISION_OPTIONS.CANCEL
        : result === 0
          ? QUIT_DECISION_OPTIONS.FORCE
          : QUIT_DECISION_OPTIONS.BACKGROUND;

    resolve({ decision, timedOut: false });
  });
}

// ---------------------------------------------------------------------------
// Background-drain monitor
// ---------------------------------------------------------------------------

function monitorTasksForBackgroundDrain(
  listActiveTasks: () => HarnessTaskSnapshot[],
  onAllDrained: () => void,
): void {
  const INTERVAL_MS = 1_000;

  const interval = setInterval(() => {
    const tasks = listActiveTasks();
    const active = tasks.filter((t) => t.status === "running" || t.status === "stopping");
    if (active.length === 0) {
      clearInterval(interval);
      onAllDrained();
    }
  }, INTERVAL_MS);

  // Stop monitoring if app is already quitting for another reason.
  app.once("before-quit", () => {
    clearInterval(interval);
  });
}
