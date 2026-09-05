import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { StorageMetricsRegistry } from "../observability/metrics";
import type { StorageDriver, StorageTransaction } from "../driver/contract";
import { DEFAULT_MIGRATIONS, MigrationRunner } from "./migration";

export type JournalMode = "wal" | "rollback" | "truncate";

export interface SqliteDriverOptions {
  filePath: string;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
  journalMode?: JournalMode;
}

export interface StorageHealthSnapshot {
  journalMode: string;
  synchronous: string;
  foreignKeys: boolean;
  busyTimeoutMs: number;
  schemaVersion: number;
  eventCount: number;
  streamCount: number;
  queueDepth: number;
  integrity: { ok: boolean; detail?: string; foreignKeys?: string };
  metrics?: {
    writes: number;
    busy: number;
    rollbacks: number;
    totalLatencyMs: number;
    maxLatencyMs: number;
    lastWriteAt?: string;
    lastBackupAt?: string;
    migrationIssues: number;
  };
}

type SqliteValue = SQLInputValue;

const require = createRequire(import.meta.url);
const { DatabaseSync: DatabaseSyncConstructor } = require("node:sqlite") as { DatabaseSync: new (path: string) => DatabaseSync };

function determineJournalMode(filePath: string, requested: JournalMode | undefined): JournalMode {
  if (requested) return requested;
  if (filePath === ":memory:") return "rollback";
  return "wal";
}

function runStatement(database: DatabaseSync, sql: string, params: readonly SqliteValue[] = []): void {
  const statement = database.prepare(sql);
  statement.run(...(params as SqliteValue[]));
}

function allStatement<T>(database: DatabaseSync, sql: string, params: readonly SqliteValue[] = []): T[] {
  const statement = database.prepare(sql);
  return statement.all(...(params as SqliteValue[])) as T[];
}

function getStatement<T>(database: DatabaseSync, sql: string, params: readonly SqliteValue[] = []): T | undefined {
  const statement = database.prepare(sql);
  return statement.get(...(params as SqliteValue[])) as T | undefined;
}

interface JsonRow { value: string }

type EncodedIdempotentResult =
  | { version: 1; kind: "undefined" }
  | { version: 1; kind: "value"; value: unknown };

function encodeIdempotentResult(value: unknown): string {
  const encoded: EncodedIdempotentResult = value === undefined
    ? { version: 1, kind: "undefined" }
    : { version: 1, kind: "value", value };
  return JSON.stringify(encoded);
}

function decodeIdempotentResult(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (parsed && typeof parsed === "object") {
    const encoded = parsed as Partial<EncodedIdempotentResult>;
    if (encoded.version === 1 && encoded.kind === "undefined") return undefined;
    if (encoded.version === 1 && encoded.kind === "value") return encoded.value;
  }
  return parsed;
}

export class SqliteDriver implements StorageDriver {
  private static readonly writeQueues = new Map<string, Promise<void>>();
  private static readonly queueDepths = new Map<string, number>();
  public readonly database: DatabaseSync;
  private readonly writeQueueKey: string;

  constructor(public readonly options: SqliteDriverOptions) {
    this.writeQueueKey = options.filePath === ":memory:" ? `memory:${randomUUID()}` : resolve(options.filePath);
    this.database = new DatabaseSyncConstructor(options.filePath);
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    runStatement(this.database, `PRAGMA busy_timeout = ${Math.max(0, busyTimeoutMs | 0)}`);
    runStatement(this.database, `PRAGMA foreign_keys = ${options.foreignKeys === false ? "OFF" : "ON"}`);
    runStatement(this.database, `PRAGMA journal_mode = ${determineJournalMode(options.filePath, options.journalMode)}`);
    runStatement(this.database, `PRAGMA synchronous = NORMAL`);
  }

  migrate(targetVersion?: number) {
    return new MigrationRunner({ steps: DEFAULT_MIGRATIONS, appVersion: "openbuddy-storage" }).run(this, targetVersion);
  }

