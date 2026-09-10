/**
 * task-lifecycle-events.ts — append-only audit log for workbench task
 * lifecycle transitions (plan3.0.md §6 Phase 2.1 step "task lifecycle
 * event store").
 *
 * The lifecycle store validates transitions and fences recovery; this
 * event log records *what happened* (who triggered which transition, when,
 * from→to). The two concerns are kept on separate storage namespaces so
 * audit history can be replayed or exported without touching task state.
 */
import { closeStorage, openStorage, type OpenStorageResult } from "@openbuddy/storage";
import type { TaskLifecycleEvent, TaskLifecycleState, TaskStatus } from "@openbuddy/plugin-host";

export const TASK_LIFECYCLE_EVENT_NAMESPACE = "openbuddy.task-lifecycle.events.v1";

export interface TaskLifecycleEventRecord {
  /** Monotonic per-task 1-indexed sequence. */
  sequence: number;
  taskId: string;
  /** Where the task came from. Undefined for the create event. */
  fromStatus?: TaskStatus;
  toStatus: TaskStatus;
  /** The lifecycle event that drove the transition. `"create"` is the
   *  synthetic event recorded for `createTask()`. */
  event: TaskLifecycleEvent | "create";
  /** ISO timestamp from the lifecycle store (same clock as the state). */
  timestamp: string;
  /** Generation snapshot from the state at record time. */
  generation: number;
  /** Optional reason / caller-provided metadata. */
  reason?: string;
}

export interface TaskLifecycleEventLog {
  append(record: Omit<TaskLifecycleEventRecord, "sequence">): Promise<TaskLifecycleEventRecord>;
  list(taskId: string): Promise<TaskLifecycleEventRecord[]>;
  clear(taskId: string): Promise<number>;
}

/* ------------------------------------------------------------------ *
 * In-memory implementation for tests + product code that wants a     *
 * deterministic log (e.g. fake-provider loops).                      *
 * ------------------------------------------------------------------ */

export class InMemoryTaskLifecycleEventLog implements TaskLifecycleEventLog {
  private readonly records = new Map<string, TaskLifecycleEventRecord[]>();

  async append(record: Omit<TaskLifecycleEventRecord, "sequence">): Promise<TaskLifecycleEventRecord> {
    const existing = this.records.get(record.taskId) ?? [];
    const sequence = existing.length + 1;
    const persisted: TaskLifecycleEventRecord = { ...record, sequence };
    existing.push({ ...persisted });
    this.records.set(record.taskId, existing);
    return { ...persisted };
  }

  async list(taskId: string): Promise<TaskLifecycleEventRecord[]> {
    return (this.records.get(taskId) ?? []).map((record) => ({ ...record }));
  }

  async clear(taskId: string): Promise<number> {
    const previous = this.records.get(taskId)?.length ?? 0;
    this.records.delete(taskId);
    return previous;
  }
}

/* ------------------------------------------------------------------ *
 * SQLite-backed implementation on the canonical OpenBuddy storage.   *
 * The store key embeds a zero-padded sequence so a SettingsRegistry  *
 * lexical scan returns the entries in transition order.              *
 * ------------------------------------------------------------------ */

const SEQUENCE_PAD_WIDTH = 12;

function formatKey(taskId: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`event sequence must be a positive safe integer, got ${sequence}`);
  }
  return `${taskId}:${String(sequence).padStart(SEQUENCE_PAD_WIDTH, "0")}`;
}

function parseKey(key: string): { taskId: string; sequence: number } | null {
  const colonIndex = key.indexOf(":");
  if (colonIndex === -1) return null;
  const taskId = key.slice(0, colonIndex);
  const raw = key.slice(colonIndex + 1);
  if (!/^\d+$/.test(raw)) return null;
  const sequence = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(sequence)) return null;
  return { taskId, sequence };
}

export interface SqliteTaskLifecycleEventLogOptions {
  databasePath: string;
}

export class SqliteTaskLifecycleEventLog implements TaskLifecycleEventLog {
  private storage: Promise<OpenStorageResult> | undefined;
  private closed = false;

