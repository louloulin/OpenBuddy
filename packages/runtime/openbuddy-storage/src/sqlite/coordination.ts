import type { SqliteDriver } from "./driver";

export interface WriterLease {
  name: string;
  ownerId: string;
  fencingToken: number;
  acquiredAt: string;
  expiresAt: string;
}

interface LeaseRow {
  lease_name: string;
  owner_id: string;
  fencing_token: number;
  acquired_at: string;
  expires_at: string;
}

export class WriterLeaseStore {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  acquire(name: string, ownerId: string, ttlMs: number): Promise<WriterLease | undefined> {
    if (!name || !ownerId || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("invalid writer lease arguments");
    return this.driver.runExclusive((database) => {
      const current = database.prepare("SELECT lease_name, owner_id, fencing_token, acquired_at, expires_at FROM writer_leases WHERE lease_name = ?").get(name) as LeaseRow | undefined;
      const now = this.now();
      if (current && current.owner_id !== ownerId && current.expires_at > now) return undefined;
      const fencingToken = (current?.fencing_token ?? 0) + 1;
      const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
      database.prepare(`INSERT INTO writer_leases(lease_name, owner_id, fencing_token, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lease_name) DO UPDATE SET owner_id=excluded.owner_id, fencing_token=excluded.fencing_token, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at`).run(name, ownerId, fencingToken, now, expiresAt);
      return { name, ownerId, fencingToken, acquiredAt: now, expiresAt };
    });
  }

  renew(lease: WriterLease, ttlMs: number): Promise<WriterLease | undefined> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("invalid writer lease duration");
    return this.driver.runExclusive((database) => {
      const now = this.now();
      const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();
      const result = database.prepare("UPDATE writer_leases SET expires_at = ? WHERE lease_name = ? AND owner_id = ? AND fencing_token = ? AND expires_at > ?").run(expiresAt, lease.name, lease.ownerId, lease.fencingToken, now);
      return Number(result.changes) === 1 ? { ...lease, expiresAt } : undefined;
    });
  }

  release(lease: WriterLease): Promise<boolean> {
    return this.driver.runExclusive((database) => {
      const result = database.prepare("UPDATE writer_leases SET expires_at = ? WHERE lease_name = ? AND owner_id = ? AND fencing_token = ?").run(this.now(), lease.name, lease.ownerId, lease.fencingToken);
      return Number(result.changes) === 1;
    });
  }
}

export type DurableOperationStatus = "pending" | "running" | "succeeded" | "failed";
export interface DurableOperation { operationId: string; idempotencyKey: string; kind: string; status: DurableOperationStatus; attempt: number; fencingToken?: number; input: unknown; result?: unknown; error?: string; createdAt: string; updatedAt: string; }

interface OperationRow { operation_id: string; idempotency_key: string; kind: string; status: DurableOperationStatus; attempt: number; fencing_token: number | null; input_json: string; result_json: string | null; error: string | null; created_at: string; updated_at: string; }
function decode(row: OperationRow): DurableOperation { return { operationId: row.operation_id, idempotencyKey: row.idempotency_key, kind: row.kind, status: row.status, attempt: row.attempt, ...(row.fencing_token === null ? {} : { fencingToken: row.fencing_token }), input: JSON.parse(row.input_json), ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) }), ...(row.error === null ? {} : { error: row.error }), createdAt: row.created_at, updatedAt: row.updated_at }; }

export class DurableOperationStore {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  get(operationId: string): DurableOperation | undefined {
    const row = this.driver.database.prepare("SELECT * FROM durable_operations WHERE operation_id = ?").get(operationId) as unknown as OperationRow | undefined;
    return row ? decode(row) : undefined;
  }

  begin(operationId: string, idempotencyKey: string, kind: string, input: unknown): Promise<DurableOperation> {
    return this.driver.runExclusive((database) => {
      const existing = database.prepare("SELECT * FROM durable_operations WHERE operation_id = ? OR idempotency_key = ?").get(operationId, idempotencyKey) as unknown as OperationRow | undefined;
      if (existing) return decode(existing);
      const now = this.now();
      database.prepare("INSERT INTO durable_operations(operation_id, idempotency_key, kind, status, attempt, input_json, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)").run(operationId, idempotencyKey, kind, JSON.stringify(input), now, now);
      return decode(database.prepare("SELECT * FROM durable_operations WHERE operation_id = ?").get(operationId) as unknown as OperationRow);
    });
  }

  claim(operationId: string, fencingToken?: number): Promise<DurableOperation | undefined> {
    return this.driver.runExclusive((database) => {
      const now = this.now();
      const result = database.prepare("UPDATE durable_operations SET status = 'running', attempt = attempt + 1, fencing_token = ?, updated_at = ?, error = NULL WHERE operation_id = ? AND status IN ('pending', 'failed')").run(fencingToken ?? null, now, operationId);
      if (Number(result.changes) !== 1) return undefined;
      return decode(database.prepare("SELECT * FROM durable_operations WHERE operation_id = ?").get(operationId) as unknown as OperationRow);
    });
  }

  complete(operationId: string, result: unknown, fencingToken?: number): Promise<DurableOperation | undefined> { return this.finish(operationId, "succeeded", result, undefined, fencingToken); }
  fail(operationId: string, error: string, fencingToken?: number): Promise<DurableOperation | undefined> { return this.finish(operationId, "failed", undefined, error, fencingToken); }

  private finish(operationId: string, status: "succeeded" | "failed", result: unknown, error: string | undefined, fencingToken: number | undefined): Promise<DurableOperation | undefined> {
    return this.driver.runExclusive((database) => {
      const now = this.now();
      const predicate = fencingToken === undefined ? "operation_id = ? AND status = 'running'" : "operation_id = ? AND status = 'running' AND fencing_token = ?";
      const params = fencingToken === undefined ? [now, result === undefined ? null : JSON.stringify(result), error ?? null, operationId] : [now, result === undefined ? null : JSON.stringify(result), error ?? null, operationId, fencingToken];
      const updated = database.prepare(`UPDATE durable_operations SET status = '${status}', result_json = ?, error = ?, updated_at = ? WHERE ${predicate}`).run(...(fencingToken === undefined ? [params[1], params[2], params[0], params[3]] : [params[1], params[2], params[0], params[3], params[4]]));
      if (Number(updated.changes) !== 1) return undefined;
      return decode(database.prepare("SELECT * FROM durable_operations WHERE operation_id = ?").get(operationId) as unknown as OperationRow);
    });
  }
}
