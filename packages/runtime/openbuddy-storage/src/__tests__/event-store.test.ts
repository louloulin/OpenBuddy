import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStorageEvent } from "../driver/contract";
import { EventStore } from "../sqlite/events";
import { MigrationRunner, DEFAULT_MIGRATIONS } from "../sqlite/migration";
import { SqliteDriver } from "../sqlite/driver";

let workDir = "";
let driver: SqliteDriver | undefined;

beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), "openbuddy-event-store-")); });
afterEach(() => { driver?.close(); driver = undefined; if (workDir) rmSync(workDir, { recursive: true, force: true }); });

async function open(): Promise<EventStore> {
  driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
  await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
  return new EventStore(driver);
}

describe("EventStore", () => {
  it("appends events and replays them in stream order", async () => {
    const store = await open();
    const base = new Date("2026-08-30T10:00:00.000Z");
    for (const seq of [3, 1, 2]) {
      store.append(createStorageEvent({
        id: `e-${seq}`, stream: "s", streamSequence: seq, type: "t", actor: "u",
        idempotencyKey: `k-${seq}`, payload: { seq },
      }, new Date(base.getTime() + seq * 1000)));
    }
    const replayed = store.replay("s");
    expect(replayed.map((row) => row.stream_seq)).toEqual([1, 2, 3]);
    const projected: number[] = [];
    const summary = await store.rebuild((row) => { projected.push(row.stream_seq); }, { batchSize: 2 });
    expect(projected).toEqual([1, 2, 3]);
    expect(summary).toEqual({ events: 3, streams: 1, lastSeqByStream: { s: 3 } });
  });

  it("records a cursor and reports the next read position", async () => {
    const store = await open();
    store.append(createStorageEvent({ id: "e-1", stream: "s", streamSequence: 1, type: "t", actor: "u", idempotencyKey: "k-1", payload: { n: 1 } }, new Date()));
    store.append(createStorageEvent({ id: "e-2", stream: "s", streamSequence: 2, type: "t", actor: "u", idempotencyKey: "k-2", payload: { n: 2 } }, new Date()));
    store.setCursor("search-index", "s", 2);
    const cursor = store.cursor("search-index", "s");
    expect(cursor?.lastSeq).toBe(2);
    const remaining = store.replay("s", cursor?.lastSeq ?? 0);
    expect(remaining).toEqual([]);
    store.setCursor("search-index", "s", 1);
    expect(store.cursor("search-index", "s")?.lastSeq).toBe(2);
  });

  it("rejects duplicate stream sequence and preserves stable event identity", async () => {
    const store = await open();
    const event = createStorageEvent({ id: "e-1", stream: "s", streamSequence: 1, type: "t", actor: "u", idempotencyKey: "k-1", payload: { n: 1 } }, new Date());
    store.append(event);
    expect(() => store.append(createStorageEvent({
      id: "e-2",
      stream: event.stream,
      streamSequence: event.streamSequence,
      type: event.type,
      actor: event.actor,
      idempotencyKey: event.idempotencyKey ?? "",
      payload: event.payload,
    }, new Date()))).toThrow();
    store.append(event);
    expect(store.replay("s")).toHaveLength(1);
  });

  it("rejects conflicting payloads for an existing event identity", async () => {
    const store = await open();
    const event = createStorageEvent({ id: "collision", stream: "s", streamSequence: 1, type: "t", actor: "u", idempotencyKey: "k1", payload: { value: 1 } }, new Date());
    store.append(event);
    const conflicting = createStorageEvent({ id: "collision", stream: "s", streamSequence: 1, type: "t", actor: "u", idempotencyKey: "k2", payload: { value: 2 } }, new Date());
    expect(() => store.append(conflicting)).toThrow("event id collision");
  });

  it("replays from a consumer cursor and retries the failed event", async () => {
    const store = await open();
    for (const sequence of [1, 2, 3]) {
      store.append(createStorageEvent({
        id: `e-${sequence}`, stream: "s", streamSequence: sequence, type: "t", actor: "u",
        idempotencyKey: `k-${sequence}`, payload: { sequence },
      }, new Date()));
    }
    const seen: number[] = [];
    await expect(store.replayInto("consumer", async (row) => {
      seen.push(row.stream_seq);
      if (row.stream_seq === 2) throw new Error("temporary projector failure");
    }, { stream: "s", batchSize: 2 })).rejects.toThrow("temporary projector failure");
    expect(store.cursor("consumer", "s")?.lastSeq).toBe(1);
    const result = await store.replayInto("consumer", (row) => { seen.push(row.stream_seq); }, { stream: "s", batchSize: 2 });
    expect(seen).toEqual([1, 2, 2, 3]);
    expect(result).toEqual({ events: 2, streams: 1, lastSeqByStream: { s: 3 } });
    expect(store.cursor("consumer", "s")?.lastSeq).toBe(3);
  });
});

describe("MigrationRunner", () => {
  it("applies forward migrations idempotently and records schema_meta", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    const runner = new MigrationRunner({ steps: DEFAULT_MIGRATIONS });
    const first = await runner.run(driver);
    const second = await runner.run(driver);
    expect(first.applied).toBe(11);
    expect(second.applied).toBe(0);
    expect(first.finalVersion).toBe(11);
  });

  it("fails on a broken migration and records the failure", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    const runner = new MigrationRunner({ steps: [
      { version: 1, description: "ok", up: () => undefined },
      { version: 2, description: "broken", up: () => { throw new Error("bad"); } },
    ] });
    await expect(runner.run(driver)).rejects.toThrow("bad");
    const failed = driver.database.prepare(`SELECT COUNT(*) AS c FROM schema_meta WHERE status='failed'`).get() as { c: number };
    expect(failed.c).toBe(1);
  });

  it("rolls back a half-written migration and can retry after restart", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    const broken = new MigrationRunner({ steps: [{
      version: 1,
      description: "half-write",
      up: (current) => {
        current.database.exec("CREATE TABLE transient(id INTEGER PRIMARY KEY)");
        throw new Error("interrupt");
      },
    }] });
    await expect(broken.run(driver)).rejects.toThrow("interrupt");
    expect(() => driver?.database.prepare("SELECT * FROM transient").all()).toThrow();
    driver.close();
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    const retry = new MigrationRunner({ steps: [{
      version: 1,
      description: "retry",
      up: (current) => current.database.exec("CREATE TABLE transient(id INTEGER PRIMARY KEY)"),
    }] });
    await expect(retry.run(driver)).resolves.toMatchObject({ applied: 1, finalVersion: 1 });
  });
});
