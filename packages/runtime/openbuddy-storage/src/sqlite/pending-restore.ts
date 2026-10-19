/**
 * pending-restore.ts — 用户数据备份的"暂存 + 下次启动生效"恢复流
 * (P0.8/P1,生产评审 数据§7:driver.backup()/restoreStorageBackup() 曾零调用方)。
 *
 * 为什么不在运行中直接换文件:openbuddy.sqlite 由进程内多个 driver 常驻打开,
 * 运行中 swap 是未定义行为。流程:
 *   1. 设置页点「恢复备份」→ IPC 原生确认 → `stageStorageRestore()`
 *      (restoreStorageBackup 校验 + 发布到 `.pending-restore.sqlite` + 写标记);
 *   2. 应用重启 → `SessionMetadataStore` 开库前调 `applyPendingStorageRestore()`
 *      → 现库(含 -wal/-shm)挪到 `.pre-restore-<时间戳>` → 暂存文件顶上 → 删标记;
 *   3. 开库照常进行。任何一步失败都不 brick:恢复失败时清标记、保留现库。
 */
import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { restoreStorageBackup } from "./restore";

const MARKER_SUFFIX = ".pending-restore.json";
const STAGED_SUFFIX = ".pending-restore.sqlite";

export interface StageStorageRestoreOptions {
  backupPath: string;
  databasePath: string;
  appVersion?: string;
}

export interface StageStorageRestoreResult {
  /** 校验通过后发布的暂存文件路径。 */
  stagedPath: string;
  schemaVersion: number;
}

/** 校验备份并暂存;写入标记文件等下次启动生效。当前库不受影响。 */
export async function stageStorageRestore(options: StageStorageRestoreOptions): Promise<StageStorageRestoreResult> {
  const directory = dirname(options.databasePath);
  // restoreStorageBackup 要求 destination 不存在 —— 每次用唯一暂存名。
  const stagingTarget = join(directory, `.${randomUUID()}.stage.sqlite`);
  const validated = await restoreStorageBackup({
    backupPath: options.backupPath,
    destinationPath: stagingTarget,
    appVersion: options.appVersion,
  });
  const stagedPath = join(directory, `${basename(options.databasePath)}${STAGED_SUFFIX}`);
  await rm(stagedPath, { force: true });
  try {
    await copyFile(stagingTarget, stagedPath);
  } finally {
    await rm(stagingTarget, { force: true }).catch(() => undefined);
  }
  await writeFile(
    join(options.databasePath + MARKER_SUFFIX),
    `${JSON.stringify({ backupPath: options.backupPath, stagedPath, schemaVersion: validated.schemaVersion, stagedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return { stagedPath, schemaVersion: validated.schemaVersion };
}

export interface ApplyPendingRestoreResult {
  restored: true;
  quarantined: string[];
  schemaVersion: number;
}

/**
 * 开库前调用:存在恢复标记则把现库挪到 `.pre-restore-<时间戳>` 并让暂存库
 * 顶上。无标记时返回 null(绝大多数启动)。恢复动作本身失败时**清掉标记并
 * 返回 null** —— 现库原封不动,宁可维持现状也不 brick 启动。
 */
export async function applyPendingStorageRestore(databasePath: string): Promise<ApplyPendingRestoreResult | null> {
  const markerPath = `${databasePath}${MARKER_SUFFIX}`;
  let marker: { stagedPath?: string; schemaVersion?: number };
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return null;
  }
  const stagedPath = typeof marker.stagedPath === "string" ? marker.stagedPath : join(dirname(databasePath), `${basename(databasePath)}${STAGED_SUFFIX}`);
  try {
    await stat(stagedPath);
  } catch {
    // 暂存文件丢了(被用户清理)—— 清标记,按无恢复处理。
    await rm(markerPath, { force: true }).catch(() => undefined);
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantined: string[] = [];
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const source = `${databasePath}${suffix}`;
    try {
      await stat(source);
      const target = `${source}.pre-restore-${stamp}`;
      await rename(source, target);
      quarantined.push(target);
    } catch {
      /* 无此文件,跳过 */
    }
  }
  await copyFile(stagedPath, databasePath);
  await rm(markerPath, { force: true }).catch(() => undefined);
  await rm(stagedPath, { force: true }).catch(() => undefined);
  for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    await rm(sidecar, { force: true }).catch(() => undefined);
  }
  return {
    restored: true,
    quarantined,
    schemaVersion: typeof marker.schemaVersion === "number" ? marker.schemaVersion : 0,
  };
}

/**
 * {@link applyPendingStorageRestore} 的同步变体 —— SessionMetadataStore 在
 * **构造函数**里开库(全同步),恢复必须在开库前完成。语义一致:失败清标记
 * 返回 null,现库原封不动。
 */
export function applyPendingStorageRestoreSync(databasePath: string): ApplyPendingRestoreResult | null {
  const markerPath = `${databasePath}${MARKER_SUFFIX}`;
  let marker: { stagedPath?: string; schemaVersion?: number };
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
  const stagedPath =
    typeof marker.stagedPath === "string"
      ? marker.stagedPath
      : join(dirname(databasePath), `${basename(databasePath)}${STAGED_SUFFIX}`);
  try {
    statSync(stagedPath);
  } catch {
    try { rmSync(markerPath, { force: true }); } catch { /* best-effort */ }
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantined: string[] = [];
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const source = `${databasePath}${suffix}`;
    try {
      statSync(source);
      const target = `${source}.pre-restore-${stamp}`;
      renameSync(source, target);
      quarantined.push(target);
    } catch {
      /* 无此文件,跳过 */
    }
  }
  copyFileSync(stagedPath, databasePath);
  try { rmSync(markerPath, { force: true }); } catch { /* best-effort */ }
  try { rmSync(stagedPath, { force: true }); } catch { /* best-effort */ }
  for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    try { rmSync(sidecar, { force: true }); } catch { /* best-effort */ }
  }
  return {
    restored: true,
    quarantined,
    schemaVersion: typeof marker.schemaVersion === "number" ? marker.schemaVersion : 0,
  };
}

/**
 * 手动备份:对一个已存在的库文件跑 `VACUUM INTO`(经临时 driver,不触碰
 * 进程内的常驻连接;WAL 允许多连接读)。返回备份路径与 schema 版本。
 */
export async function createStorageBackup(databasePath: string, destination?: string): Promise<{ path: string; schemaVersion: number }> {
  // 库不存在时不"备份"一个空库(会误导用户以为数据备份好了)。
  if (!existsSync(databasePath)) throw new Error(`database not found: ${databasePath}`);
  const { SqliteDriver } = await import("./driver");
  const { dirname: dir } = await import("node:path");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = destination ?? join(dir(databasePath), "backups", `openbuddy-${stamp}.sqlite`);
  mkdirSync(dir(target), { recursive: true });
  const driver = new SqliteDriver({ filePath: databasePath });
  try {
    const result = await driver.backup(target);
    return { path: result.path, schemaVersion: result.schemaVersion };
  } finally {
    driver.close();
  }
}
