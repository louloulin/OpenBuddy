import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SqliteDriver } from "./driver";
import { openStorageSync, type OpenStorageSyncResult } from "./open-storage";
import { errorCode, isMissingSource, legacySourceError } from "../adapters/legacy-errors";

export interface CollaborationTaskContract {
  taskId: string;
  mode: string;
}

export interface CollaborationInboxCursor {
  principalId: string;
  lastReadEventId?: string;
  acknowledgedEventIds: string[];
}

interface CollaborationStateOptions {
  databasePath: string;
  legacyPath?: string;
  appVersion?: string;
}

export class CollaborationContractStore<T extends CollaborationTaskContract = CollaborationTaskContract> {
  private readonly storage: OpenStorageSyncResult;

  constructor(private readonly options: CollaborationStateOptions) {
    this.storage = openStorageSync({ filePath: options.databasePath, appVersion: options.appVersion ?? "openbuddy-collaboration-contracts" });
    try { this.importLegacyIfEmpty(); } catch (error) { this.storage.driver.close(); throw error; }
  }

  get(taskId: string): T | undefined {
    const row = this.driver().database.prepare("SELECT contract_json FROM collaboration_task_contracts WHERE task_id = ?").get(taskId) as { contract_json?: string } | undefined;
    return parseContract<T>(row?.contract_json);
  }

  list(): T[] {
    const rows = this.driver().database.prepare("SELECT contract_json FROM collaboration_task_contracts ORDER BY updated_at ASC, task_id ASC").all() as unknown as Array<{ contract_json: string }>;
    return rows.flatMap((row) => {
      const value = parseContract<T>(row.contract_json);
      return value ? [value] : [];
    });
  }

  upsert<U extends T>(contract: U, now = new Date().toISOString()): void {
    this.driver().runExclusiveSync((database) => database.prepare(`
      INSERT INTO collaboration_task_contracts(task_id, mode, contract_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET mode = excluded.mode, contract_json = excluded.contract_json, updated_at = excluded.updated_at
    `).run(contract.taskId, contract.mode, JSON.stringify(contract), now));
    this.writeLegacyMirror();
  }

  close(): void {
    this.driver().close();
  }

  private driver(): SqliteDriver {
    return this.storage.driver;
  }