  enqueue<T>(callback: (database: DatabaseSync) => T | Promise<T>): Promise<T> {
    const previous = SqliteDriver.writeQueues.get(this.writeQueueKey) ?? Promise.resolve();
    SqliteDriver.queueDepths.set(this.writeQueueKey, (SqliteDriver.queueDepths.get(this.writeQueueKey) ?? 0) + 1);
    const startedAt = Date.now();
    const run = previous.then(() => callback(this.database));
    void run.then((result) => {
      const elapsed = Date.now() - startedAt;
      metricsRegistry.recordWrite(this.writeQueueKey, elapsed, "ok", new Date().toISOString());
      return result;
    }, (error: unknown) => {
      const elapsed = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      const status: "busy" | "rollback" = /SQLITE_BUSY/i.test(message) ? "busy" : "rollback";
      metricsRegistry.recordWrite(this.writeQueueKey, elapsed, status, new Date().toISOString());
    });
    const queued = run.then(() => undefined, () => undefined);
    SqliteDriver.writeQueues.set(this.writeQueueKey, queued);
    const release = (): void => {
      const depth = (SqliteDriver.queueDepths.get(this.writeQueueKey) ?? 1) - 1;
      if (depth > 0) SqliteDriver.queueDepths.set(this.writeQueueKey, depth);
      else SqliteDriver.queueDepths.delete(this.writeQueueKey);
    };
    void run.then(release, release);
    void queued.then(() => {
      if (SqliteDriver.writeQueues.get(this.writeQueueKey) === queued) SqliteDriver.writeQueues.delete(this.writeQueueKey);
    });
    return run;
  }

  async flush(): Promise<void> {
    await (SqliteDriver.writeQueues.get(this.writeQueueKey) ?? Promise.resolve());
  }

