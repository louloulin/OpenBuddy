import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";
import type { SqliteDriver } from "./driver";

export interface WorkspaceCatalogRecord {
  id: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCatalogDocument {
  order: string[];
  records: Record<string, WorkspaceCatalogRecord>;
  archivedSessionIds: string[];
}

export interface WorkspaceCatalogOptions {
  databasePath: string;
  legacyPath?: string;
  mirrorPath?: string;
  now?: () => string;
}

function emptyDocument(): WorkspaceCatalogDocument {
  return { order: [], records: {}, archivedSessionIds: [] };
}

function record(value: unknown, id: string): WorkspaceCatalogRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<WorkspaceCatalogRecord>;
  if (typeof source.path !== "string" || typeof source.title !== "string") return undefined;
  return {
    id,
    path: source.path,
    title: source.title,
    sessionIds: Array.isArray(source.sessionIds) ? source.sessionIds.filter((item): item is string => typeof item === "string") : [],
    createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString(),
  };
}

function normalized(value: unknown): WorkspaceCatalogDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workspace legacy document must be an object");
  const source = value as Partial<WorkspaceCatalogDocument>;
  if (source.records !== undefined && (!source.records || typeof source.records !== "object" || Array.isArray(source.records))) throw new Error("workspace legacy records must be an object");
  if (source.order !== undefined && !Array.isArray(source.order)) throw new Error("workspace legacy order must be an array");
  if (source.archivedSessionIds !== undefined && !Array.isArray(source.archivedSessionIds)) throw new Error("workspace legacy archivedSessionIds must be an array");
  const sourceRecords = source.records as Record<string, unknown> | undefined ?? {};
  const records: Record<string, WorkspaceCatalogRecord> = {};
  for (const [id, value] of Object.entries(sourceRecords)) {
    const parsed = record(value, id);
    if (!parsed) throw new Error(`workspace legacy record has an invalid shape: ${id}`);
    records[id] = parsed;
  }
  const order = Array.isArray(source.order)
    ? source.order.filter((id): id is string => typeof id === "string" && Boolean(records[id]))
    : Object.keys(records);
  for (const id of Object.keys(records)) if (!order.includes(id)) order.push(id);
  return {
    order,
    records,
    archivedSessionIds: Array.isArray(source.archivedSessionIds) ? source.archivedSessionIds.filter((id): id is string => typeof id === "string") : [],
  };
}

function readDatabase(database: DatabaseSync): WorkspaceCatalogDocument {
  const document = emptyDocument();
  const rows = database.prepare(`SELECT workspace_id AS id, workspace_path AS path, title, session_ids_json AS sessionIds, created_at AS createdAt, updated_at AS updatedAt FROM workspace_catalog ORDER BY position, workspace_id`).all() as unknown as Array<{ id: string; path: string; title: string; sessionIds: string; createdAt: string; updatedAt: string }>;
  for (const row of rows) {
    let sessionIds: string[] = [];
    try { const parsed = JSON.parse(row.sessionIds) as unknown; if (Array.isArray(parsed)) sessionIds = parsed.filter((item): item is string => typeof item === "string"); } catch { }
    document.order.push(row.id);
    document.records[row.id] = { id: row.id, path: row.path, title: row.title, sessionIds, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
  const archived = database.prepare(`SELECT session_id AS sessionId FROM workspace_archived_sessions ORDER BY session_id`).all() as unknown as Array<{ sessionId: string }>;
  document.archivedSessionIds = archived.map((row) => row.sessionId);
  return document;
}

export class WorkspaceCatalog {
  private storage: Promise<OpenStorageResult> | undefined;
  private readonly now: () => string;
  private importedLegacy = false;

  constructor(private readonly options: WorkspaceCatalogOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private storageResult(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: "openbuddy-workspaces" });
  }

  async read(): Promise<WorkspaceCatalogDocument> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    return readDatabase(driver.database);
  }

  async replace(value: WorkspaceCatalogDocument): Promise<void> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    const document = normalized(value);
    await driver.runExclusive((database) => {
      database.prepare(`DELETE FROM workspace_catalog`).run();
      for (const [position, id] of document.order.entries()) {
        const item = document.records[id];
        if (!item) continue;
        database.prepare(`INSERT INTO workspace_catalog(workspace_id, workspace_path, title, session_ids_json, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(item.id, item.path, item.title, JSON.stringify(item.sessionIds), position, item.createdAt, item.updatedAt);
      }
      database.prepare(`DELETE FROM workspace_archived_sessions`).run();
      for (const sessionId of document.archivedSessionIds) database.prepare(`INSERT INTO workspace_archived_sessions(session_id, updated_at) VALUES (?, ?)`).run(sessionId, this.now());
    });
    if (this.options.mirrorPath) await this.writeMirror(this.options.mirrorPath, document);
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }

  private async importLegacyIfNeeded(driver: SqliteDriver): Promise<void> {
    if (this.importedLegacy) return;
    const count = driver.database.prepare(`SELECT COUNT(*) AS count FROM workspace_catalog`).get() as { count: number };
    if (count.count > 0) { this.importedLegacy = true; return; }
    let document = emptyDocument();
    if (this.options.legacyPath) {
      try {
        document = normalized(JSON.parse(await readFile(this.options.legacyPath, "utf8")));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT") {
          document = emptyDocument();
        } else {
          throw new Error(`workspace legacy import failed: ${this.options.legacyPath}`, { cause: error });
        }
      }
    }
    await driver.runExclusive((database) => {
      const existing = database.prepare(`SELECT COUNT(*) AS count FROM workspace_catalog`).get() as { count: number };
      if (existing.count > 0) return;
      for (const [position, id] of document.order.entries()) {
        const item = document.records[id];
        if (!item) continue;
        database.prepare(`INSERT INTO workspace_catalog(workspace_id, workspace_path, title, session_ids_json, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(item.id, item.path, item.title, JSON.stringify(item.sessionIds), position, item.createdAt, item.updatedAt);
      }
      for (const sessionId of document.archivedSessionIds) database.prepare(`INSERT INTO workspace_archived_sessions(session_id, updated_at) VALUES (?, ?)`).run(sessionId, this.now());
    });
    this.importedLegacy = true;
  }

  private async writeMirror(target: string, document: WorkspaceCatalogDocument): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }
}