  private importLegacyIfEmpty(): void {
    if (!this.options.legacyPath || !existsSync(this.options.legacyPath)) return;
    const count = Number((this.driver().database.prepare("SELECT COUNT(*) AS count FROM collaboration_task_contracts").get() as { count: number }).count);
    if (count > 0) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(this.options.legacyPath, "utf8")) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("collaboration contracts must be an object");
    } catch (error) {
      if (isMissingSource(error) || errorCode(error) === "ENOENT") return;
      throw legacySourceError("collaboration contracts", this.options.legacyPath, error);
    }
    const values = Object.values(parsed);
    const entries = values.flatMap((value) => {
      const contract = parseContract<T>(JSON.stringify(value));
      return contract ? [contract] : [];
    });
    if (values.length !== entries.length) throw legacySourceError("collaboration contracts", this.options.legacyPath, new Error("invalid contract record"));
    if (entries.length === 0) return;
    this.driver().runExclusiveSync((database) => {
      const statement = database.prepare(`INSERT OR IGNORE INTO collaboration_task_contracts(task_id, mode, contract_json, updated_at) VALUES (?, ?, ?, ?)`);
      const now = new Date().toISOString();
      for (const contract of entries) statement.run(contract.taskId, contract.mode, JSON.stringify(contract), now);
    });
  }

  private writeLegacyMirror(): void {
    if (!this.options.legacyPath) return;
    mkdirSync(dirname(this.options.legacyPath), { recursive: true });
    const value = Object.fromEntries(this.list().map((contract) => [contract.taskId, contract]));
    const temporaryPath = `${this.options.legacyPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
    renameSync(temporaryPath, this.options.legacyPath);
  }
}

export class CollaborationInboxCursorStore {
  private readonly storage: OpenStorageSyncResult;

  constructor(private readonly options: CollaborationStateOptions) {
    this.storage = openStorageSync({ filePath: options.databasePath, appVersion: options.appVersion ?? "openbuddy-collaboration-cursors" });
    try { this.importLegacyIfEmpty(); } catch (error) { this.storage.driver.close(); throw error; }
  }

  list(): CollaborationInboxCursor[] {
    const rows = this.storage.driver.database.prepare("SELECT cursor_json FROM collaboration_inbox_cursors ORDER BY updated_at ASC, principal_id ASC").all() as unknown as Array<{ cursor_json: string }>;
    return rows.flatMap((row) => {
      const cursor = parseCursor(row.cursor_json);
      return cursor ? [cursor] : [];
    });
  }

  read(principalId: string): CollaborationInboxCursor | undefined {
    const row = this.storage.driver.database.prepare("SELECT cursor_json FROM collaboration_inbox_cursors WHERE principal_id = ?").get(principalId) as { cursor_json?: string } | undefined;
    const cursor = parseCursor(row?.cursor_json);
    return cursor?.principalId === principalId ? cursor : undefined;
  }

  write(cursor: CollaborationInboxCursor, now = new Date().toISOString()): void {
    const normalized: CollaborationInboxCursor = {
      principalId: cursor.principalId,
      ...(cursor.lastReadEventId ? { lastReadEventId: cursor.lastReadEventId } : {}),
      acknowledgedEventIds: [...new Set(cursor.acknowledgedEventIds.filter((id): id is string => typeof id === "string"))],
    };
    this.storage.driver.runExclusiveSync((database) => database.prepare(`
      INSERT INTO collaboration_inbox_cursors(principal_id, cursor_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET cursor_json = excluded.cursor_json, updated_at = excluded.updated_at
    `).run(normalized.principalId, JSON.stringify(normalized), now));
    this.writeLegacyMirror(normalized);
  }

  close(): void {
    this.storage.driver.close();
  }

  private importLegacyIfEmpty(): void {
    if (!this.options.legacyPath || !existsSync(this.options.legacyPath)) return;
    const count = Number((this.storage.driver.database.prepare("SELECT COUNT(*) AS count FROM collaboration_inbox_cursors").get() as { count: number }).count);
    if (count > 0) return;
    let cursor: CollaborationInboxCursor | undefined;
    try { cursor = parseCursor(readFileSync(this.options.legacyPath, "utf8")); } catch (error) {
      if (isMissingSource(error) || errorCode(error) === "ENOENT") return;
      throw legacySourceError("collaboration cursor", this.options.legacyPath, error);
    }
    if (!cursor) throw legacySourceError("collaboration cursor", this.options.legacyPath, new Error("invalid cursor record"));
    this.storage.driver.runExclusiveSync((database) => database.prepare(`
      INSERT OR IGNORE INTO collaboration_inbox_cursors(principal_id, cursor_json, updated_at)
      VALUES (?, ?, ?)
    `).run(cursor!.principalId, JSON.stringify(cursor), new Date().toISOString()));
  }

  private writeLegacyMirror(cursor: CollaborationInboxCursor): void {
    if (!this.options.legacyPath) return;
    mkdirSync(dirname(this.options.legacyPath), { recursive: true });
    const temporaryPath = `${this.options.legacyPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(cursor)}\n`, "utf8");
    renameSync(temporaryPath, this.options.legacyPath);
  }
}

function parseContract<T extends CollaborationTaskContract>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<CollaborationTaskContract>;
    return typeof parsed.taskId === "string" && typeof parsed.mode === "string" ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

function parseCursor(value: string | undefined): CollaborationInboxCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<CollaborationInboxCursor>;
    if (typeof parsed.principalId !== "string" || !Array.isArray(parsed.acknowledgedEventIds)) return undefined;
    return {
      principalId: parsed.principalId,
      ...(typeof parsed.lastReadEventId === "string" ? { lastReadEventId: parsed.lastReadEventId } : {}),
      acknowledgedEventIds: parsed.acknowledgedEventIds.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return undefined;
  }
}
