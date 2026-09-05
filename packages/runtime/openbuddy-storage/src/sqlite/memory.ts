import type { SqliteDriver } from "./driver";

export interface MemoryDocument {
  documentId: string;
  sourcePath: string;
  contentHash: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
}

export class MemoryIndex {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  upsert(document: MemoryDocument): void {
    const updatedAt = document.updatedAt ?? this.now();
    this.driver.runExclusiveSync((database) => {
      database.prepare(`
      INSERT INTO memory_documents(document_id, source_path, content_hash, title, content, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        source_path = excluded.source_path,
        content_hash = excluded.content_hash,
        title = excluded.title,
        content = excluded.content,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      `).run(document.documentId, document.sourcePath, document.contentHash, document.title ?? null, document.content, JSON.stringify(document.metadata ?? {}), updatedAt);
      database.prepare(`DELETE FROM memory_fts WHERE document_id = ?`).run(document.documentId);
      database.prepare(`INSERT INTO memory_fts(document_id, title, content) VALUES (?, ?, ?)`).run(document.documentId, document.title ?? "", document.content);
    });
  }

  search(query: string, limit = 50): Array<{ documentId: string; title: string; content: string }> {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
    const match = query.trim().split(/\s+/u).filter(Boolean).map((token) => `"${token.replace(/"/g, "\"\"")}"`).join(" ");
    if (!match) return [];
    return this.driver.database.prepare(`
      SELECT document_id AS documentId, title, snippet(memory_fts, 2, '[', ']', '…', 24) AS content
      FROM memory_fts WHERE memory_fts MATCH ? LIMIT ?
    `).all(match, safeLimit) as unknown as Array<{ documentId: string; title: string; content: string }>;
  }

  private mapRow(value: Record<string, unknown>): MemoryDocument {
    return {
      documentId: String(value.documentId),
      sourcePath: String(value.sourcePath),
      contentHash: String(value.contentHash),
      title: value.title == null ? undefined : String(value.title),
      content: String(value.content),
      metadata: JSON.parse(String(value.metadataJson ?? "{}")) as Record<string, unknown>,
      updatedAt: String(value.updatedAt),
    };
  }

  list(): MemoryDocument[] {
    return this.driver.database.prepare(`
      SELECT document_id AS documentId, source_path AS sourcePath, content_hash AS contentHash,
        title, content, metadata_json AS metadataJson, updated_at AS updatedAt
      FROM memory_documents ORDER BY updated_at DESC
    `).all().map((row) => this.mapRow(row as Record<string, unknown>));
  }

  get(documentId: string): MemoryDocument | undefined {
    // O(1) primary-key lookup. Previously this delegated to `list().find(...)`,
    // which loaded every memory document and scanned it linearly — every call
    // cost O(n) memory + O(n) parse. The FTS5 mirror stays consistent via the
    // `upsert`/`remove` paths which already run inside `runExclusiveSync`.
    const row = this.driver.database.prepare(`
      SELECT document_id AS documentId, source_path AS sourcePath, content_hash AS contentHash,
        title, content, metadata_json AS metadataJson, updated_at AS updatedAt
      FROM memory_documents WHERE document_id = ?
    `).get(documentId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  remove(documentId: string): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(`DELETE FROM memory_documents WHERE document_id = ?`).run(documentId);
      database.prepare(`DELETE FROM memory_fts WHERE document_id = ?`).run(documentId);
    });
  }
}
