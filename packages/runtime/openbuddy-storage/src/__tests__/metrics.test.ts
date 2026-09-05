import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageMetricsRegistry } from "../observability/metrics";
import { SqliteDriver, storageMetricsRegistry } from "../sqlite/driver";
import { DEFAULT_MIGRATIONS, MigrationRunner } from "../sqlite/migration";
import { MigrationIssueStore } from "../sqlite/migration-issues";

let root = "";
let driver: SqliteDriver | undefined;

afterEach(async () => {
  driver?.close();
  driver = undefined;
  await rm(root, { recursive: true, force: true });
  root = "";
});

describe("StorageMetricsRegistry", () => {
  it("counts writes, busy events, and rollbacks with deterministic latency stats", () => {
    const registry = new StorageMetricsRegistry();
    registry.recordWrite("db-a", 5, "ok", "2026-08-30T00:00:00.000Z");
    registry.recordWrite("db-a", 25, "ok", "2026-08-30T00:00:01.000Z");
    registry.recordWrite("db-a", 12, "rollback", "2026-08-30T00:00:02.000Z");
    registry.recordWrite("db-a", 4, "busy", "2026-08-30T00:00:03.000Z");
    const snapshot = registry.snapshot("db-a", 1, 10, 0);
    expect(snapshot).toEqual({
      writes: 4,
      busy: 1,
      rollbacks: 1,
      totalLatencyMs: 46,
      maxLatencyMs: 25,
      lastWriteAt: "2026-08-30T00:00:03.000Z",
      queueDepth: 1,
      schemaVersion: 10,
      migrationIssues: 0,
    });
  });

  it("driver healthSnapshot exposes metrics, migration issues, and backup age", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-metrics-"));
    driver = new SqliteDriver({ filePath: join(root, "openbuddy.sqlite") });
    await new MigrationRunner({ steps: DEFAULT_MIGRATIONS }).run(driver);
    new MigrationIssueStore(driver, () => "2026-08-30T00:00:00.000Z")
      .record({ issueType: "missing", detail: "fixture", sourcePath: "/tmp/fixture.json" });
    await driver.runExclusive(async (database) => {
      database.prepare("INSERT INTO settings(namespace, setting_key, value_json, version, updated_at) VALUES (?, ?, ?, 1, ?)")
        .run("metrics.test", "k", JSON.stringify({ ok: true }), "2026-08-30T00:00:00.000Z");
    });
    await driver.backup(join(root, "backup.sqlite"));
    storageMetricsRegistry().reset(driver["writeQueueKey"] ?? "");
    storageMetricsRegistry().recordWrite(driver["writeQueueKey"] ?? "", 7, "ok", "2026-08-30T00:00:00.000Z");
    const snapshot = driver.healthSnapshot();
    expect(snapshot.metrics).toMatchObject({ writes: 1, busy: 0, rollbacks: 0, migrationIssues: 1 });
    expect(snapshot.metrics?.lastBackupAt).toBeDefined();
    expect(snapshot.metrics?.lastWriteAt).toBe("2026-08-30T00:00:00.000Z");
    expect(snapshot.metrics?.totalLatencyMs).toBe(7);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("fixture-secret");
  });
});
  it("keeps a bounded history of recent snapshots", () => {
    const registry = new StorageMetricsRegistry();
    for (let i = 0; i < 5; i += 1) {
      registry.recordSnapshot({
        writes: i,
        busy: 0,
        rollbacks: 0,
        totalLatencyMs: i,
        maxLatencyMs: i,
        queueDepth: 0,
        schemaVersion: 10,
        migrationIssues: 0,
      }, 3);
    }
    expect(registry.recentHistory(3)).toHaveLength(3);
    expect(registry.recentHistory(3).map((entry) => entry.writes)).toEqual([2, 3, 4]);
    registry.clearHistory();
    expect(registry.recentHistory()).toEqual([]);
  });
