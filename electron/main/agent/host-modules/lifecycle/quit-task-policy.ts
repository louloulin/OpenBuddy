/**
 * quit-task-policy.ts — Phase 4.5 plan4.md (before-quit active-task guard).
 *
 * Pure decision logic: given a snapshot of active harness tasks, classify
 * whether the quit should proceed, be blocked, or offer the user choices.
 *
 * Reverse-dependency invariant:
 *   This module has NO imports from agent-host.ts, Electron, or IPC.
 *   It depends only on its own `HarnessTaskSnapshot` interface (which mirrors
 *   the real shape returned by `listRunningTasks()` in subagent-runtime.ts).
 *
 * Phase 4.5 spec:
 *   "before-quit: detect active tasks, provide cancel/wait/background-continue
 *   strategies; restore the task list and readiness after the window is
 *   reopened."
 */

/**
 * The narrow shape returned by listRunningTasks() (host-modules/subagent-runtime).
 * Note: HarnessJobView declares `label` but the runtime listRunningTasks()
 * actually returns `description`. This interface reflects the real data shape
 * so quit-task-policy stays in sync without depending on a misleading type.
 */
export interface HarnessTaskSnapshot {
  id: string;
  kind: string;
  description: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  sessionId?: string;
}

/** Tasks in these statuses are considered "active" — they block a clean quit. */
const ACTIVE_TASK_STATUSES = new Set<string>(["running", "stopping"]);

/**
 * How the quit should proceed given the current active-task snapshot.
 * These are the internal classification outcomes, not user-facing choices.
 */
export type QuitPolicyDecision =
  /** No active tasks — quit may proceed immediately. */
  | { kind: "proceed" }
  /** Active tasks exist — caller should show a quit-confirmation dialog. */
  | { kind: "ask_user"; activeTasks: ActiveTask[] };

/** A human-readable snapshot of one active task for the quit dialog. */
export interface ActiveTask {
  id: string;
  kind: string;
  description: string;
  sessionId?: string;
  status: "running" | "stopping";
}

/**
 * Classify a task snapshot for quit-decision purposes.
 *
 * @param tasks  Snapshot from `listRunningTasks()`.
 *                Tasks with done-statuses (completed/killed/failed) are
 *                filtered out — they no longer hold resources.
 * @returns QuitPolicyDecision — either "proceed" or "ask_user".
 *
 * Design rationale:
 *   - "stopping" tasks are included as active because they still hold
 *     a harness fiber until abort completes. Quitting while a task is
 *     stopping would leak that fiber.
 *   - Done tasks are never blocking — they are excluded from the active list.
 *   - The caller (quit-gate.ts) converts this into a native dialog with
 *     a bounded timeout fallback.
 */
export function classifyQuitTasks(
  tasks: ReadonlyArray<HarnessTaskSnapshot>,
): QuitPolicyDecision {
  const active = tasks.filter(
    (t): t is HarnessTaskSnapshot & { status: "running" | "stopping" } =>
      ACTIVE_TASK_STATUSES.has(t.status),
  );

  if (active.length === 0) {
    return { kind: "proceed" };
  }

  return {
    kind: "ask_user",
    activeTasks: active.map((t) => ({
      id: t.id,
      kind: t.kind,
      description: t.description,
      sessionId: t.sessionId,
      status: t.status,
    })),
  };
}

/**
 * Format active tasks for a quit-confirmation dialog body.
 * Used by the quit gate to build the native dialog message.
 *
 * @param activeTasks  From classifyQuitTasks() result.activeTasks.
 * @param maxItems     Maximum tasks to list before truncating (default 5).
 * @returns A human-readable string suitable for a dialog message body.
 */
export function formatQuitDialogBody(
  activeTasks: ActiveTask[],
  maxItems = 5,
): string {
  if (activeTasks.length === 0) return "没有正在运行的任务。";

  const items = activeTasks.slice(0, maxItems);
  const lines = items.map(
    (t) =>
      `• ${t.description || t.id} (${
        t.status === "running" ? "运行中" : "正在停止"
      })`,
  );

  if (activeTasks.length > maxItems) {
    lines.push(`…还有 ${activeTasks.length - maxItems} 个任务`);
  }

  return (
    `有 ${activeTasks.length} 个任务正在运行：\n` +
    lines.join("\n") +
    "\n\n选择操作："
  );
}

/** Quit-decision options shown to the user (button indices map to QuitDecision). */
export const QUIT_DECISION_OPTIONS = {
  /** "取消退出" — veto the quit entirely, keep app running. */
  CANCEL: "cancel" as const,
  /** "强制退出（终止任务）" — abort active tasks then quit. */
  FORCE: "force" as const,
  /** "后台继续" — keep app alive in background, close window, drain tasks. */
  BACKGROUND: "background" as const,
} as const;

export type QuitDecision =
  (typeof QUIT_DECISION_OPTIONS)[keyof typeof QUIT_DECISION_OPTIONS];

/**
 * Whether a quit decision is "blocking" (vetoes the quit) or "proceeding".
 * Used by the quit gate to decide whether to call event.preventDefault().
 */
export function isBlockingDecision(decision: QuitDecision): boolean {
  return decision === QUIT_DECISION_OPTIONS.CANCEL;
}

/**
 * Whether a quit decision should abort running tasks before quitting.
 * Force-quit aborts all active tasks; cancel and background do not.
 */
export function shouldAbortTasksOnQuit(decision: QuitDecision): boolean {
  return decision === QUIT_DECISION_OPTIONS.FORCE;
}

/**
 * Whether a quit decision should keep the app alive in the background
 * (close window, stay in process, drain tasks).
 */
export function isBackgroundQuit(decision: QuitDecision): boolean {
  return decision === QUIT_DECISION_OPTIONS.BACKGROUND;
}
