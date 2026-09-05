import { readFile } from "node:fs/promises";
import type { SqliteDriver } from "./driver";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";

export interface TaskCatalogEntry {
  id: string;
  content: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  order: number;
}

export interface TaskCatalogOptions {
  databasePath: string;
  legacyPath?: string;
  appVersion?: string;
}

export class TaskCatalog {
  private storage: Promise<OpenStorageResult> | undefined;
  private importedLegacy = false;

  constructor(private readonly options: TaskCatalogOptions) {
  }

  private storageResult(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: this.options.appVersion ?? "openbuddy-task" });
  }

  private async driver(): Promise<SqliteDriver> {
    return (await this.storageResult()).driver;
  }

  private async importLegacyIfEmpty(driver: SqliteDriver): Promise<void> {
    if (this.importedLegacy || !this.options.legacyPath) return;
    this.importedLegacy = true;
    const row = driver.database.prepare("SELECT COUNT(*) AS count FROM session_tasks").get() as { count?: number } | undefined;
    if (Number(row?.count ?? 0) > 0) return;
    try {
      const parsed = JSON.parse(await readFile(this.options.legacyPath, "utf8")) as { tasks?: TaskCatalogEntry[] };
      if (!Array.isArray(parsed.tasks)) return;
      const sessionId = this.options.legacyPath.split(/[\\/]/).pop()?.replace(/\.json$/, "");
      if (sessionId) await this.replace(sessionId, parsed.tasks);
    } catch (error) {
      if (!isMissingSource(error)) throw legacySourceError("task", this.options.legacyPath, error);
    }
  }

  async list(sessionId: string): Promise<TaskCatalogEntry[]> {
    const driver = await this.driver();
    await this.importLegacyIfEmpty(driver);
    return driver.database.prepare(`SELECT task_id AS id, content, status, created_at AS createdAt, updated_at AS updatedAt, task_order AS "order" FROM session_tasks WHERE session_id = ? ORDER BY task_order`).all(sessionId) as unknown as TaskCatalogEntry[];
  }

  async hasSnapshot(sessionId: string): Promise<boolean> {
    const driver = await this.driver();
    return Boolean(driver.database.prepare("SELECT session_id FROM session_task_snapshots WHERE session_id = ?").get(sessionId));
  }

  async replace(sessionId: string, tasks: readonly TaskCatalogEntry[]): Promise<void> {
    const driver = await this.driver();
    await driver.transaction(async () => {
      driver.database.prepare("DELETE FROM session_tasks WHERE session_id = ?").run(sessionId);
      driver.database.prepare("INSERT INTO session_task_snapshots(session_id, updated_at) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at").run(sessionId, new Date().toISOString());
      const statement = driver.database.prepare(`INSERT INTO session_tasks(session_id, task_id, content, status, created_at, updated_at, task_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const task of tasks) statement.run(sessionId, task.id, task.content, task.status, task.createdAt, task.updatedAt, task.order);
    });
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }
}
