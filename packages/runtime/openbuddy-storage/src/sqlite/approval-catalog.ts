import type { SqliteDriver } from "./driver";
import { openStorageSync, type OpenStorageSyncResult } from "./open-storage";

export interface ApprovalCatalogRecord {
  id: string;
  taskId: string;
  requesterId: string;
  actions: string[];
  reason: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface ApprovalCatalogOptions { databasePath: string; appVersion?: string }

export class ApprovalCatalog {
  private readonly storage: OpenStorageSyncResult;
  constructor(options: ApprovalCatalogOptions) {
    this.storage = openStorageSync({ filePath: options.databasePath, appVersion: options.appVersion ?? "openbuddy-approval" });
  }

  list(): ApprovalCatalogRecord[] {
    const rows = this.storage.driver.database.prepare("SELECT approval_id AS id, status, decision_json AS payload FROM approvals ORDER BY updated_at DESC").all() as unknown as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      try {
        const payload = JSON.parse(String(row.payload)) as ApprovalCatalogRecord;
        return payload && typeof payload.id === "string" ? [{ ...payload, status: String(row.status) as ApprovalCatalogRecord["status"] }] : [];
      } catch { return []; }
    });
  }

  upsert(record: ApprovalCatalogRecord): void {
    const driver: SqliteDriver = this.storage.driver;
    driver.runExclusiveSync((database) => database.prepare(`
      INSERT INTO approvals(approval_id, task_id, status, decision_json, updated_at)
      VALUES (?, NULL, ?, ?, ?)
      ON CONFLICT(approval_id) DO UPDATE SET status = excluded.status, decision_json = excluded.decision_json, updated_at = excluded.updated_at
    `).run(record.id, record.status, JSON.stringify(record), record.decidedAt ?? record.createdAt));
  }

  close(): void { this.storage.driver.close(); }
}
