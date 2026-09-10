import type { ComposerEnvelope } from "./composer-envelope";
export const taskStatuses = [
  "draft", "queued", "running", "awaiting_approval", "completed", "failed", "retrying", "cancelled", "paused",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export interface TaskArtifact {
  artifactId: string;
  kind: string;
  title: string;
  uri?: string;
  digest: string;
}

export interface TaskCitation {
  citationId: string;
  artifactId: string;
  locator?: string;
  confidence?: number;
}
export interface TaskApprovalState {
  approvalId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
}
export interface TaskLifecycleState {
  taskId: string;
  sessionId: string;
  workspaceId?: string;
  generation: number;
  status: TaskStatus;
  updatedAt: string;
  composerEnvelope?: ComposerEnvelope;
  approval?: TaskApprovalState;
  artifacts?: readonly TaskArtifact[];
  citations?: readonly TaskCitation[];
}

export type TaskLifecycleEvent =
  | "queue" | "start" | "approval_required" | "approve" | "complete" | "fail"
  | "retry" | "cancel" | "pause" | "resume" | "reject";

const transitions: Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskLifecycleEvent, TaskStatus>>>>> = {
  draft: { queue: "queued", cancel: "cancelled" },
  queued: { start: "running", cancel: "cancelled" },
  running: { approval_required: "awaiting_approval", complete: "completed", fail: "failed", cancel: "cancelled", pause: "paused" },
  awaiting_approval: { approve: "running", reject: "cancelled", cancel: "cancelled" },
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
  decideApproval(taskId: string, decision: "approved" | "rejected", decidedAt: string): Promise<TaskLifecycleState>;
  recover(taskId: string, currentGeneration: number): Promise<TaskLifecycleState | null>;
  appendArtifact(taskId: string, artifact: TaskArtifact): Promise<TaskLifecycleState>;
  appendCitation(taskId: string, citation: TaskCitation): Promise<TaskLifecycleState>;
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
      return state ? {
        ...state,
        ...(state.composerEnvelope ? { composerEnvelope: { ...state.composerEnvelope, attachments: [...state.composerEnvelope.attachments], references: [...state.composerEnvelope.references] } } : {}),
        ...(state.approval ? { approval: { ...state.approval } } : {}),
        ...(state.artifacts ? { artifacts: [...state.artifacts] } : {}),
        ...(state.citations ? { citations: [...state.citations] } : {}),
      } : null;
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
    decideApproval(taskId, decision, decidedAt) {
      return enqueue(async () => {
        const current = await persistence.read(taskId);
        if (!current) throw new Error(`task ${taskId} does not exist`);
        if (!current.approval || current.approval.status !== "pending") throw new Error(`task ${taskId} has no pending approval`);
        const nextStatus: "approved" | "rejected" = decision === "approved" ? "approved" : "rejected";
        const next = transitionTask(current, decision === "approved" ? "approve" : "reject", decidedAt);
        const updated = { ...next, approval: { ...current.approval, status: nextStatus, decidedAt }, updatedAt: decidedAt };
        await persistence.write(updated);
        return updated;
      });
    },
    recover(taskId, currentGeneration) {
      return enqueue(async () => {
        const state = await persistence.read(taskId);
        if (!state || !canRecoverTask(state, currentGeneration)) return null;
        return { ...state };
      });
    },
    appendArtifact(taskId, artifact) {
      return enqueue(async () => {
        const current = await persistence.read(taskId);
        if (!current) throw new Error(`task ${taskId} does not exist`);
        const next = { ...current, artifacts: [...(current.artifacts ?? []), { ...artifact }], updatedAt: new Date().toISOString() };
        await persistence.write(next);
        return next;
      });
    },
    appendCitation(taskId, citation) {
      return enqueue(async () => {
        const current = await persistence.read(taskId);
        if (!current) throw new Error(`task ${taskId} does not exist`);
        if (!(current.artifacts ?? []).some((artifact) => artifact.artifactId === citation.artifactId)) throw new Error(`artifact ${citation.artifactId} does not exist`);
        const next = { ...current, citations: [...(current.citations ?? []), { ...citation }], updatedAt: new Date().toISOString() };
        await persistence.write(next);
        return next;
      });
    },
  };
}
