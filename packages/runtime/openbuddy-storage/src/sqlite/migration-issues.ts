import { randomUUID } from "node:crypto";
import type { SqliteDriver } from "./driver";

export interface MigrationIssue {
  issueId: string;
  sourcePath?: string;
  issueType: string;
  detail: string;
  sourceHash?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface MigrationIssueInput {
  issueId?: string;
  sourcePath?: string;
  issueType: string;
  detail: string;
  sourceHash?: string;
}

interface MigrationIssueRow {
  issue_id: string;
  source_path: string | null;
  issue_type: string;
  detail: string;
  source_hash: string | null;
  created_at: string;
  resolved_at: string | null;
}

function decode(row: MigrationIssueRow): MigrationIssue {
  return {
    issueId: row.issue_id,
    ...(row.source_path === null ? {} : { sourcePath: row.source_path }),
    issueType: row.issue_type,
    detail: row.detail,
    ...(row.source_hash === null ? {} : { sourceHash: row.source_hash }),
    createdAt: row.created_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  };
}

export class MigrationIssueStore {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  record(input: MigrationIssueInput): Promise<MigrationIssue> {
    if (!input.issueType.trim() || !input.detail.trim()) throw new Error("migration issue type and detail are required");
    return this.driver.runExclusive((database) => {
      const issueId = input.issueId ?? randomUUID();
      const createdAt = this.now();
      database.prepare(`
        INSERT INTO migration_issues(issue_id, source_path, issue_type, detail, source_hash, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(issue_id) DO UPDATE SET source_path = excluded.source_path,
          issue_type = excluded.issue_type, detail = excluded.detail,
          source_hash = excluded.source_hash, resolved_at = NULL
      `).run(issueId, input.sourcePath ?? null, input.issueType, input.detail, input.sourceHash ?? null, createdAt);
      return decode(database.prepare("SELECT * FROM migration_issues WHERE issue_id = ?").get(issueId) as unknown as MigrationIssueRow);
    });
  }

  list(options: { includeResolved?: boolean } = {}): MigrationIssue[] {
    const rows = this.driver.database.prepare(`
      SELECT issue_id, source_path, issue_type, detail, source_hash, created_at, resolved_at
      FROM migration_issues
      ${options.includeResolved ? "" : "WHERE resolved_at IS NULL"}
      ORDER BY created_at ASC, issue_id ASC
    `).all() as unknown as MigrationIssueRow[];
    return rows.map(decode);
  }

  resolve(issueId: string): Promise<boolean> {
    return this.driver.runExclusive((database) => {
      const result = database.prepare("UPDATE migration_issues SET resolved_at = ? WHERE issue_id = ? AND resolved_at IS NULL").run(this.now(), issueId);
      return Number(result.changes) === 1;
    });
  }
}
