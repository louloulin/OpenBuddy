import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationRunner, DEFAULT_MIGRATIONS } from "../sqlite/migration";
import { SqliteDriver } from "../sqlite/driver";
import { createStorageEvent } from "../driver/contract";
import type { StorageTransaction } from "../driver/contract";

let workDir = "";
let driver: SqliteDriver | undefined;
const fixedNow = new Date("2026-09-04T12:00:00.000Z");

const makeEvent = (id: string, seq: number, payload: Record<string, unknown> = {}) =>
  createStorageEvent(
    {
      id,
      stream: "s",
      streamSequence: seq,
      type: "t",
      actor: "u",
      idempotencyKey: `k-${id}`,
      payload,
    },
    fixedNow,
  );

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "openbuddy-coalescer-"));
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

describe("P1-03 — SqliteDriver.createWriteCoalescer", () => {
  it("coalesces 3 schedules in the same window into a single transaction", async () => {
    const d = await openDriver();
    const coalescer = d.createWriteCoalescer(20);

    const [r1, r2, r3] = await Promise.all([
      coalescer.schedule(async (tx: StorageTransaction) => {
        await tx.appendEvent(makeEvent("e-1", 1, { n: 1 }));
        return 1;
      }),
      coalescer.schedule(async (tx: StorageTransaction) => {
        await tx.appendEvent(makeEvent("e-2", 2, { n: 2 }));
        return 2;
      }),
      coalescer.schedule(async (tx: StorageTransaction) => {
        await tx.appendEvent(makeEvent("e-3", 3, { n: 3 }));
        return 3;
      }),
    ]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(r3).toBe(3);
    expect(coalescer.pendingCount()).toBe(0);

    // Verify all 3 events landed.
    const rows = d.enqueue((db) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const stmt = db.prepare("SELECT id FROM events WHERE stream = 's' ORDER BY stream_seq");
      return stmt.all() as Array<{ id: string }>;
    });
    const events = await rows;
    expect(events.map((e) => e.id)).toEqual(["e-1", "e-2", "e-3"]);
  });

  it("flush() drains the buffer synchronously", async () => {
    const d = await openDriver();
    const coalescer = d.createWriteCoalescer(50);

    const promise = coalescer.schedule(async (tx) => {
      await tx.appendEvent(makeEvent("e-flush", 1));
      return "done";
    });

    await coalescer.flush();
    expect(await promise).toBe("done");
    expect(coalescer.pendingCount()).toBe(0);
  });

  it("per-item failures do not reject siblings (independent results)", async () => {
    const d = await openDriver();
    const coalescer = d.createWriteCoalescer(10);

    const [okResult, failResult] = await Promise.allSettled([
      coalescer.schedule(async (tx) => {
        await tx.appendEvent(makeEvent("e-ok", 1));
        return "ok";
      }),
      coalescer.schedule(async (_tx) => {
        throw new Error("synthetic failure");
      }),
      coalescer.schedule(async (tx) => {
        await tx.appendEvent(makeEvent("e-after-fail", 2));
        return "after";
      }),
    ]);

    expect(okResult.status).toBe("fulfilled");
    expect(failResult.status).toBe("rejected");
    if (failResult.status === "rejected") {
      expect((failResult.reason as Error).message).toBe("synthetic failure");
    }
  });

  it("dispose() rejects all pending callbacks", async () => {
    const d = await openDriver();
    const coalescer = d.createWriteCoalescer(50);

    const promise = coalescer.schedule(async () => "never");
    coalescer.dispose();

    await expect(promise).rejects.toThrow(/coalescer disposed/);
    expect(coalescer.pendingCount()).toBe(0);

    // Subsequent schedules are also rejected.
    await expect(coalescer.schedule(async () => "never2")).rejects.toThrow(/coalescer is closed/);
  });

  it("two consecutive coalesce windows produce two separate transactions", async () => {
    const d = await openDriver();
    const coalescer = d.createWriteCoalescer(10);

    const p1 = coalescer.schedule(async (tx) => {
      await tx.appendEvent(makeEvent("e-w1-a", 1));
      return "w1";
    });
    await coalescer.flush();
    expect(await p1).toBe("w1");

    // Second window — should be a separate transaction.
    const p2 = coalescer.schedule(async (tx) => {
      await tx.appendEvent(makeEvent("e-w2-a", 2));
      return "w2";
    });
    await coalescer.flush();
    expect(await p2).toBe("w2");

    const rows = await d.enqueue((db) => {
      const stmt = db.prepare("SELECT id FROM events WHERE stream = 's' ORDER BY stream_seq");
      return stmt.all() as Array<{ id: string }>;
    });
    expect(rows.map((e) => e.id)).toEqual(["e-w1-a", "e-w2-a"]);
  });
});