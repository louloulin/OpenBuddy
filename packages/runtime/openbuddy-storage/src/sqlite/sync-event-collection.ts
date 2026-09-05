import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactStorageValue } from "../driver/redact";
import { openStorageSync } from "./open-storage";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";

export interface SyncEventCollectionOptions {
  databasePath: string;
  legacyPath?: string;
  stream: string;
  maxEntries?: number;
  appVersion?: string;
}

interface StoredRow {
  id: string;
  stream_seq: number;
  payload_json: string;
}

export class SyncEventCollection<T extends { id: string }> {
  private readonly maxEntries: number;
  private readonly storage;
  private readonly rows: T[];

  constructor(private readonly options: SyncEventCollectionOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 50_000));
    this.storage = openStorageSync({ filePath: options.databasePath, appVersion: options.appVersion ?? "openbuddy-sync-events" });
    this.rows = this.readRows();
  }

  list(): T[] {
    return this.rows.map((row) => structuredClone(row));
  }

  append(value: T): boolean {
    if (this.rows.some((row) => row.id === value.id)) return false;
    const payload = redactStorageValue(value) as Record<string, unknown>;
    const result = this.storage.driver.runExclusiveSync((database) => {
      const row = database.prepare(`SELECT COALESCE(MAX(stream_seq), 0) AS sequence FROM events WHERE stream = ?`).get(this.options.stream) as { sequence: number };
      const sequence = Number(row.sequence) + 1;
      return database.prepare(`
        INSERT INTO events(id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO NOTHING
      `).run(this.storageId(value.id), this.options.stream, sequence, "sync-event", new Date().toISOString(), "openbuddy", JSON.stringify(payload), createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    });
    if (Number(result.changes) === 0) return false;
    this.rows.push(structuredClone(value));
    this.trim();
    this.appendLegacy(value);
    return true;
  }

  close(): void {
    this.storage.driver.close();
  }

  private readRows(): T[] {
    const rows = this.storage.driver.database.prepare(`SELECT id, stream_seq, payload_json FROM events WHERE stream = ? ORDER BY stream_seq ASC`).all(this.options.stream) as unknown as StoredRow[];
    if (rows.length === 0) this.importLegacy();
    const source = rows.length === 0
      ? this.storage.driver.database.prepare(`SELECT id, stream_seq, payload_json FROM events WHERE stream = ? ORDER BY stream_seq ASC`).all(this.options.stream) as unknown as StoredRow[]
      : rows;
    return source.flatMap((row) => {
      try {
        const value = JSON.parse(row.payload_json) as T;
        return value && typeof value.id === "string" ? [value] : [];
      } catch {
        return [];
      }
    }).slice(-this.maxEntries);
  }

  private importLegacy(): void {
    if (!this.options.legacyPath || !existsSync(this.options.legacyPath)) return;
    let lines: string[];
    try {
      lines = readFileSync(this.options.legacyPath, "utf8").split(/\r?\n/u).filter(Boolean);
    } catch (error) {
      if (isMissingSource(error)) return;
      throw legacySourceError("sync events", this.options.legacyPath, error);
    }
    this.storage.driver.runExclusiveSync((database) => {
      let sequence = 0;
      for (const line of lines) {
        try {
          const value = JSON.parse(line) as T;
          if (!value || typeof value.id !== "string") continue;
          sequence += 1;
          const payload = redactStorageValue(value) as Record<string, unknown>;
          database.prepare(`INSERT OR IGNORE INTO events(id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
            .run(this.storageId(value.id), this.options.stream, sequence, "sync-event", new Date().toISOString(), "legacy-import", JSON.stringify(payload), createHash("sha256").update(line).digest("hex"));
        } catch { }
      }
    });
  }

  private storageId(id: string): string {
    return `${this.options.stream}:${id}`;
  }

  private trim(): void {
    while (this.rows.length > this.maxEntries) this.rows.shift();
  }

  private appendLegacy(value: T): void {
    if (!this.options.legacyPath) return;
    mkdirSync(dirname(this.options.legacyPath), { recursive: true });
    appendFileSync(this.options.legacyPath, `${JSON.stringify(value)}\n`, "utf8");
    if (this.rows.length !== this.maxEntries) return;
    const temporary = `${this.options.legacyPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${this.rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    renameSync(temporary, this.options.legacyPath);
  }
}
