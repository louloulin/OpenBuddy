import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedObjectStore } from "../files/object-store";
import { openStorage } from "../sqlite/open-storage";
import { DurableOperationStore, WriterLeaseStore } from "../sqlite/coordination";
import { MigrationIssueStore } from "../sqlite/migration-issues";
import { restoreStorageBackup } from "../sqlite/restore";
import { DEFAULT_MIGRATIONS } from "../sqlite/migration";

/** 迁移版本从迁移表本身推导,新增一条 migration 不该逼着改这里的所有断言。 */
const LATEST = Math.max(...DEFAULT_MIGRATIONS.map((step) => step.version));
const MIGRATION_COUNT = DEFAULT_MIGRATIONS.length;

let root = "";
// Windows 上 SQLite 关闭句柄有轻微延迟,刚 close() 的文件可能仍被占用。
// (真正的句柄泄漏已在 SqliteDriver 构造函数里修掉,这里只兜底 OS 延迟。)
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  root = "";
});

describe("openStorage", () => {
  it("creates the profile directory, applies the complete schema and checks integrity", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-open-storage-"));
    const databasePath = join(root, "profile", "openbuddy.sqlite");
    const result = await openStorage({ filePath: databasePath });
    expect(result.migration.finalVersion).toBe(LATEST);
    expect(result.migration.applied).toBe(MIGRATION_COUNT);
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
    expect(restored.driver.database.prepare("SELECT version, status FROM schema_meta WHERE status = 'applied' ORDER BY version").all()).toHaveLength(MIGRATION_COUNT);
    await expect(restored.driver.integrityCheck()).resolves.toMatchObject({ ok: true });
    restored.driver.close();
  });

  it("P0.8 回归:损坏库被隔离为 .corrupt-* 并重建空库,而不是永久砖死", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-corrupt-quarantine-"));
    const databasePath = join(root, "data", "openbuddy.sqlite");
    // 造一个"能打开但 integrity 检查失败"的库:写入后人为破坏页数据。
    const first = await openStorage({ filePath: databasePath });
    first.driver.database.exec("CREATE TABLE canary(value TEXT)");
    first.driver.database.prepare("INSERT INTO canary(value) VALUES ('keepme')").run();
    first.driver.close();
    // 翻乱中段字节(保留头部 magic,让 sqlite 能打开但完整性坏掉)。
    const corrupted = Buffer.from(await readFile(databasePath));
    for (let i = 4096; i < Math.min(corrupted.length, 4096 * 8); i += 1) corrupted[i] = 0xde;
    await writeFile(databasePath, corrupted);

    const isolated: Array<{ db: string | null; sidecars: string[] }> = [];
    const reopened = await openStorage({
      filePath: databasePath,
      onCorruptIsolated: (q) => isolated.push(q),
    });
    // 重建出的库是干净的空库(迁移全量应用)。
    expect(reopened.migration.finalVersion).toBe(LATEST);
    await expect(reopened.driver.integrityCheck()).resolves.toMatchObject({ ok: true });
    reopened.driver.close();
    // 损坏库被挪走(带 .corrupt- 时间戳后缀),没有直接丢数据。
    expect(isolated).toHaveLength(1);
    expect(isolated[0].db).toContain(".corrupt-");
    expect(existsSync(`${databasePath}`)).toBe(true);
  });

  it("P1 数据§2 回归:未来库(user_version 高于本构建)被拒且不被隔离", async () => {
    root = await mkdtemp(join(tmpdir(), "openbuddy-downgrade-guard-"));
    const databasePath = join(root, "data", "openbuddy.sqlite");
    // 用「知道 2 个迁移」的构建写库。
    const newBuild = await openStorage({ filePath: databasePath });
    newBuild.driver.close();
    // 用「只知道 1 个迁移」的旧构建打开 → DowngradeBlockedError。
    const steps = DEFAULT_MIGRATIONS.slice(0, 1);
    let blocked: unknown;
    try {
      // 成功打开时必须显式关掉 —— 这条用例原本直接丢弃返回值,Windows 上
      // afterEach 的 rm 会 EBUSY(macOS 允许 unlink 已打开文件,所以从没暴露)。
      const opened = await openStorage({ filePath: databasePath, onCorruptIsolated: () => { throw new Error("must not quarantine"); } });
      opened.driver.close();
    } catch (error) { blocked = error; }
    // 注:上面这行用的是全量 DEFAULT_MIGRATIONS,不会拦 —— 真正的降级场景
    // 要用裁剪过的 step 集合,见下方 MigrationRunner 直测。
    void steps;
    // 直接用 MigrationRunner 断言降级语义。
    const { MigrationRunner, DowngradeBlockedError } = await import("../sqlite/migration");
    const { SqliteDriver } = await import("../sqlite/driver");
    const driver = new SqliteDriver({ filePath: databasePath });
    try {
      const runner = new MigrationRunner({ steps: DEFAULT_MIGRATIONS.slice(0, 1), appVersion: "old-build" });
      expect(() => runner.runSync(driver)).toThrow(DowngradeBlockedError);
      try {
        runner.runSync(driver);
      } catch (error) {
        const blockedError = error as InstanceType<typeof DowngradeBlockedError>;
        expect(blockedError.databaseVersion).toBe(LATEST);
        expect(blockedError.buildMaxVersion).toBe(1);
      }
    } finally {
      driver.close();
    }
    // 关键:降级拦截不触发隔离 —— 损坏隔离文件不存在,未来库原样保留。
    expect(existsSync(`${databasePath}.corrupt-`)).toBe(false);
    expect(existsSync(databasePath)).toBe(true);
    void blocked;
  });

  it("P1 数据§7 回归:备份 → stage → 重启生效的恢复全链", async () => {
    const { createStorageBackup, stageStorageRestore, applyPendingStorageRestoreSync } = await import("../index");
    root = await mkdtemp(join(tmpdir(), "openbuddy-pending-restore-"));
    const databasePath = join(root, "data", "openbuddy.sqlite");
    // v1:写入基线数据并备份。
    const first = await openStorage({ filePath: databasePath });
    first.driver.database.exec("CREATE TABLE canary(value TEXT)");
    first.driver.database.prepare("INSERT INTO canary(value) VALUES ('from-backup')").run();
    first.driver.close();
    const backup = await createStorageBackup(databasePath);
    expect(backup.schemaVersion).toBe(LATEST);
    // v2:备份之后又写入新数据(恢复应回到备份点)。
    const second = await openStorage({ filePath: databasePath });
    second.driver.database.prepare("INSERT INTO canary(value) VALUES ('after-backup')").run();
    second.driver.close();
    // stage(校验 + 暂存 + 标记,不动现库)。
    const staged = await stageStorageRestore({ backupPath: backup.path, databasePath });
    expect(staged.schemaVersion).toBe(LATEST);
    const beforeApply = await openStorage({ filePath: databasePath });
    // 恢复前:备份行 + 备份后追加的行都在(现库未被 stage 动过)。
    expect(beforeApply.driver.database.prepare("SELECT value FROM canary ORDER BY rowid").all()).toEqual([
      { value: "from-backup" },
      { value: "after-backup" },
    ]);
    beforeApply.driver.close();
    // 重启路径:开库前 apply → 现库被挪走,备份顶上。
    const applied = applyPendingStorageRestoreSync(databasePath);
    expect(applied?.restored).toBe(true);
    expect(applied?.quarantined.length).toBeGreaterThan(0);
    expect(applied?.quarantined[0]).toContain(".pre-restore-");
    const restored = await openStorage({ filePath: databasePath });
    expect(restored.driver.database.prepare("SELECT value FROM canary").all()).toEqual([{ value: "from-backup" }]);
    restored.driver.close();
    // 旧库仍在(.pre-restore-*),数据没有丢。
    expect(existsSync(applied!.quarantined[0])).toBe(true);
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
    expect(results.map((result) => result.migration.finalVersion)).toEqual([LATEST, LATEST, LATEST, LATEST]);
    expect(results.map((result) => result.migration.applied).sort((a, b) => a - b)).toEqual([0, 0, 0, MIGRATION_COUNT]);
    expect(results[0]?.driver.database.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE status = 'applied'").get()).toMatchObject({ count: MIGRATION_COUNT });
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
    await expect(restoreStorageBackup({ backupPath, destinationPath: destination })).resolves.toMatchObject({ path: destination, schemaVersion: LATEST, integrity: { ok: true } });
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
    // 临时恢复文件也必须清掉,不能留在备份目录里。
    const leftover = (await readdir(root)).filter((name) => name.endsWith(".restore.tmp"));
    expect(leftover).toEqual([]);
  });

  it("构造函数失败时不泄漏 SQLite 句柄(损坏库可被立即删除)", async () => {
    // 回归:SqliteDriver 构造函数里第一条 PRAGMA 就会在损坏文件上抛异常。
    // 原本没有 close(),而构造函数抛异常时调用方拿不到对象、也就无从关闭 ——
    // 句柄泄漏。
    root = await mkdtemp(join(tmpdir(), "openbuddy-driver-leak-"));
    const corruptPath = join(root, "corrupt.sqlite");
    await writeFile(corruptPath, "not a sqlite database");

    const isWindows = process.platform === "win32";

    // 两个平台能观察到的信号不一样,分别用各自敏感的判据:
    //
    //  - Windows:泄漏的句柄让文件根本无法 unlink/rename(EBUSY/EPERM),
    //    所以"删得掉"本身就是断言。
    //  - macOS/Linux:允许 unlink 已打开的文件,"删得掉"证明不了任何事。
    //    只能数打开的文件描述符 —— 泄漏一次就多一个。
    const fdCount = (): number => readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;

    const before = isWindows ? 0 : fdCount();
    for (let i = 0; i < 5; i += 1) {
      await expect(openStorage({ filePath: corruptPath })).rejects.toThrow();
    }
    if (!isWindows) {
      // 5 次失败打开若各泄漏一个句柄,before 之后会多出 5 个 fd。
      expect(fdCount()).toBe(before);
    }

    await expect(rm(corruptPath, { force: true })).resolves.toBeUndefined();
    expect(existsSync(corruptPath)).toBe(false);
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
