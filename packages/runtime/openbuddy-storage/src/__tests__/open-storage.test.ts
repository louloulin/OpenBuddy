import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedObjectStore } from "../files/object-store";
import { openStorage } from "../sqlite/open-storage";
import { DurableOperationStore, WriterLeaseStore } from "../sqlite/coordination";
import { MigrationIssueStore } from "../sqlite/migration-issues";
import { restoreStorageBackup } from "../sqlite/restore";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

describe("openStorage", () => {
  it("creates the profile directory, applies the complete schema and checks integrity", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-open-storage-"));
    const databasePath = join(root, "profile", "openbuddy.sqlite");
    const result = await openStorage({ filePath: databasePath });
    expect(result.migration.finalVersion).toBe(11);
    expect(result.migration.applied).toBe(11);
    expect(result.driver.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()).toBeTruthy();
    await expect(result.driver.integrityCheck()).resolves.toMatchObject({ ok: true });
    const backupPath = join(root, "profile", "backup.sqlite");
    await result.driver.backup(backupPath);
    expect(result.driver.database.prepare("SELECT COUNT(*) AS c FROM backup_manifests").get()).toMatchObject({ c: 1 });
    result.driver.close();
    const restoredPath = join(root, "restored", "openbuddy.sqlite");
    await mkdir(join(root, "restored"), { recursive: true });
    await copyFile(backupPath, restoredPath);
    const restored = await openStorage({ filePath: restoredPath });
    expect(restored.driver.database.prepare("SELECT version, status FROM schema_meta WHERE status = 'applied' ORDER BY version").all()).toHaveLength(11);
    await expect(restored.driver.integrityCheck()).resolves.toMatchObject({ ok: true });
    restored.driver.close();
  });

  it("serializes backup behind queued writes", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-backup-queue-"));
    const source = await openStorage({ filePath: join(root, "source.sqlite") });
    source.driver.database.exec("CREATE TABLE backup_queue_test(id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = source.driver.enqueue(async (database) => {
      await gate;
      database.prepare("INSERT INTO backup_queue_test(id, value) VALUES (1, 'queued')").run();
    });
    const backupPath = join(root, "queued-backup.sqlite");
    const backup = source.driver.backup(backupPath);
    release();
    await Promise.all([pending, backup]);
    source.driver.close();
    const restored = await openStorage({ filePath: backupPath });
    expect(restored.driver.database.prepare("SELECT value FROM backup_queue_test WHERE id = 1").get()).toMatchObject({ value: "queued" });
    restored.driver.close();
  });

  it("allows concurrent first opens of one profile to converge on one schema", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-concurrent-open-"));
    const databasePath = join(root, "profile", "openbuddy.sqlite");
    const results = await Promise.all(Array.from({ length: 4 }, () => openStorage({ filePath: databasePath, busyTimeoutMs: 5_000 })));
    expect(results.map((result) => result.migration.finalVersion)).toEqual([11, 11, 11, 11]);
    expect(results.map((result) => result.migration.applied).sort((a, b) => a - b)).toEqual([0, 0, 0, 11]);
    expect(results[0]?.driver.database.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE status = 'applied'").get()).toMatchObject({ count: 11 });
    await expect(results[0]?.driver.integrityCheck()).resolves.toMatchObject({ ok: true });
    for (const result of results) result.driver.close();
  });

  it("fences writer leases and persists retryable durable operations", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-coordination-"));
    const result = await openStorage({ filePath: join(root, "openbuddy.sqlite") });
    const leases = new WriterLeaseStore(result.driver, () => "2026-08-30T00:00:00.000Z");
    const first = await leases.acquire("profile", "owner-a", 10_000);
    expect(first).toMatchObject({ ownerId: "owner-a", fencingToken: 1 });
    await expect(leases.acquire("profile", "owner-b", 10_000)).resolves.toBeUndefined();
    expect(await leases.renew(first!, 20_000)).toMatchObject({ fencingToken: 1 });
    expect(await leases.release(first!)).toBe(true);
    const second = await leases.acquire("profile", "owner-b", 10_000);
    expect(second).toMatchObject({ ownerId: "owner-b", fencingToken: 2 });

    const operations = new DurableOperationStore(result.driver, () => "2026-08-30T00:00:00.000Z");
    await expect(operations.begin("op-1", "idem-1", "export", { path: "out" })).resolves.toMatchObject({ status: "pending", attempt: 0 });
    expect(await operations.claim("op-1", second!.fencingToken)).toMatchObject({ status: "running", attempt: 1, fencingToken: 2 });
    expect(await operations.fail("op-1", "temporary", 1)).toBeUndefined();
    expect(await operations.fail("op-1", "temporary", 2)).toMatchObject({ status: "failed", attempt: 1, error: "temporary" });
    expect(await operations.claim("op-1", 2)).toMatchObject({ status: "running", attempt: 2 });
    expect(await operations.complete("op-1", { ok: true }, 2)).toMatchObject({ status: "succeeded", result: { ok: true } });
    result.driver.close();
  });

  it("persists, lists, and resolves migration issues", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-migration-issues-"));
    const result = await openStorage({ filePath: join(root, "openbuddy.sqlite") });
    const issues = new MigrationIssueStore(result.driver, () => "2026-08-30T00:00:00.000Z");
    const recorded = await issues.record({ issueId: "issue-1", sourcePath: "/fixture/settings.json", issueType: "compatibility_write_failed", detail: "fixture failure", sourceHash: "hash-1" });
    expect(recorded).toMatchObject({ issueId: "issue-1" });
    expect(recorded).not.toHaveProperty("resolvedAt");
    expect(issues.list()).toMatchObject([{ issueId: "issue-1", sourcePath: "/fixture/settings.json", issueType: "compatibility_write_failed" }]);
    await expect(issues.resolve("issue-1")).resolves.toBe(true);
    expect(issues.list()).toEqual([]);
    expect(issues.list({ includeResolved: true })).toMatchObject([{ issueId: "issue-1", resolvedAt: "2026-08-30T00:00:00.000Z" }]);
    result.driver.close();
  });

  it("validates and atomically restores a backup without overwriting a destination", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-restore-"));
    const source = await openStorage({ filePath: join(root, "source", "openbuddy.sqlite") });
    source.driver.database.prepare("INSERT INTO settings(namespace, setting_key, value_json, version, updated_at) VALUES (?, ?, ?, ?, ?)").run("restore", "marker", JSON.stringify({ ok: true }), 1, "2026-08-30");
    const backupPath = join(root, "backup.sqlite");
    await source.driver.backup(backupPath);
    source.driver.close();

    const destination = join(root, "restored", "openbuddy.sqlite");
    await expect(restoreStorageBackup({ backupPath, destinationPath: destination })).resolves.toMatchObject({ path: destination, schemaVersion: 11, integrity: { ok: true } });
    const restored = await openStorage({ filePath: destination });
    expect(restored.driver.database.prepare("SELECT value_json FROM settings WHERE namespace = ? AND setting_key = ?").get("restore", "marker")).toMatchObject({ value_json: JSON.stringify({ ok: true }) });
    restored.driver.close();
    await expect(restoreStorageBackup({ backupPath, destinationPath: destination })).rejects.toThrow("destination already exists");

    const secondDestination = join(root, "restored-again", "openbuddy.sqlite");
    await expect(restoreStorageBackup({ backupPath, destinationPath: secondDestination })).resolves.toMatchObject({ path: secondDestination });
    await expect(stat(secondDestination)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("rejects a corrupt backup and removes the temporary restore file", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-corrupt-restore-"));
    const backupPath = join(root, "corrupt.sqlite");
    await writeFile(backupPath, "not a sqlite database");
    await expect(restoreStorageBackup({ backupPath, destinationPath: join(root, "restored.sqlite") })).rejects.toThrow();
    await expect(stat(join(root, "restored.sqlite"))).rejects.toThrow();
  });
});

describe("ContentAddressedObjectStore", () => {
  it("deduplicates objects by hash and rejects unsafe paths", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-object-store-"));
    const store = new ContentAddressedObjectStore(join(root, "objects"));
    const data = new TextEncoder().encode("hello");
    const first = await store.put(data, "text/plain");
    const second = await store.put(data, "text/plain");
    expect(second).toEqual(first);
    expect(await store.get(first.hash)).toEqual(Buffer.from(data));
    expect(existsSync(store.pathFor(first.hash))).toBe(true);
    await expect(store.get("../unsafe")).rejects.toThrow("Invalid object hash");
    expect((await stat(store.pathFor(first.hash))).size).toBe(5);
  });
});
