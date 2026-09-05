import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDriver } from "../sqlite/driver";
import { StorageGateway } from "../driver/contract";

let workDir = "";
let driver: SqliteDriver | undefined;

beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), "openbuddy-sqlite-driver-")); });
afterEach(() => { driver?.close(); driver = undefined; if (workDir) rmSync(workDir, { recursive: true, force: true }); });

describe("SqliteDriver", () => {
  it("opens a local file with WAL + foreign_keys + busy_timeout pragmas", () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite"), busyTimeoutMs: 1234 });
    const journal = driver.database.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
    expect(journal.journal_mode.toLowerCase()).toBe("wal");
    const fk = driver.database.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });

  it("switches to rollback when WAL is disabled", () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite"), journalMode: "rollback" });
    const journal = driver.database.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
    expect(["delete", "truncate"]).toContain(journal.journal_mode.toLowerCase());
  });

  it("commits a transaction and exposes idempotent retries", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const gateway = new StorageGateway(driver, { now: () => new Date("2026-08-30T10:00:00.000Z"), notifyCommitted: () => undefined });
    const command = {
      id: "evt-1", stream: "s", streamSequence: 1, type: "demo", actor: "u",
      idempotencyKey: "k1", payload: { ok: true }, apply: async () => ({ ok: true }),
    };
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    const count = driver.database.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("persists undefined idempotent results without re-executing the command", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const gateway = new StorageGateway(driver);
    let executions = 0;
    const command = {
      id: "evt-undefined", stream: "s", streamSequence: 1, type: "clear", actor: "u",
      idempotencyKey: "undefined-result", payload: {}, apply: async () => { executions += 1; return undefined; },
    };
    await expect(gateway.execute(command)).resolves.toBeUndefined();
    await expect(gateway.execute(command)).resolves.toBeUndefined();
    expect(executions).toBe(1);
    expect(driver.database.prepare("SELECT value FROM idempotency_results WHERE key = ?").get("undefined-result")).toMatchObject({ value: expect.stringContaining('"kind":"undefined"') });
  });

  it("reads legacy raw null idempotent results after the encoding upgrade", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    driver.database.prepare("INSERT INTO idempotency_results(key, value, recorded_at) VALUES (?, ?, ?)").run("legacy-null", "null", new Date().toISOString());
    const gateway = new StorageGateway(driver);
    let executions = 0;
    await expect(gateway.execute({
      id: "legacy-event", stream: "s", streamSequence: 1, type: "legacy", actor: "u", idempotencyKey: "legacy-null", payload: {},
      apply: async () => { executions += 1; return "should-not-run"; },
    })).resolves.toBeNull();
    expect(executions).toBe(0);
  });

  it("rolls back when a command throws and leaves no partial state", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const gateway = new StorageGateway(driver, { now: () => new Date("2026-08-30T10:00:00.000Z") });
    await expect(gateway.execute({
      id: "evt-x", stream: "s", streamSequence: 1, type: "demo", actor: "u",
      idempotencyKey: "kx", payload: { value: 1 }, apply: async () => { throw new Error("boom"); },
    })).rejects.toThrow("boom");
    const events = driver.database.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    const idem = driver.database.prepare(`SELECT COUNT(*) AS c FROM idempotency_results`).get() as { c: number };
    expect(events.c).toBe(0);
    expect(idem.c).toBe(0);
  });

  it("rejects a conflicting event with an already-used identity", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const gateway = new StorageGateway(driver);
    const base = { id: "same-id", stream: "s", streamSequence: 1, type: "demo", actor: "u", payload: { value: 1 } };
    await gateway.execute({ ...base, idempotencyKey: "k1", apply: async () => "one" });
    await expect(gateway.execute({ ...base, idempotencyKey: "k2", payload: { value: 2 }, apply: async () => "two" })).rejects.toThrow("event id collision");
  });

  it("runs integrity check on a healthy database", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT NOT NULL); INSERT INTO t(id, v) VALUES (1, 'ok')`);
    const result = await driver.integrityCheck();
    expect(result.ok).toBe(true);
  });

  it("exposes a redacted operational health snapshot", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite"), busyTimeoutMs: 1234 });
    driver.database.exec(`CREATE TABLE schema_meta(version INTEGER, status TEXT); INSERT INTO schema_meta(version, status) VALUES (7, 'applied'); CREATE TABLE events(id TEXT, stream TEXT); INSERT INTO events(id, stream) VALUES ('e-1', 'session');`);
    const health = driver.healthSnapshotSync();
    expect(health).toMatchObject({ journalMode: "wal", foreignKeys: true, busyTimeoutMs: 1234, schemaVersion: 7, eventCount: 1, streamCount: 1, queueDepth: 0, integrity: { ok: true } });
    expect(health).not.toHaveProperty("filePath");
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = driver.enqueue(async () => firstGate);
    const second = driver.enqueue(async () => undefined);
    expect(driver.healthSnapshotSync().queueDepth).toBe(2);
    releaseFirst();
    await Promise.all([first, second]);
    expect(driver.healthSnapshot().queueDepth).toBe(0);
  });

  it("fails closed for synchronous writes while an async write is queued", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = driver.enqueue(async () => gate);
    expect(() => driver!.runExclusiveSync(() => undefined)).toThrow("synchronous SQLite write unavailable");
    release();
    await pending;
    expect(() => driver!.runExclusiveSync(() => "ok")).not.toThrow();
  });

  it("flushes queued writes before shutdown", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec("CREATE TABLE writes(id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = driver.enqueue(async (database) => {
      await gate;
      database.prepare("INSERT INTO writes(id, value) VALUES (1, 'first')").run();
    });
    const second = driver.enqueue((database) => {
      database.prepare("INSERT INTO writes(id, value) VALUES (2, 'second')").run();
    });
    const flush = driver.flush();
    expect(driver.healthSnapshotSync().queueDepth).toBe(2);
    release();
    await Promise.all([first, second, flush]);
    expect(driver.database.prepare("SELECT COUNT(*) AS count FROM writes").get()).toMatchObject({ count: 2 });
  });

  it("creates a consistent backup from the source database", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sample VALUES (1, 'ok')");
    const destination = join(workDir, "backup.sqlite");
    await expect(driver.backup(destination)).resolves.toMatchObject({ path: destination, schemaVersion: 0 });
    expect(existsSync(destination)).toBe(true);
  });

  it("serializes concurrent writes through one writer queue", async () => {
    driver = new SqliteDriver({ filePath: join(workDir, "store.sqlite") });
    driver.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const gateway = new StorageGateway(driver);
    const commands = Array.from({ length: 10 }, (_, index) => gateway.execute({
      id: `evt-${index}`, stream: "s", streamSequence: index + 1, type: "demo", actor: "u",
      idempotencyKey: `k-${index}`, payload: { index },
      apply: async () => new Promise((resolve) => setTimeout(() => resolve(index), index % 3)),
    }));
    await expect(Promise.all(commands)).resolves.toHaveLength(10);
    const count = driver.database.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
    expect(count.c).toBe(10);
  });

  it("coordinates writes from independent adapters through SQLite file locking", async () => {
    const first = new SqliteDriver({ filePath: join(workDir, "shared.sqlite"), busyTimeoutMs: 5_000 });
    const second = new SqliteDriver({ filePath: join(workDir, "shared.sqlite"), busyTimeoutMs: 5_000 });
    driver = first;
    first.database.exec(`CREATE TABLE events(
                            id TEXT PRIMARY KEY,
                            stream TEXT NOT NULL,
                            stream_seq INTEGER NOT NULL,
                            type TEXT NOT NULL,
                            occurred_at TEXT NOT NULL,
                            actor TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            payload_hash TEXT NOT NULL,
                            idempotency_key TEXT,
                            UNIQUE(stream, stream_seq)
                          );
                          CREATE TABLE idempotency_results(key TEXT PRIMARY KEY, value TEXT NOT NULL, recorded_at TEXT NOT NULL)`);
    const firstGateway = new StorageGateway(first);
    const secondGateway = new StorageGateway(second);
    await expect(Promise.all([
      firstGateway.execute({ id: "shared-1", stream: "shared", streamSequence: 1, type: "demo", actor: "first", idempotencyKey: "shared-k1", payload: { source: "first" }, apply: async () => "first" }),
      secondGateway.execute({ id: "shared-2", stream: "shared", streamSequence: 2, type: "demo", actor: "second", idempotencyKey: "shared-k2", payload: { source: "second" }, apply: async () => "second" }),
    ])).resolves.toEqual(["first", "second"]);
    expect(first.database.prepare("SELECT COUNT(*) AS c FROM events").get()).toMatchObject({ c: 2 });
    second.close();
  });
});
