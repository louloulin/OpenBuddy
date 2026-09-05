import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MIGRATIONS, MigrationRunner } from "./migration";
import { SqliteDriver, type JournalMode } from "./driver";

export interface OpenStorageOptions {
  filePath: string;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
  journalMode?: JournalMode;
  appVersion?: string;
}

export interface OpenStorageResult {
  driver: SqliteDriver;
  migration: Awaited<ReturnType<MigrationRunner["run"]>>;
}

export interface OpenStorageSyncResult {
  driver: SqliteDriver;
  migration: ReturnType<MigrationRunner["runSync"]>;
}

export async function closeStorage(storage: Promise<OpenStorageResult> | undefined): Promise<void> {
  if (!storage) return;
  const result = await storage;
  try {
    await result.driver.flush();
  } finally {
    result.driver.close();
  }
}

export async function openStorage(options: OpenStorageOptions): Promise<OpenStorageResult> {
  if (options.filePath !== ":memory:") await mkdir(dirname(options.filePath), { recursive: true });
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
    throw error;
  }
}

export function openStorageSync(options: OpenStorageOptions): OpenStorageSyncResult {
  if (options.filePath !== ":memory:") mkdirSync(dirname(options.filePath), { recursive: true });
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
    throw error;
  }
}
