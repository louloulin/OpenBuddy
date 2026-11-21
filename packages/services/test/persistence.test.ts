// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, FutureSchemaError, SCHEMA_VERSION, type Migration } from "../src/persistence/schema";
import { SnapshotStore } from "../src/persistence/snapshots";
import { DataBackupService, BUNDLE_KIND, validateBundle } from "../src/persistence/backup";
import { JsonStore } from "../src/settings/settings";
import type { Settings } from "../src/settings/settings";
import { ProjectsService } from "../src/projects/projects";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-data-"));
  dirs.push(dir);
  return dir;
};
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("schema 迁移 (A2)", () => {
  it("upgrades a v0 file to the current version", () => {
    const result = migrate({ providers: [] });
    expect(result).toMatchObject({ from: 0, migrated: true });
    expect(result.data).toMatchObject({ providers: [], schemaVersion: SCHEMA_VERSION });
  });

  it("runs migrations in order and is idempotent", () => {
    const steps = vi.fn();
    const migrations: Record<number, Migration> = {
      0: (data) => ({ ...(data as object), one: true }),
      1: (data) => ({ ...(data as object), two: (data as { one?: boolean }).one === true }),
    };
    const once = migrate({}, migrations, 2);
    steps();
    expect(once.data).toMatchObject({ schemaVersion: 2, one: true, two: true });
    const twice = migrate(once.data, migrations, 2);
    expect(twice.migrated).toBe(false);
    expect(twice.data).toEqual(once.data);
  });

  it("refuses a file written by a newer app version", () => {
    expect(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(FutureSchemaError);
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/future_schema_version/);
  });

  it("reports a missing step instead of guessing", () => {
    expect(() => migrate({}, {}, 2)).toThrow(/missing_migration:0/);
  });
});

describe("损坏自愈与快照 (A2)", () => {
  it("restores the newest snapshot when a data file no longer parses", () => {
    const dir = tempDir();
    const some = join(dir, "some.json");
    writeFileSync(some, JSON.stringify({ projects: [{ id: "p1", name: "好数据" }] }));
    const snapshots = new SnapshotStore(dir);
    const manifest = snapshots.capture("startup", ["some.json"]);
    expect(manifest?.files[0].name).toBe("some.json");
    writeFileSync(some, "{ broken");
    const recovered = vi.fn();
    const store = new JsonStore<{ projects: Array<{ id: string; name: string }> }>(some, () => ({ projects: [] }), {
      versioned: true,
      snapshots,
      onRecover: recovered,
    });
    expect(store.read().projects[0].name).toBe("好数据");
    expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ file: "some.json", restoredFrom: manifest!.id }));
    expect(read(some).schemaVersion).toBe(SCHEMA_VERSION);
    expect(readdirSync(dir).some((name) => name.includes(".corrupt-"))).toBe(false);
  });

  it("quarantines a corrupt file when no snapshot exists", () => {
    const dir = tempDir();
    const some = join(dir, "some.json");
    writeFileSync(some, "not json");
    const store = new JsonStore<{ ok: boolean }>(some, () => ({ ok: false }), {
      versioned: true,
      snapshots: new SnapshotStore(dir),
      onRecover: () => {},
    });
    expect(store.read()).toEqual({ ok: false });
    expect(readdirSync(dir).some((name) => name.startsWith("some.json.corrupt-"))).toBe(true);
  });

  it("keeps only the newest three snapshots", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openbuddy.json"), "{}");
    const snapshots = new SnapshotStore(dir);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 5; i += 1) {
      snapshots.capture(`manual-${i}`);
      // Distinct timestamps keep the ordering deterministic even on a fast disk.
      vi.advanceTimersByTime(1_000);
    }
    vi.useRealTimers();
    expect(snapshots.list()).toHaveLength(3);
  });

  it("snapshots encrypted credentials byte-for-byte", () => {
    const dir = tempDir();
    const credentials = join(dir, "credentials.enc.json");
    writeFileSync(credentials, JSON.stringify({ provider: "ciphertext" }));
    const snapshots = new SnapshotStore(dir);
    snapshots.capture("startup", ["credentials.enc.json"]);
    writeFileSync(credentials, "{}");
    snapshots.restore(snapshots.list()[0].id);
    expect(read(credentials)).toEqual({ provider: "ciphertext" });
  });
});

