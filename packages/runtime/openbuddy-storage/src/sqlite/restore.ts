import { access, copyFile, link, mkdir, rm, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { openStorage } from "./open-storage";

export interface RestoreStorageBackupOptions {
  backupPath: string;
  destinationPath: string;
  appVersion?: string;
}

export interface RestoreStorageBackupResult {
  path: string;
  schemaVersion: number;
  integrity: { ok: true };
}

/**
 * Validates a standalone SQLite backup before atomically publishing it.
 * Existing destinations are never overwritten by this operation.
 */
export async function restoreStorageBackup(options: RestoreStorageBackupOptions): Promise<RestoreStorageBackupResult> {
  if (options.backupPath === options.destinationPath) throw new Error("backup and destination paths must differ");
  await access(options.backupPath);
  const destinationDirectory = dirname(options.destinationPath);
  await mkdir(destinationDirectory, { recursive: true });
  try {
    await stat(options.destinationPath);
    throw new Error(`restore destination already exists: ${options.destinationPath}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }

  const temporaryPath = join(destinationDirectory, `.${randomUUID()}.restore.tmp`);
  try {
    await copyFile(options.backupPath, temporaryPath);
    const restored = await openStorage({ filePath: temporaryPath, appVersion: options.appVersion ?? "openbuddy-restore" });
    let schemaVersion: number;
    try {
      schemaVersion = restored.migration.finalVersion;
      const integrity = await restored.driver.integrityCheck();
      if (!integrity.ok) throw new Error(`restored SQLite integrity check failed: ${integrity.detail ?? integrity.foreignKeys ?? "unknown"}`);
    } finally {
      restored.driver.close();
    }
    await link(temporaryPath, options.destinationPath);
    await unlink(temporaryPath);
    return { path: options.destinationPath, schemaVersion, integrity: { ok: true } };
  } catch (error) {
    // Windows 上 SQLite 句柄释放有延迟:刚 close()(或打开失败时根本没拿到
    // 句柄)的文件仍被占用,unlink 会 EBUSY/EPERM。重试几次再放弃 ——
    // 留一个 .restore.tmp 在备份目录里不致命,但会一直堆着。
    await rm(temporaryPath, { force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
    throw error;
  }
}
