/**
 * task-lifecycle-service.ts — Phase 2.1 (plan3.0.md §6) workbench task
 * lifecycle owner.
 *
 * Wraps the `TaskLifecycleStore` contract from `@openbuddy/plugin-host`
 * (transition validation + generation fence) with the canonical OpenBuddy
 * SQLite persistence adapter, and mounts it as a Cordis service so the
 * product layer stops owning an unowned second copy of task state.
 *
 * Recovery semantics (plan3.0.md §6 Phase 2.1.2): a task whose bound Pi
 * session no longer exists must produce an *actionable* recovery outcome
 * (`session_missing` + next action), never a silent empty result.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  canRecoverTask,
  createTaskLifecycleStore,
  isTaskTerminal,
  taskStatuses,
  type TaskLifecycleEvent,
  type TaskLifecyclePersistence,
  type TaskLifecycleState,
  type TaskLifecycleStore,
  type TaskStatus,
} from "@openbuddy/plugin-host";
import { SqliteTaskLifecyclePersistence } from "../task-lifecycle-sqlite";

/** Task states a task may be born in. Terminal states are reached, never created. */
const initialTaskStatuses: ReadonlySet<TaskStatus> = new Set<TaskStatus>(
  taskStatuses.filter((status) => !isTaskTerminal(status)),
);

/** Mirrors the recoverable set inside `canRecoverTask` — used only to
 *  attribute a more precise reason when the fence rejects recovery. */
const recoverableStatuses: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["queued", "paused", "failed", "retrying"]);

export type TaskRecoveryOutcome =
  | { kind: "recovered"; state: TaskLifecycleState }
  | {
      kind: "not_recoverable";
      reason: "not_found" | "generation_mismatch" | "status_not_recoverable" | "terminal_status";
      state?: TaskLifecycleState;
    }
  | { kind: "session_missing"; state: TaskLifecycleState; action: "rebind_session_or_restart" };

export type TaskLifecycleSessionResolver = (sessionId: string) => Promise<boolean>;

export interface TaskLifecycleServiceOptions {
  /** Resolves whether a task's bound Pi session still exists. When omitted,
   *  recovery treats the binding as unverifiable and does not block on it. */
  sessionExists?: TaskLifecycleSessionResolver;
}

export interface CreateTaskInput {
  taskId?: string;
  sessionId: string;
  workspaceId?: string;
  generation?: number;
  status?: TaskStatus;
}

export class TaskLifecycleService {
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly store: TaskLifecycleStore,
    private readonly persistence: TaskLifecyclePersistence,
    private readonly options: TaskLifecycleServiceOptions = {},
  ) {}

  async createTask(input: CreateTaskInput): Promise<TaskLifecycleState> {
    this.assertOpen();
    const taskId = input.taskId ?? `worktask-${randomUUID()}`;
    const sessionId = input.sessionId;
    if (!sessionId) throw new Error("sessionId is required");
    const status: TaskStatus = input.status ?? "draft";
    if (!initialTaskStatuses.has(status)) {
      throw new Error(`task cannot be created with terminal status ${status}`);
    }
    const generation = input.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new Error("task generation is invalid");
    }
    const state: TaskLifecycleState = {
      taskId,
      sessionId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      generation,
      status,
      updatedAt: new Date().toISOString(),
    };
    return await this.store.create(state);
  }

  async getTask(taskId: string): Promise<TaskLifecycleState | null> {
    this.assertOpen();
    return await this.store.get(taskId);
  }

  async transitionTask(taskId: string, event: TaskLifecycleEvent): Promise<TaskLifecycleState> {
    this.assertOpen();
    return await this.store.transition(taskId, event, new Date().toISOString());
  }

  /**
   * Cold-start / resume recovery. Combines the store's generation fence with
   * the task→session binding check, returning an actionable outcome instead
   * of a bare null so the UI can route the user to a recovery flow.
   */
  async recoverTask(taskId: string, currentGeneration: number): Promise<TaskRecoveryOutcome> {
    this.assertOpen();
    const state = await this.store.get(taskId);
    if (!state) return { kind: "not_recoverable", reason: "not_found" };
    if (isTaskTerminal(state.status)) {
      return { kind: "not_recoverable", reason: "terminal_status", state };
    }
    if (!canRecoverTask(state, currentGeneration)) {
      const reason = recoverableStatuses.has(state.status) ? "generation_mismatch" : "status_not_recoverable";
      return { kind: "not_recoverable", reason, state };
    }
    if (this.options.sessionExists) {
      const exists = await this.options.sessionExists(state.sessionId);
      if (!exists) {
        return { kind: "session_missing", state, action: "rebind_session_or_restart" };
      }
    }
    return { kind: "recovered", state };
  }

  /** Release the SQLite driver when the owning Cordis plugin is torn down. */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (this.persistence as { close?: () => Promise<void> }).close?.() ?? Promise.resolve();
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("task lifecycle service is closed");
  }
}

export function createTaskLifecycleService(
  persistence: TaskLifecyclePersistence & { close?: () => Promise<void> },
  options: TaskLifecycleServiceOptions = {},
): TaskLifecycleService {
  return new TaskLifecycleService(createTaskLifecycleStore(persistence), persistence, options);
}

/**
 * Build a TaskLifecycleService over the current user's app-data folder,
 * mirroring the `core-session` SQLite path used by TaskService so the two
 * task stores stay on one database.
 */
export function defaultTaskLifecycleService(options: TaskLifecycleServiceOptions = {}): TaskLifecycleService {
  const dbPath = join(
    process.env.OPENBUDDY_DATA_DIR ?? join(homedir(), ".config", "openbuddy"),
    "sessions.db",
  );
  return createTaskLifecycleService(new SqliteTaskLifecyclePersistence(dbPath), options);
}