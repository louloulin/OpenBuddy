import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SqliteDriver } from "./driver";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";

export interface EmailStateDocument {
  drafts: unknown[];
  audit: unknown[];
  senderPolicies: unknown[];
  shares: unknown[];
  reminders: unknown[];
  projects: unknown[];
  tags: unknown[];
  threadTags: unknown[];
  scheduledSends: unknown[];
  pendingSends: unknown[];
}

export interface EmailStateStoreOptions {
  databasePath: string;
  legacyPath?: string;
  mirrorPath?: string;
  now?: () => string;
}

const domains = [
  "drafts",
  "audit",
  "senderPolicies",
  "shares",
  "reminders",
  "projects",
  "tags",
  "threadTags",
  "scheduledSends",
  "pendingSends",
] as const;

function emptyState(): EmailStateDocument {
  return { drafts: [], audit: [], senderPolicies: [], shares: [], reminders: [], projects: [], tags: [], threadTags: [], scheduledSends: [], pendingSends: [] };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(value: unknown): EmailStateDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("email legacy document must be an object");
  const source = value as Record<string, unknown>;
  for (const domain of domains) {
    if (source[domain] !== undefined && !Array.isArray(source[domain])) throw new Error(`email legacy ${domain} must be an array`);
  }
  return Object.fromEntries(domains.map((domain) => [domain, array(source[domain])])) as unknown as EmailStateDocument;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function keyFor(domain: string, value: unknown, position: number): string {
  const record = object(value);
  const id = stringValue(record.id);
  if (id) return id;
  if (domain === "senderPolicies") return `${String(record.accountId ?? "")}:${String(record.senderEmail ?? "").toLowerCase()}`;
  if (domain === "projects") return `${String(record.accountId ?? "")}:${String(record.threadId ?? "")}`;
  if (domain === "threadTags") return `${String(record.accountId ?? "")}:${String(record.threadId ?? "")}:${String(record.tagId ?? "")}`;
  return `${domain}:${position}`;
}

function readRows(database: DatabaseSync): EmailStateDocument {
  const result = emptyState();
  const rows = database.prepare(`SELECT domain, position, value_json AS valueJson FROM email_state_records ORDER BY domain, position, record_id`).all() as unknown as Array<{ domain: string; position: number; valueJson: string }>;
  for (const row of rows) {
    if (!(domains as readonly string[]).includes(row.domain)) continue;
    try { (result[row.domain as keyof EmailStateDocument] as unknown[]).push(JSON.parse(row.valueJson)); } catch { }
  }
  return result;
}

export class EmailStateStore {
  private storage: Promise<OpenStorageResult> | undefined;
  private readonly now: () => string;
  private importedLegacy = false;

  constructor(private readonly options: EmailStateStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private storageResult(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: "openbuddy-email" });
  }

  async read(): Promise<EmailStateDocument> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    return readRows(driver.database);
  }

  async write(value: EmailStateDocument): Promise<void> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    const state = normalized(value);
    await driver.runExclusive((database) => {
      database.prepare(`DELETE FROM email_state_records`).run();
      for (const domain of domains) {
        for (const [position, record] of state[domain].entries()) {
          database.prepare(`INSERT INTO email_state_records(domain, record_id, position, value_json, updated_at) VALUES (?, ?, ?, ?, ?)`).run(domain, keyFor(domain, record, position), position, JSON.stringify(record), this.now());
        }
      }
    });
    if (this.options.mirrorPath) await writeMirror(this.options.mirrorPath, state);
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }

  private async importLegacyIfNeeded(driver: SqliteDriver): Promise<void> {
    if (this.importedLegacy) return;
    const marker = driver.database.prepare(`SELECT legacy_imported AS legacyImported FROM email_state_meta WHERE state_id = 1`).get() as { legacyImported: number } | undefined;
    if (marker?.legacyImported) { this.importedLegacy = true; return; }
    let state = emptyState();
    if (this.options.legacyPath) {
      try {
        state = normalized(JSON.parse(await readFile(this.options.legacyPath, "utf8")));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT") {
          state = emptyState();
        } else {
          throw new Error(`email legacy import failed: ${this.options.legacyPath}`, { cause: error });
        }
      }
    }
    await driver.runExclusive((database) => {
      const existing = database.prepare(`SELECT COUNT(*) AS count FROM email_state_records`).get() as { count: number };
      if (existing.count === 0) {
        for (const domain of domains) {
          for (const [position, record] of state[domain].entries()) {
            database.prepare(`INSERT INTO email_state_records(domain, record_id, position, value_json, updated_at) VALUES (?, ?, ?, ?, ?)`).run(domain, keyFor(domain, record, position), position, JSON.stringify(record), this.now());
          }
        }
      }
      database.prepare(`INSERT INTO email_state_meta(state_id, legacy_imported, updated_at) VALUES (1, 1, ?) ON CONFLICT(state_id) DO UPDATE SET legacy_imported = 1, updated_at = excluded.updated_at`).run(this.now());
    });
    this.importedLegacy = true;
    if (this.options.mirrorPath && stateHasRecords(state)) {
      await writeMirror(this.options.mirrorPath, await Promise.resolve(readRows(driver.database)));
    }
  }
}

function stateHasRecords(state: EmailStateDocument): boolean {
  return domains.some((domain) => state[domain].length > 0);
}

async function writeMirror(target: string, state: EmailStateDocument): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    throw new Error(`email compatibility mirror failed: ${target}`, { cause: error });
  }
}
