/**
 * P0-08 — CoalescedStorageGateway tests.
 *
 * Validates that `createCoalescedStorageGateway` correctly batches
 * `StorageGateway.execute()` calls issued in the same tick into a
 * single `driver.transaction()`, while preserving:
 *
 *   - per-command idempotency contract (key short-circuit)
 *   - per-command result/error surface
 *   - outer-transaction failure semantics (everything rejects)
 *
 * These tests mirror the SqliteDriver.createWriteCoalescer test
 * (P1-03) in shape — same setup/teardown, same migration fixture.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MigrationRunner, DEFAULT_MIGRATIONS } from "../sqlite/migration";
import { SqliteDriver } from "../sqlite/driver";
import { StorageGateway, type StorageCommand } from "../driver/contract";
import { createCoalescedStorageGateway } from "../driver/coalesced-storage";

let workDir = "";
let driver: SqliteDriver | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "openbuddy-coalesced-storage-"));
});

afterEach(() => {
  driver?.close();
  driver = undefined;
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function openDriver(): Promise<SqliteDriver> {
  driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
  await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
  return driver;
}

function makeCommand(
  id: string,
  apply: StorageCommand<unknown>["apply"],
): StorageCommand<unknown> {
  return {
    id,
    stream: "s",
    streamSequence: Number(id.split("-")[1] ?? 0),
    type: "t",
    actor: "u",
    idempotencyKey: `key-${id}`,
    payload: { id },
    apply,
  };
}

describe("P0-08 — CoalescedStorageGateway", () => {
  it("batches 3 commands in the same tick into a single transaction", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const coalesced = createCoalescedStorageGateway(gateway, { driver: d, windowMs: 20 });

    const [r1, r2, r3] = await Promise.all([
      coalesced.execute(makeCommand("cmd-1", () => 1)),
      coalesced.execute(makeCommand("cmd-2", () => 2)),
      coalesced.execute(makeCommand("cmd-3", () => 3)),
    ]);

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(r3).toBe(3);
    expect(coalesced.pendingCount()).toBe(0);

    // All three events landed.
    const rows = await d.enqueue((db) =>
      db.prepare("SELECT id FROM events WHERE stream = 's' ORDER BY stream_seq").all() as Array<{ id: string }>,
    );
    expect(rows.map((r) => r.id)).toEqual(["cmd-1", "cmd-2", "cmd-3"]);
  });

  it("honors idempotency key short-circuit within a batch", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const coalesced = createCoalescedStorageGateway(gateway, { driver: d, windowMs: 20 });

    let firstApplyCount = 0;
    let secondApplyCount = 0;

    const cmdA = makeCommand("dup-1", () => {
      firstApplyCount += 1;
      return "first";
    });
    const cmdB = makeCommand("dup-2", () => {
      secondApplyCount += 1;
      return "second";
    });
    // Force both commands to share an idempotency key.
    cmdB.idempotencyKey = cmdA.idempotencyKey;

    const [a, b] = await Promise.all([coalesced.execute(cmdA), coalesced.execute(cmdB)]);
    expect(a).toBe("first");
    // Second call short-circuits via findIdempotentResult — apply not called.
    expect(b).toBe("first");
    expect(firstApplyCount).toBe(1);
    expect(secondApplyCount).toBe(0);

    // Only one event recorded (the first).
    const rows = await d.enqueue((db) =>
      db.prepare("SELECT id FROM events WHERE stream = 's' ORDER BY stream_seq").all() as Array<{ id: string }>,
    );
    expect(rows.map((r) => r.id)).toEqual(["dup-1"]);
  });

  it("isolates per-command failures from siblings", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const coalesced = createCoalescedStorageGateway(gateway, { driver: d, windowMs: 20 });

    const results = await Promise.allSettled([
      coalesced.execute(makeCommand("ok-1", () => "ok")),
      coalesced.execute(makeCommand("bad-1", () => { throw new Error("boom"); })),
      coalesced.execute(makeCommand("ok-2", () => 42)),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect((results[0] as PromiseFulfilledResult<string>).value).toBe("ok");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("boom");
    expect(results[2].status).toBe("fulfilled");
    expect((results[2] as PromiseFulfilledResult<number>).value).toBe(42);

    // Sibling events still landed — outer transaction commits the
    // successful commands' rows. The failed command's event is not
    // persisted (apply() threw before appendEvent ran).
    const rows = await d.enqueue((db) =>
      db.prepare("SELECT id FROM events WHERE stream = 's' ORDER BY stream_seq").all() as Array<{ id: string }>,
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["ok-1", "ok-2"]);
  });

  it("onFlush callback fires once per batch with counts + duration", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const flushes: Array<{ commandCount: number; okCount: number; errorCount: number; durationMs: number }> = [];
    const coalesced = createCoalescedStorageGateway(gateway, {
      driver: d,
      windowMs: 10,
      onFlush: (info) => flushes.push(info),
    });

    await Promise.allSettled([
      coalesced.execute(makeCommand("f-1", () => 1)),
      coalesced.execute(makeCommand("f-2", () => { throw new Error("nope"); })),
      coalesced.execute(makeCommand("f-3", () => 3)),
    ]);
    // Allow the onFlush callback to settle.
    await coalesced.flush();

    expect(flushes).toHaveLength(1);
    expect(flushes[0].commandCount).toBe(3);
    expect(flushes[0].okCount).toBe(2);
    expect(flushes[0].errorCount).toBe(1);
    expect(flushes[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("flush() drains immediately, no setTimeout wait", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const coalesced = createCoalescedStorageGateway(gateway, { driver: d, windowMs: 1_000 });

    const promise = coalesced.execute(makeCommand("immediate", () => "x"));
    expect(coalesced.pendingCount()).toBe(1);
    await coalesced.flush();
    expect(await promise).toBe("x");
    expect(coalesced.pendingCount()).toBe(0);
  });

  it("dispose() rejects all pending commands and refuses new ones", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const coalesced = createCoalescedStorageGateway(gateway, { driver: d, windowMs: 100 });

    const pending = coalesced.execute(makeCommand("drop-1", () => 1));
    coalesced.dispose(new Error("shutting down"));
    await expect(pending).rejects.toThrow("shutting down");
    await expect(coalesced.execute(makeCommand("drop-2", () => 2))).rejects.toThrow(
      "coalesced storage gateway is disposed",
    );
    expect(coalesced.pendingCount()).toBe(0);
  });

  it("issues no transaction when nothing is queued", async () => {
    const d = await openDriver();
    const gateway = new StorageGateway(d);
    const flushes: number[] = [];
    const coalesced = createCoalescedStorageGateway(gateway, {
      driver: d,
      windowMs: 5,
      onFlush: () => flushes.push(1),
    });
    // No schedules — flush() is a no-op, onFlush is not invoked.
    await coalesced.flush();
    expect(flushes).toHaveLength(0);
    expect(coalesced.pendingCount()).toBe(0);
  });
});
