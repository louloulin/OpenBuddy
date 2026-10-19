/**
 * migration-fixture.test.ts — 数据§3(2026-10-19 生产评审):迁移零测试。
 *
 * 四类契约:
 *   1. vN → vN+1 升级(数据保留、只跑增量);
 *   2. 幂等(重复运行不再应用);
 *   3. 失败步回滚(版本不前进、失败记录落库、修好后可继续);
 *   4. 降级拒绝(未来库 DowngradeBlockedError,已在 open-storage.test.ts 覆盖)。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteDriver } from "../sqlite/driver";
import { MigrationRunner, type MigrationStep } from "../sqlite/migration";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function step(version: number, up: (driver: SqliteDriver) => void): MigrationStep {
  return { version, description: `fixture step ${version}`, up };
}

async function openDriver(): Promise<SqliteDriver> {
  root = await mkdtemp(join(tmpdir(), "openbuddy-migration-fixture-"));
  const databasePath = join(root, "data", "fixture.sqlite");
  await mkdir(dirname(databasePath), { recursive: true });
  return new SqliteDriver({ filePath: databasePath });
}

describe("MigrationRunner fixtures", () => {
  it("vN → vN+1 升级:只跑增量且已有数据保留", async () => {
    const driver = await openDriver();
    try {
      const first = new MigrationRunner({ steps: [step(1, (d) => d.database.exec("CREATE TABLE t1(value TEXT)")), step(2, (d) => d.database.exec("CREATE TABLE t2(value TEXT)"))] });
      expect(first.runSync(driver)).toMatchObject({ applied: 2, finalVersion: 2 });
      driver.database.prepare("INSERT INTO t1(value) VALUES ('kept')").run();

      const upgraded = new MigrationRunner({
        steps: [
          step(1, (d) => d.database.exec("CREATE TABLE t1(value TEXT)")),
          step(2, (d) => d.database.exec("CREATE TABLE t2(value TEXT)")),
          step(3, (d) => d.database.exec("ALTER TABLE t1 ADD COLUMN extra TEXT")),
        ],
      });
      const result = upgraded.runSync(driver);
      expect(result).toMatchObject({ applied: 1, finalVersion: 3 });
      expect(result.history).toEqual([{ version: 3, status: "applied" }]);
      expect(driver.database.prepare("SELECT value FROM t1").all()).toEqual([{ value: "kept" }]);
      // user_version 戳同步推进(降级保护依赖它)。
      expect(Number((driver.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(3);
    } finally {
      driver.close();
    }
  });

  it("幂等:同一组步骤重复运行 applied=0", async () => {
    const driver = await openDriver();
    try {
      const runner = new MigrationRunner({ steps: [step(1, (d) => d.database.exec("CREATE TABLE once(value TEXT)"))] });
      expect(runner.runSync(driver).applied).toBe(1);
      expect(runner.runSync(driver).applied).toBe(0);
    } finally {
      driver.close();
    }
  });

  it("失败步:回滚、版本不前进、修好后可继续", async () => {
    const driver = await openDriver();
    try {
      const broken = new MigrationRunner({
        steps: [
          step(1, (d) => d.database.exec("CREATE TABLE base(value TEXT)")),
          step(2, () => {
            throw new Error("fixture failure");
          }),
        ],
      });
      expect(() => broken.runSync(driver)).toThrow(/fixture failure/);
      expect(Number((driver.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(1);
      // 失败记录进 schema_meta,供诊断/迁移问题面板消费。
      const failed = driver.database.prepare("SELECT version, status FROM schema_meta WHERE status = 'failed'").all();
      expect(failed).toEqual([{ version: 2, status: "failed" }]);
      // 修好后重跑:从 v2 继续,成功并推进到 v2。
      const fixed = new MigrationRunner({
        steps: [
          step(1, (d) => d.database.exec("CREATE TABLE base(value TEXT)")),
          step(2, (d) => d.database.exec("CREATE TABLE repaired(value TEXT)")),
        ],
      });
      expect(fixed.runSync(driver)).toMatchObject({ applied: 1, finalVersion: 2 });
    } finally {
      driver.close();
    }
  });
});
