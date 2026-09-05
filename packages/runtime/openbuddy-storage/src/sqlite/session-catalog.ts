import type { SqliteDriver } from "./driver";

export interface SessionCatalogRecord {
  sessionId: string;
  workspaceCwd: string;
  sourcePath: string;
  sourceHash: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  expertId?: string;
  expertMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SessionCatalogQuery {
  workspaceCwd?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface SessionRow {
  session_id: string;
  workspace_cwd: string;
  source_path: string;
  source_hash: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  pinned: number;
  archived: number;
  expert_id: string | null;
  metadata_json: string;
  expert_metadata_json?: string | null;
}

function parseMetadata(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function fromRow(row: SessionRow): SessionCatalogRecord {
  const expertMetadata = row.expert_metadata_json ? parseMetadata(row.expert_metadata_json) : undefined;
  return {
    sessionId: row.session_id,
    workspaceCwd: row.workspace_cwd,
    sourcePath: row.source_path,
    sourceHash: row.source_hash,
    title: row.title ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    messageCount: row.message_count,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    expertId: row.expert_id ?? undefined,
    metadata: parseMetadata(row.metadata_json),
    ...(expertMetadata ? { expertMetadata } : {}),
  };
}

export class SessionCatalog {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  upsert(record: SessionCatalogRecord): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(`
        INSERT INTO workspaces(workspace_cwd, updated_at)
        VALUES (?, ?)
        ON CONFLICT(workspace_cwd) DO UPDATE SET updated_at = excluded.updated_at
      `).run(record.workspaceCwd, this.now());
      database.prepare(`
        INSERT INTO sessions(
          session_id, workspace_cwd, source_path, source_hash, title, created_at, updated_at,
          message_count, pinned, archived, expert_id, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          workspace_cwd = excluded.workspace_cwd,
          source_path = excluded.source_path,
          source_hash = excluded.source_hash,
          title = excluded.title,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          message_count = excluded.message_count,
          pinned = sessions.pinned,
          archived = sessions.archived,
          expert_id = sessions.expert_id,
          metadata_json = excluded.metadata_json
      `).run(
        record.sessionId,
        record.workspaceCwd,
        record.sourcePath,
        record.sourceHash,
        record.title ?? null,
        record.createdAt ?? null,
        record.updatedAt ?? null,
        record.messageCount,
        record.pinned ? 1 : 0,
        record.archived ? 1 : 0,
        record.expertId ?? null,
        JSON.stringify(record.metadata ?? {}),
      );
      if (record.expertId && record.expertMetadata) {
        database.prepare(`
          INSERT INTO session_bindings(session_id, binding_type, binding_id, metadata_json, updated_at)
          VALUES (?, 'expert', ?, ?, ?)
          ON CONFLICT(session_id, binding_type) DO NOTHING
        `).run(record.sessionId, record.expertId, JSON.stringify(record.expertMetadata), this.now());
      }
    });
  }

  get(sessionId: string): SessionCatalogRecord | undefined {
    const row = this.driver.database.prepare(`SELECT sessions.*, (SELECT metadata_json FROM session_bindings WHERE session_id = sessions.session_id AND binding_type = 'expert') AS expert_metadata_json FROM sessions WHERE session_id = ?`).get(sessionId) as SessionRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(query: SessionCatalogQuery = {}): SessionCatalogRecord[] {
    const clauses = ["1 = 1"];
    const params: (string | number)[] = [];
    if (query.workspaceCwd) {
      clauses.push("workspace_cwd = ?");
      params.push(query.workspaceCwd);
    }
    if (!query.includeArchived) clauses.push("archived = 0");
    const limit = Math.max(1, Math.min(query.limit ?? 500, 5_000));
    const rows = this.driver.database.prepare(`
      SELECT sessions.*, (SELECT metadata_json FROM session_bindings WHERE session_id = sessions.session_id AND binding_type = 'expert') AS expert_metadata_json
      FROM sessions
      WHERE ${clauses.join(" AND ")}
      ORDER BY pinned DESC, COALESCE(updated_at, created_at) DESC, session_id ASC
      LIMIT ?
    `).all(...params, limit) as unknown as SessionRow[];
    return rows.map(fromRow);
  }

  setBinding(sessionId: string, bindingType: string, bindingId: string, metadata: Record<string, unknown> = {}): void {
    this.driver.runExclusiveSync((database) => database.prepare(`
      INSERT INTO session_bindings(session_id, binding_type, binding_id, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, binding_type) DO UPDATE SET
        binding_id = excluded.binding_id,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(sessionId, bindingType, bindingId, JSON.stringify(metadata), this.now()));
  }

  setPinned(sessionId: string, pinned: boolean): void {
    this.driver.runExclusiveSync((database) => database.prepare(`UPDATE sessions SET pinned = ? WHERE session_id = ?`).run(pinned ? 1 : 0, sessionId));
  }

  setArchived(sessionId: string, archived: boolean): void {
    this.driver.runExclusiveSync((database) => database.prepare(`UPDATE sessions SET archived = ? WHERE session_id = ?`).run(archived ? 1 : 0, sessionId));
  }

  setExpert(sessionId: string, expertId: string | undefined, metadata: Record<string, unknown> = {}): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(`UPDATE sessions SET expert_id = ? WHERE session_id = ?`).run(expertId ?? null, sessionId);
      if (expertId) {
        database.prepare(`
          INSERT INTO session_bindings(session_id, binding_type, binding_id, metadata_json, updated_at)
          VALUES (?, 'expert', ?, ?, ?)
          ON CONFLICT(session_id, binding_type) DO UPDATE SET binding_id = excluded.binding_id, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
        `).run(sessionId, expertId, JSON.stringify(metadata), this.now());
      } else {
        database.prepare(`DELETE FROM session_bindings WHERE session_id = ? AND binding_type = 'expert'`).run(sessionId);
      }
    });
  }

  clearMetadata(): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(`UPDATE sessions SET pinned = 0, archived = 0, expert_id = NULL`).run();
      database.prepare(`DELETE FROM session_bindings WHERE binding_type = 'expert'`).run();
    });
  }
}
