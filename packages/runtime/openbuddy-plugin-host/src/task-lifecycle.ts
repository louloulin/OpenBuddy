export const taskStatuses = [
  "draft", "queued", "running", "awaiting_approval", "completed", "failed", "retrying", "cancelled", "paused",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export interface TaskLifecycleState {
  taskId: string;
  sessionId: string;
  workspaceId?: string;
  generation: number;
  status: TaskStatus;
  updatedAt: string;
}

export type TaskLifecycleEvent =
  | "queue" | "start" | "approval_required" | "approve" | "complete" | "fail"
  | "retry" | "cancel" | "pause" | "resume";

const transitions: Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskLifecycleEvent, TaskStatus>>>>> = {
  draft: { queue: "queued", cancel: "cancelled" },
  queued: { start: "running", cancel: "cancelled" },
  running: { approval_required: "awaiting_approval", complete: "completed", fail: "failed", cancel: "cancelled", pause: "paused" },
  awaiting_approval: { approve: "running", cancel: "cancelled" },
  failed: { retry: "retrying", cancel: "cancelled" },
  retrying: { start: "running", cancel: "cancelled" },
  paused: { resume: "queued", cancel: "cancelled" },
  completed: {},
  cancelled: {},
};

export class TaskLifecycleError extends Error {
  readonly code = "invalid_task_transition" as const;
  constructor(readonly from: TaskStatus, readonly event: TaskLifecycleEvent) {
    super(`task cannot transition from ${from} via ${event}`);
    this.name = "TaskLifecycleError";
  }
}

export function transitionTask(state: TaskLifecycleState, event: TaskLifecycleEvent, updatedAt: string): TaskLifecycleState {
  if (!state.taskId || !state.sessionId) throw new Error("taskId and sessionId are required");
  if (!Number.isSafeInteger(state.generation) || state.generation < 0) throw new Error("task generation is invalid");
  const next = transitions[state.status][event];
  if (!next) throw new TaskLifecycleError(state.status, event);
  return { ...state, status: next, updatedAt };
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function canRecoverTask(state: Pick<TaskLifecycleState, "status" | "generation">, currentGeneration: number): boolean {
  return state.generation === currentGeneration && (state.status === "queued" || state.status === "paused" || state.status === "failed" || state.status === "retrying");
}
