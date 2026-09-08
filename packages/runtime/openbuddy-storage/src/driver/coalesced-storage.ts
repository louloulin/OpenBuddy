/**
 * driver/coalesced-storage.ts — P0-08 coalesced StorageGateway wrapper.
 *
 * Hot-path optimisation for `StorageGateway.execute()`: when a single
 * tool call (or model step) fires N `gateway.execute()` calls in the
 * same Node tick, we don't want N separate `BEGIN IMMEDIATE / COMMIT`
 * pairs. Each commit forces a WAL fsync, so N writes ⇒ N fsyncs, even
 * though the work itself is logically one transaction from the caller's
 * perspective.
 *
 * `createCoalescedStorageGateway(gateway, options)` wraps an existing
 * gateway. Calls to `execute()` issued within `windowMs` (default 5ms —
 * matches `createWriteCoalescer` default) are collected and run inside
 * a single `driver.transaction()` invocation. Per-command results and
 * per-command errors are still surfaced to the original caller via the
 * returned Promise.
 *
 * Concurrency model:
 *   - The coalescer uses the same pattern as `SqliteDriver.createWriteCoalescer`:
 *     callbacks collected into a buffer, flushed by a setTimeout. There is at
 *     most one outstanding flush at a time.
 *   - Each command's `apply()` is invoked sequentially inside the single
 *     shared transaction. This matches `StorageGateway.execute()`'s normal
 *     semantics, but now N commands ⇒ 1 BEGIN + 1 COMMIT instead of N+N.
 *   - Idempotency keys are still checked via the shared transaction, so
 *     two commands with the same key within the same flush window produce
 *     the same result (first apply wins; the second short-circuits to the
 *     stored idempotent value, identical to the per-call path).
 *
 * Failure semantics:
 *   - If a single command's `apply()` throws, that command's promise
 *     rejects with the error. Sibling commands still complete and their
 *     promises resolve normally. The outer transaction is **not**
 *     rolled back — matches the coalescer pattern from
 *     `driver.ts:createWriteCoalescer`.
 *   - If the outer `driver.transaction()` itself throws (e.g. COMMIT
 *     failed), all pending commands reject with the outer error.
 *
 * Why not just use `createWriteCoalescer` directly?
 *   - `createWriteCoalescer` works at the `(tx) => Promise<T>` level. It
 *     needs the caller to write the idempotency-result store themselves.
 *     `createCoalescedStorageGateway` keeps the full
 *     `findIdempotentResult → apply → appendEvent → saveIdempotentResult →
 *     applyProjection` pipeline intact, so call sites that depend on
 *     idempotency don't need to know they're being coalesced.
 *
 * See: PERFORMANCE_TRANSFORMATION_PLAN §三 阶段 P0 第 8 条 "SQLite 事务批量合并".
 */
import type { SqliteDriver } from "../sqlite/driver";
import {
  StorageGateway,
  createStorageEvent,
  type StorageCommand,
  type StorageDriver,
  type StorageEventEnvelope,
} from "./contract";

export interface CoalescedStorageOptions {
  /** Time window to batch commands inside, in milliseconds. Default 5. */
  windowMs?: number;
  /** Driver used to open the shared transaction. Inferred from the gateway when omitted. */
  driver?: Pick<StorageDriver, "transaction">;
  /** Optional callback fired once per flushed batch with the command count + duration. */
  onFlush?: (info: { commandCount: number; durationMs: number; okCount: number; errorCount: number }) => void;
  /**
   * Clock used to measure flush duration. Defaults to `performance.now()` when
   * available, else `Date.now()`.
   */
  now?: () => number;
}

interface PendingCommand<T> {
  command: StorageCommand<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface CoalescedStorageGateway {
  execute<T>(command: StorageCommand<T>): Promise<T>;
  /** Force-drain the buffer. Resolves once the outstanding flush settles. */
  flush(): Promise<void>;
  /** Number of commands currently buffered. */
  pendingCount(): number;
  /** Reject any still-pending commands with `reason` and stop scheduling. */
  dispose(reason?: unknown): void;
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createCoalescedStorageGateway(
  gateway: StorageGateway,
  options: CoalescedStorageOptions = {},
): CoalescedStorageGateway {
  const windowMs = Math.max(0, options.windowMs ?? 5);
  const now = options.now ?? defaultNow;
  const driver: Pick<StorageDriver, "transaction"> = options.driver ?? gateway;

  let pending: PendingCommand<unknown>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const schedule = <T>(command: StorageCommand<T>): Promise<T> => {
    if (disposed) return Promise.reject(new Error("coalesced storage gateway is disposed"));
    return new Promise<T>((resolve, reject) => {
      pending.push({
        command: command as StorageCommand<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      if (!timer) {
        timer = setTimeout(() => {
          void flush();
        }, windowMs);
      }
    });
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const startedAt = now();
    let okCount = 0;
    let errorCount = 0;
    try {
      const results: unknown[] = await driver.transaction(async (tx) => {
        const out: unknown[] = [];
        for (const item of batch) {
          try {
            // Mirror StorageGateway.execute()'s pipeline so call sites see
            // the same idempotency contract they always have:
            //   1. findIdempotentResult(key) — short-circuit if previously seen
            //   2. command.apply(tx, event)
            //   3. appendEvent(event)
            //   4. saveIdempotentResult(key, result)
            //   5. applyProjection(event, result)
            const event: StorageEventEnvelope = createStorageEvent(item.command, new Date());
            const existing = await tx.findIdempotentResult(item.command.idempotencyKey);
            if (existing.found) {
              out.push(existing.value);
              continue;
            }
            const value = await item.command.apply(tx, event);
            await tx.appendEvent(event);
            await tx.saveIdempotentResult(item.command.idempotencyKey, value);
            await tx.applyProjection(event, value);
            out.push(value);
          } catch (err) {
            // Per-command failure: surface to that caller, keep batch alive
            // for siblings. The outer transaction commits normally so sibling
            // commands that succeeded are persisted (same contract as
            // `SqliteDriver.createWriteCoalescer`).
            out.push({ __error: err });
            errorCount += 1;
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
          okCount += 1;
          item.resolve(r);
        }
      }
    } catch (err) {
      // Outer transaction failure: reject everything still pending.
      for (const item of batch) item.reject(err);
      errorCount = batch.length;
      okCount = 0;
    } finally {
      const durationMs = now() - startedAt;
      options.onFlush?.({ commandCount: batch.length, durationMs, okCount, errorCount });
    }
  };

  return {
    execute: schedule,
    flush,
    pendingCount: () => pending.length,
    dispose: (reason?: unknown) => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const err = reason ?? new Error("coalesced storage gateway disposed");
      for (const item of pending) item.reject(err);
      pending = [];
    },
  };
}

/**
 * Convenience helper: build a `CoalescedStorageGateway` directly from a
 * `SqliteDriver`. This is the most common wiring — caller already has a
 * driver, wants to wrap a fresh gateway that always batches.
 */
export function createCoalescedGatewayFromDriver(
  driver: SqliteDriver,
  options: Omit<CoalescedStorageOptions, "driver"> = {},
): { gateway: StorageGateway; coalesced: CoalescedStorageGateway } {
  const gateway = new StorageGateway(driver);
  const coalesced = createCoalescedStorageGateway(gateway, { ...options, driver });
  return { gateway, coalesced };
}
