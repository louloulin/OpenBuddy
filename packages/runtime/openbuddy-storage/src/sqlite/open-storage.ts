import { mkdir } from "node:fs/promises";
import { mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MIGRATIONS, DowngradeBlockedError, MigrationRunner } from "./migration";
import { SqliteDriver, type JournalMode } from "./driver";

export interface OpenStorageOptions {
  filePath: string;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
  journalMode?: JournalMode;
  appVersion?: string;
  /**
   * P0.8(2026-10-19 生产评审 数据§1):损坏隔离回调。此前 integrity check
   * 失败会直接 throw,而 SessionMetadataStore 在模块作用域打开库 —— agent
   * host 永久砖死,只能手工删文件。现在损坏库(含 -wal/-shm)被挪到
   * `<file>.corrupt-<时间戳>` 并重建空库,通过此回调通知调用方(日志/横幅)。
   */
  onCorruptIsolated?: (quarantined: { db: string | null; sidecars: string[] }) => void;
}

export interface OpenStorageResult {
  driver: SqliteDriver;
  migration: Awaited<ReturnType<MigrationRunner["run"]>>;
}

export interface OpenStorageSyncResult {
  driver: SqliteDriver;
  migration: ReturnType<MigrationRunner["runSync"]>;
}

/**
 * Accepts either the promise returned by {@link openStorage} or the already
 * resolved result, so callers can do `await closeStorage(openStorage(...))`
 * and `await closeStorage(storage)` without unwrapping a promise by hand.
 */
export async function closeStorage(
  storage: Promise<OpenStorageResult> | OpenStorageResult | undefined,
): Promise<void> {
  if (!storage) return;
  const result = await storage;
  try {
    await result.driver.flush();
  } finally {
    result.driver.close();
  }
}

/** 把损坏的库与 sidecar 挪到 `.corrupt-<时间戳>` 隔离名下。全失败返回 null。 */
function quarantineCorruptDatabase(filePath: string): { db: string | null; sidecars: string[] } {
  if (filePath === ":memory:") return { db: null, sidecars: [] };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const moved: string[] = [];
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const source = `${filePath}${suffix}`;
    const target = `${filePath}${suffix}.corrupt-${stamp}`;
    try {
      renameSync(source, target);
      moved.push(target);
    } catch {
      /* 文件不存在,跳过 */
    }
  }
  return { db: moved[0] ?? null, sidecars: moved.slice(1) };
}

const MAX_ATTEMPTS = 2;

export async function openStorage(options: OpenStorageOptions): Promise<OpenStorageResult> {
  if (options.filePath !== ":memory:") await mkdir(dirname(options.filePath), { recursive: true });
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const driver = new SqliteDriver(options);
    try {
      const migration = await new MigrationRunner({
        steps: DEFAULT_MIGRATIONS,
        appVersion: options.appVersion ?? "openbuddy-storage",
      }).run(driver);
      const integrity = await driver.integrityCheck();
      if (!integrity.ok) throw new Error(`SQLite integrity check failed: ${integrity.detail ?? integrity.foreignKeys ?? "unknown"}`);
      return { driver, migration };
    } catch (error) {
      driver.close();
      // 降级拦截(未来库)绝不能触发隔离 —— 那会毁掉新版写入的数据。
      // 原样上抛,由调用方提示「升级应用」。
      if (error instanceof DowngradeBlockedError) throw error;
      lastError = error;
      // 首次失败:隔离损坏库并重试一次(重建空库)。重试再失败才向上抛。
      if (attempt < MAX_ATTEMPTS) {
        const quarantined = quarantineCorruptDatabase(options.filePath);
        if (quarantined.db === null && quarantined.sidecars.length === 0) break;
        options.onCorruptIsolated?.(quarantined);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function openStorageSync(options: OpenStorageOptions): OpenStorageSyncResult {
  if (options.filePath !== ":memory:") mkdirSync(dirname(options.filePath), { recursive: true });
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const driver = new SqliteDriver(options);
    try {
      const migration = new MigrationRunner({
        steps: DEFAULT_MIGRATIONS,
        appVersion: options.appVersion ?? "openbuddy-storage",
      }).runSync(driver);
      const integrity = driver.integrityCheckSync();
      if (!integrity.ok) throw new Error(`SQLite integrity check failed: ${integrity.detail ?? integrity.foreignKeys ?? "unknown"}`);
      return { driver, migration };
    } catch (error) {
      driver.close();
      if (error instanceof DowngradeBlockedError) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const quarantined = quarantineCorruptDatabase(options.filePath);
        if (quarantined.db === null && quarantined.sidecars.length === 0) break;
        options.onCorruptIsolated?.(quarantined);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
