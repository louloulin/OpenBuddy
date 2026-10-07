/**
 * Canvas 域模型(SQLite 持久化)。
 *
 * 一张画布 = 一个 artifact 的工作副本:`canvas_documents` 存文档级元数据,
 * `canvas_revisions` 按 seq 单调追加存内容版本(content_hash 去重——内容没变不写版本)。
 * 落盘到工作区文件后,`source_path` 非空即「已落盘」状态。
 */
import { createHash } from "node:crypto";
import type { SqliteDriver } from "./driver";

export type CanvasKind = "markdown" | "html" | "react" | "svg" | "code" | "image" | "pdf";

export interface CanvasDocument {
  canvasId: string;
  /** 会话可缺省:独立画布(尚未绑定会话,或来源会话已删除)。 */
  sessionId: string | null;
  kind: CanvasKind;
  title: string;
  /** 消息 part 的稳定引用(如 `msg:<id>#part:<i>`),用于从 chip 回溯。 */
  documentRef?: string;
  /** 已落盘的工作区相对路径;非空即「已落盘」。 */
  sourcePath?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface CanvasRevision {
  canvasId: string;
  seq: number;
  content: string;
  contentHash: string;
  author: string;
  createdAt: string;
}

export interface CanvasDocumentInput {
  canvasId: string;
  sessionId?: string | null;
  kind: CanvasKind;
  title?: string;
  documentRef?: string;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}

export interface CanvasCatalogOptions {
  /** 内容未变化时不追加新版本(默认 true)。 */
  dedupeRevisions?: boolean;
  now?: () => string;
}

interface CanvasDocumentRow {
  canvas_id: string;
  session_id: string | null;
  kind: string;
  title: string;
  source_ref: string | null;
  source_path: string | null;
  metadata_json: string;
  created_at: string;
}

interface CanvasRevisionRow {
  canvas_id: string;
  seq: number;
  content: string;
  content_hash: string;
  author: string;
  created_at: string;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // 损坏的 metadata 不该让整份画布列表读不出来。
  }
  return {};
}

function documentFromRow(row: CanvasDocumentRow): CanvasDocument {
  return {
    canvasId: row.canvas_id,
    sessionId: row.session_id,
    kind: row.kind as CanvasKind,
    title: row.title,
    ...(row.source_ref ? { documentRef: row.source_ref } : {}),
    ...(row.source_path ? { sourcePath: row.source_path } : {}),
    createdAt: row.created_at,
    metadata: parseMetadata(row.metadata_json),
  };
}

function revisionFromRow(row: CanvasRevisionRow): CanvasRevision {
  return {
    canvasId: row.canvas_id,
    seq: row.seq,
    content: row.content,
    contentHash: row.content_hash,
    author: row.author,
    createdAt: row.created_at,
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class CanvasCatalog {
  constructor(private readonly driver: SqliteDriver, private readonly options: CanvasCatalogOptions = {}) {}

  private get dedupe(): boolean {
    return this.options.dedupeRevisions !== false;
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  upsertDocument(input: CanvasDocumentInput): void {
    const now = this.now();
    this.driver.runExclusiveSync((database) => {
      database.prepare(`
        INSERT INTO canvas_documents(
          canvas_id, session_id, kind, title, source_ref, source_path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canvas_id) DO UPDATE SET
          session_id = excluded.session_id,
          kind = excluded.kind,
          title = excluded.title,
          source_ref = excluded.source_ref,
          source_path = excluded.source_path,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(
        input.canvasId,
        input.sessionId ?? null,
        input.kind,
        input.title ?? "",
        input.documentRef ?? null,
        input.sourcePath ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      );
    });
  }

  getDocument(canvasId: string): CanvasDocument | undefined {
    const row = this.driver.database
      .prepare(`SELECT * FROM canvas_documents WHERE canvas_id = ?`)
      .get(canvasId) as CanvasDocumentRow | undefined;
    return row ? documentFromRow(row) : undefined;
  }

  listDocuments(sessionId?: string): CanvasDocument[] {
    const rows = (sessionId === undefined
      ? this.driver.database.prepare(`SELECT * FROM canvas_documents ORDER BY updated_at DESC`).all()
      : this.driver.database
        .prepare(`SELECT * FROM canvas_documents WHERE session_id = ? ORDER BY updated_at DESC`)
        .all(sessionId)) as unknown as CanvasDocumentRow[];
    return rows.map(documentFromRow);
  }

  /**
   * 追加一个版本。内容与最新版本相同(且开启去重)时返回既有版本而不写库,
   * 这样编辑器的防抖保存不会把修订历史冲成几百条一模一样的记录。
   */
  saveRevision(canvasId: string, content: string, author = "user"): CanvasRevision {
    const contentHash = hashContent(content);
    return this.driver.runExclusiveSync((database) => {
      const latest = database
        .prepare(`SELECT * FROM canvas_revisions WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1`)
        .get(canvasId) as CanvasRevisionRow | undefined;
      if (latest && this.dedupe && latest.content_hash === contentHash) return revisionFromRow(latest);
      const seq = (latest?.seq ?? 0) + 1;
      const createdAt = this.now();
      database.prepare(`
        INSERT INTO canvas_revisions(canvas_id, seq, content, content_hash, author, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(canvasId, seq, content, contentHash, author, createdAt);
      database.prepare(`UPDATE canvas_documents SET updated_at = ? WHERE canvas_id = ?`).run(createdAt, canvasId);
      return { canvasId, seq, content, contentHash, author, createdAt } satisfies CanvasRevision;
    });
  }

  latestRevision(canvasId: string): CanvasRevision | undefined {
    const row = this.driver.database
      .prepare(`SELECT * FROM canvas_revisions WHERE canvas_id = ? ORDER BY seq DESC LIMIT 1`)
      .get(canvasId) as CanvasRevisionRow | undefined;
    return row ? revisionFromRow(row) : undefined;
  }

  listRevisions(canvasId: string, limit = 100): CanvasRevision[] {
    const rows = this.driver.database
      .prepare(`SELECT * FROM canvas_revisions WHERE canvas_id = ? ORDER BY seq DESC LIMIT ?`)
      .all(canvasId, Math.max(1, Math.min(limit, 1_000))) as unknown as CanvasRevisionRow[];
    return rows.map(revisionFromRow);
  }

  /** 落盘成功后回写路径,非空即「已落盘」。 */
  markSaved(canvasId: string, sourcePath: string): void {
    this.driver.runExclusiveSync((database) => {
      database
        .prepare(`UPDATE canvas_documents SET source_path = ?, updated_at = ? WHERE canvas_id = ?`)
        .run(sourcePath, this.now(), canvasId);
    });
  }

  deleteDocument(canvasId: string): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(`DELETE FROM canvas_documents WHERE canvas_id = ?`).run(canvasId);
    });
  }
}