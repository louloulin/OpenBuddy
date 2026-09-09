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

export interface TaskLifecyclePersistence {
  read(taskId: string): Promise<TaskLifecycleState | null>;
  write(state: TaskLifecycleState): Promise<void>;
}

export interface TaskLifecycleStore {
  create(state: TaskLifecycleState): Promise<TaskLifecycleState>;
  get(taskId: string): Promise<TaskLifecycleState | null>;
  transition(taskId: string, event: TaskLifecycleEvent, updatedAt: string): Promise<TaskLifecycleState>;
  recover(taskId: string, currentGeneration: number): Promise<TaskLifecycleState | null>;
}

/**
 * Write-through task state boundary. Product storage supplies the persistence
 * adapter; this module owns transition validation and recovery fencing.
 */
export function createTaskLifecycleStore(persistence: TaskLifecyclePersistence): TaskLifecycleStore {
  let mutation: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    create(state) {
      return enqueue(async () => {
        if (!state.taskId || !state.sessionId) throw new Error("taskId and sessionId are required");
        const existing = await persistence.read(state.taskId);
        if (existing) throw new Error(`task ${state.taskId} already exists`);
        await persistence.write({ ...state });
        return { ...state };
      });
    },
    async get(taskId) {
      const state = await persistence.read(taskId);
      return state ? { ...state } : null;
    },
    transition(taskId, event, updatedAt) {
      return enqueue(async () => {
        const current = await persistence.read(taskId);
        if (!current) throw new Error(`task ${taskId} does not exist`);
        const next = transitionTask(current, event, updatedAt);
        await persistence.write(next);
        return { ...next };
      });
    },
    async recover(taskId, currentGeneration) {
      const state = await persistence.read(taskId);
      if (!state || !canRecoverTask(state, currentGeneration)) return null;
      return { ...state };
    },
  };
}