  healthSnapshot(): StorageHealthSnapshot {
    const tableExists = (name: string): boolean => Boolean(getStatement<{ name: string }>(this.database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
    const migrationIssues = tableExists("migration_issues")
      ? Number(getStatement<{ count: number }>(this.database, "SELECT COUNT(*) AS count FROM migration_issues WHERE resolved_at IS NULL")?.count ?? 0)
      : 0;
    const lastBackupAt = tableExists("backup_manifests")
      ? (getStatement<{ created_at: string }>(this.database, "SELECT created_at FROM backup_manifests ORDER BY created_at DESC LIMIT 1")?.created_at)
      : undefined;
    const metrics = metricsRegistry.snapshot(
      this.writeQueueKey,
      SqliteDriver.queueDepths.get(this.writeQueueKey) ?? 0,
      tableExists("schema_meta")
        ? Number(getStatement<{ version: number | null }>(this.database, "SELECT MAX(version) AS version FROM schema_meta WHERE status = 'applied'")?.version ?? 0)
        : 0,
      migrationIssues,
      lastBackupAt,
    );
    metricsRegistry.recordSnapshot(metrics);
    const integrity = this.integrityCheckSync();
    const schemaVersion = tableExists("schema_meta")
      ? Number(getStatement<{ version: number | null }>(this.database, "SELECT MAX(version) AS version FROM schema_meta WHERE status = 'applied'")?.version ?? 0)
      : 0;
    const eventCount = tableExists("events") ? Number(getStatement<{ count: number }>(this.database, "SELECT COUNT(*) AS count FROM events")?.count ?? 0) : 0;
    const streamCount = tableExists("events") ? Number(getStatement<{ count: number }>(this.database, "SELECT COUNT(DISTINCT stream) AS count FROM events")?.count ?? 0) : 0;
    const journal = getStatement<{ journal_mode: string }>(this.database, "PRAGMA journal_mode")?.journal_mode ?? "unknown";
    const synchronous = getStatement<{ synchronous: number | string }>(this.database, "PRAGMA synchronous")?.synchronous;
    const foreignKeys = Number(getStatement<{ foreign_keys: number }>(this.database, "PRAGMA foreign_keys")?.foreign_keys ?? 0) === 1;
    const busyTimeoutMs = Number(getStatement<{ timeout: number }>(this.database, "PRAGMA busy_timeout")?.timeout ?? 0);
    return {
      journalMode: String(journal),
      synchronous: synchronous === 1 ? "NORMAL" : String(synchronous ?? "unknown"),
      foreignKeys,
      busyTimeoutMs,
      schemaVersion,
      eventCount,
      streamCount,
      queueDepth: SqliteDriver.queueDepths.get(this.writeQueueKey) ?? 0,
      integrity,
      metrics: {
        writes: metrics.writes,
        busy: metrics.busy,
        rollbacks: metrics.rollbacks,
        totalLatencyMs: metrics.totalLatencyMs,
        maxLatencyMs: metrics.maxLatencyMs,
        ...(metrics.lastWriteAt ? { lastWriteAt: metrics.lastWriteAt } : {}),
        ...(lastBackupAt ? { lastBackupAt } : {}),
        migrationIssues,
      },
    };
  }

  healthSnapshotSync(): StorageHealthSnapshot {
    return this.healthSnapshot();
  }

  runExclusive<T>(callback: (database: DatabaseSync) => T | Promise<T>): Promise<T> {
    return this.enqueue(async (database) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(database);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
    });
  }

  runExclusiveSync<T>(callback: (database: DatabaseSync) => T): T {
    if ((SqliteDriver.queueDepths.get(this.writeQueueKey) ?? 0) > 0) {
      throw new Error("synchronous SQLite write unavailable while an asynchronous write is queued");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback(this.database);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
  }

  transaction<T>(callback: (transaction: StorageTransaction) => Promise<T> | T): Promise<T> {
    return this.enqueue(async (database) => {
      runStatement(database, "BEGIN IMMEDIATE");
      const transaction: StorageTransaction = {
        findIdempotentResult: async (key) => {
          const row = getStatement<JsonRow>(database, `SELECT value FROM idempotency_results WHERE key = ?`, [key]);
          if (!row) return { found: false, value: undefined };
          try { return { found: true, value: decodeIdempotentResult(row.value) }; } catch { return { found: true, value: undefined }; }
        },
        appendEvent: async (event) => {
          const result = database.prepare(
            `INSERT INTO events(id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          ).run(event.id, event.stream, event.streamSequence, event.type, event.occurredAt, event.actor,
            JSON.stringify(event.payload), event.payloadHash, event.idempotencyKey ?? null);
          if (Number(result.changes) === 0) {
            const existing = database.prepare(`SELECT stream, stream_seq, type, occurred_at, actor, payload_hash, idempotency_key FROM events WHERE id = ?`).get(event.id) as {
              stream: string; stream_seq: number; type: string; occurred_at: string; actor: string; payload_hash: string; idempotency_key: string | null;
            } | undefined;
            const same = existing
              && existing.stream === event.stream
              && existing.stream_seq === event.streamSequence
              && existing.type === event.type
              && existing.occurred_at === event.occurredAt
              && existing.actor === event.actor
              && existing.payload_hash === event.payloadHash
              && existing.idempotency_key === (event.idempotencyKey ?? null);
            if (!same) throw new Error(`event id collision: ${event.id}`);
          }
        },
        saveIdempotentResult: async (key, result) => {
          runStatement(database,
            `INSERT INTO idempotency_results(key, value, recorded_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, recorded_at = excluded.recorded_at`,
            [key, encodeIdempotentResult(result), new Date().toISOString()]);
        },
        applyProjection: async () => undefined,
      };
      try {
        const result = await callback(transaction);
        runStatement(database, "COMMIT");
        return result;
      } catch (error) {
        try { runStatement(database, "ROLLBACK"); } catch { /* preserve the original error */ }
        throw error;
      }
    });
  }

  integrityCheck(): Promise<{ ok: boolean; detail?: string; foreignKeys?: string }> {
    const rows = allStatement<{ integrity_check: string }>(this.database, "PRAGMA integrity_check");
    const first = rows[0]?.integrity_check ?? "ok";
    const foreignKeys = allStatement<{ table: string; rowid: number; parent: string; fkid: number }>(this.database, "PRAGMA foreign_key_check")
      .map((row) => `${row.table}:${row.rowid}->${row.parent}[${row.fkid}]`).join(",");
    return Promise.resolve({ ok: first === "ok" && foreignKeys.length === 0, detail: first === "ok" ? undefined : first, foreignKeys: foreignKeys || undefined });
  }

  integrityCheckSync(): { ok: boolean; detail?: string; foreignKeys?: string } {
    const rows = allStatement<{ integrity_check: string }>(this.database, "PRAGMA integrity_check");
    const first = rows[0]?.integrity_check ?? "ok";
    const foreignKeys = allStatement<{ table: string; rowid: number; parent: string; fkid: number }>(this.database, "PRAGMA foreign_key_check")
      .map((row) => `${row.table}:${row.rowid}->${row.parent}[${row.fkid}]`).join(",");
    return { ok: first === "ok" && foreignKeys.length === 0, detail: first === "ok" ? undefined : first, foreignKeys: foreignKeys || undefined };
  }

  async backup(destination: string): Promise<{ path: string; schemaVersion: number }> {
    return this.enqueue(async () => {
      await mkdir(dirname(destination), { recursive: true });
      const escapedDestination = destination.replace(/'/g, "''");
      try {
        this.database.exec(`VACUUM INTO '${escapedDestination}'`);
      } catch (error) {
        throw new Error(`SQLite backup failed for ${destination}: ${String(error)}`, { cause: error });
      }
      const hasMeta = getStatement<{ name: string }>(this.database, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'`);
      const versionRow = hasMeta
        ? getStatement<{ version: number }>(this.database, `SELECT MAX(version) as version FROM schema_meta WHERE status = 'applied'`)
        : undefined;
      const schemaVersion = versionRow?.version ?? 0;
      const manifestTable = getStatement<{ name: string }>(this.database, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backup_manifests'`);
      if (manifestTable) {
        runStatement(this.database,
          `INSERT INTO backup_manifests(backup_id, path, schema_version, integrity_ok, created_at) VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), destination, schemaVersion, 1, new Date().toISOString()]);
      }
      return { path: destination, schemaVersion };
    });
  }

  close(): void {
    this.database.close();
  }

  // ---------------------------------------------------------------------------
  // P1-03 — Storage write coalescer.
  //
  // Multiple enqueue() calls inside a single tick (e.g. one tool result that
  // triggers an event append, an idempotency record, and a cursor update)
  // currently each open their own BEGIN IMMEDIATE/COMMIT pair. The verify
  // finding flagged this as "P1: 每次工具调用若触发多条 store 变更,会跑 3 次
  // fsync 而非 1 次".
  //
  // `createWriteCoalescer(windowMs)` returns a scheduler that:
  //   1. Buffers callbacks received within `windowMs` (default 5ms).
  //   2. Flushes them as a single transaction (one BEGIN, one COMMIT).
  //   3. Forwards individual results / errors back to each caller.
  //
  // Use this when you have a hot path that triggers 2+ enqueue() calls in
  // quick succession. Single enqueues should still use `enqueue()` directly.
  //
  // The coalescer is process-local and not safe to share across processes —
  // but SqliteDriver itself is already single-process per file.
  createWriteCoalescer(windowMs: number = 5): WriteCoalescer {
    let pending: PendingWork[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const self2 = this;

    const flush = async (): Promise<void> => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      try {
        const results: unknown[] = await self2.transaction(async (tx) => {
          const out: unknown[] = [];
          for (const item of batch) {
            try {
              out.push(await item.callback(tx));
            } catch (err) {
              // Surface per-item failures so siblings still resolve/reject.
              out.push({ __error: err });
            }
          }
          return out;
        });
        for (let i = 0; i < batch.length; i += 1) {
          const item = batch[i];
          const r = results[i];
          if (r && typeof r === "object" && "__error" in (r as Record<string, unknown>)) {
            item.reject((r as { __error: unknown }).__error);
          } else {
            item.resolve(r);
          }
        }
      } catch (err) {
        // Outer transaction failure: reject everything still pending.
        for (const item of batch) item.reject(err);
      }
    };

    const schedule = <T>(callback: (tx: StorageTransaction) => Promise<T>): Promise<T> => {
      if (closed) return Promise.reject(new Error("coalescer is closed"));
      return new Promise<T>((resolve, reject) => {
        pending.push({ callback: callback as (tx: StorageTransaction) => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
        if (!timer) timer = setTimeout(() => { void flush(); }, windowMs);
      });
    };

    return {
      schedule,
      flush,
      pendingCount: () => pending.length,
      dispose: () => {
        closed = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        const err = new Error("coalescer disposed");
        for (const item of pending) item.reject(err);
        pending = [];
      },
    };
  }
}

interface PendingWork {
  callback: (tx: StorageTransaction) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface WriteCoalescer {
  schedule<T>(callback: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  pendingCount(): number;
  dispose(): void;
}
const metricsRegistry = new StorageMetricsRegistry();
export function storageMetricsRegistry(): StorageMetricsRegistry { return metricsRegistry; }