describe("项目文件版本 (A2)", () => {
  it("migrates the legacy bare array and writes v1", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "projects.json"), JSON.stringify([{ id: "p1", name: "旧项目" }]));
    const settings = { dir, snapshots: new SnapshotStore(dir) } as unknown as Settings;
    const projects = new ProjectsService(settings);
    expect(projects.list().map((project) => project.name)).toEqual(["旧项目"]);
    projects.save({ id: "p2", name: "新项目" } as never);
    const file = read(join(dir, "projects.json"));
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.projects).toHaveLength(2);
  });
});

describe("全量导出 / 恢复 (A2)", () => {
  const settingsFor = (dir: string) => ({ dir, snapshots: new SnapshotStore(dir) }) as unknown as Settings;

  it("exports versioned files, omits machine-bound credentials and restores elsewhere", () => {
    const source = tempDir();
    writeFileSync(join(source, "openbuddy.json"), JSON.stringify({ schemaVersion: 1, permissionMode: "ask" }));
    writeFileSync(join(source, "projects.json"), JSON.stringify({ schemaVersion: 1, projects: [{ id: "p1", name: "项目" }] }));
    writeFileSync(join(source, "credentials.enc.json"), JSON.stringify({ key: "encrypted" }));
    const sourceService = new DataBackupService(settingsFor(source));
    const bundle = sourceService.exportBundle();
    expect(bundle.kind).toBe(BUNDLE_KIND);
    expect(Object.keys(bundle.files).sort()).toEqual(["openbuddy.json", "projects.json"]);
    expect(bundle.omitted).toContain("credentials.enc.json");

    const target = tempDir();
    writeFileSync(join(target, "openbuddy.json"), JSON.stringify({ schemaVersion: 1, permissionMode: "auto" }));
    const targetService = new DataBackupService(settingsFor(target));
    const result = targetService.restoreBundle(JSON.parse(JSON.stringify(bundle)));
    expect(result.restored.sort()).toEqual(["openbuddy.json", "projects.json"]);
    expect(result.restartRequired).toBe(true);
    expect(result.snapshotId).toBeTruthy();
    expect(read(join(target, "openbuddy.json")).permissionMode).toBe("ask");
    expect(read(join(target, "projects.json")).projects[0].name).toBe("项目");
    // The pre-restore snapshot still holds the target's previous value.
    const snapshots = targetService.listSnapshots();
    expect(read(join(target, "snapshots", snapshots[0].id, "openbuddy.json")).permissionMode).toBe("auto");
  });

  it("rejects unknown, oversized and newer bundles before touching disk", () => {
    expect(() => validateBundle({ kind: "other" })).toThrow(/invalid_bundle_kind/);
    expect(() => validateBundle({ kind: BUNDLE_KIND, schemaVersion: 99, files: {} })).toThrow(/future_bundle_version/);
    expect(() => validateBundle({ kind: BUNDLE_KIND, schemaVersion: 1, files: [] })).toThrow(/invalid_bundle_files/);
    const huge = { kind: BUNDLE_KIND, schemaVersion: 1, files: { "openbuddy.json": "x".repeat(21 * 1024 * 1024) } };
    expect(() => validateBundle(huge)).toThrow(/bundle_too_large/);
  });

  it("ignores files outside the covered set", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "openbuddy.json"), JSON.stringify({ schemaVersion: 1 }));
    const service = new DataBackupService(settingsFor(dir));
    const result = service.restoreBundle({ kind: BUNDLE_KIND, schemaVersion: 1, files: { "evil.json": { a: 1 } }, omitted: [] });
    expect(result.restored).toEqual([]);
    expect(result.skipped).toEqual(["evil.json"]);
    expect(existsSync(join(dir, "evil.json"))).toBe(false);
  });
});