  constructor(private readonly options: SqliteTaskLifecycleEventLogOptions) {}

  private async store() {
    if (this.closed) throw new Error("task lifecycle event log is closed");
    if (!this.storage) {
      this.storage = openStorage({
        filePath: this.options.databasePath,
        appVersion: "openbuddy-task-lifecycle-events",
      });
    }
    return this.storage;
  }

  async append(record: Omit<TaskLifecycleEventRecord, "sequence">): Promise<TaskLifecycleEventRecord> {
    const opened = await this.store();
    const driver = opened.driver;
    const existing = driver.database.prepare(`
      SELECT setting_key FROM settings WHERE namespace = ?
    `).all(TASK_LIFECYCLE_EVENT_NAMESPACE) as Array<{ setting_key: string }>;
    const prefixKeys = existing.map((row) => row.setting_key).filter((key) => key.startsWith(`${record.taskId}:`));
    let sequence = prefixKeys.length + 1;
    const persisted: TaskLifecycleEventRecord = { ...record, sequence };
    const key = formatKey(persisted.taskId, persisted.sequence);
    await driver.runExclusive((database) => database.prepare(`
      INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(namespace, setting_key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(TASK_LIFECYCLE_EVENT_NAMESPACE, key, JSON.stringify(persisted), new Date().toISOString()));
    return { ...persisted };
  }

  async list(taskId: string): Promise<TaskLifecycleEventRecord[]> {
    const opened = await this.store();
    const rows = opened.driver.database.prepare(`
      SELECT setting_key, value_json FROM settings
      WHERE namespace = ? AND setting_key LIKE ?
      ORDER BY setting_key
    `).all(TASK_LIFECYCLE_EVENT_NAMESPACE, `${taskId}:%`) as Array<{ setting_key: string; value_json: string }>;
    const records: TaskLifecycleEventRecord[] = [];
    for (const row of rows) {
      // Defence in depth: skip foreign keys that don't parse to the right
      // task id even if they survived a malformed write.
      const parsed = parseKey(row.setting_key);
      if (!parsed || parsed.taskId !== taskId) continue;
      try {
        const value = JSON.parse(row.value_json) as TaskLifecycleEventRecord;
        records.push({ ...value });
      } catch {
        /* skip malformed rows rather than corrupt the whole listing */
      }
    }
    return records;
  }

  async clear(taskId: string): Promise<number> {
    const opened = await this.store();
    const result = await opened.driver.runExclusive((database) => database.prepare(`
      DELETE FROM settings WHERE namespace = ? AND setting_key LIKE ?
    `).run(TASK_LIFECYCLE_EVENT_NAMESPACE, `${taskId}:%`));
    return (result as { changes: number }).changes;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await closeStorage(this.storage);
    this.storage = undefined;
  }
}

/** Convenience: count existing events for a task. */
export async function nextEventSequence(
  log: Pick<TaskLifecycleEventLog, "list">,
  taskId: string,
): Promise<number> {
  return (await log.list(taskId)).length + 1;
}

/** Build a lifecycle event record from a state transition. The sequence
 *  is assigned by the event log; callers should pass `sequence: 0` as a
 *  placeholder. */
export function transitionEventRecord(
  taskId: string,
  from: TaskLifecycleState,
  to: TaskLifecycleState,
  event: TaskLifecycleEvent,
  options?: { reason?: string },
): Omit<TaskLifecycleEventRecord, "sequence"> {
  return {
    taskId,
    fromStatus: from.status,
    toStatus: to.status,
    event,
    timestamp: to.updatedAt,
    generation: to.generation,
    ...(options?.reason ? { reason: options.reason } : {}),
  };
}

export function createEventRecord(
  state: TaskLifecycleState,
  options?: { reason?: string },
): Omit<TaskLifecycleEventRecord, "sequence"> {
  return {
    taskId: state.taskId,
    toStatus: state.status,
    event: "create",
    timestamp: state.updatedAt,
    generation: state.generation,
    ...(options?.reason ? { reason: options.reason } : {}),
  };
}