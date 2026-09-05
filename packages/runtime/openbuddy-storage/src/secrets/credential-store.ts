import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { closeStorage, openStorage, type OpenStorageResult } from "../sqlite/open-storage";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";
import type { SecretStore } from "./secret-store";

export type CredentialRecord = { kind: "api-key"; key?: string; env?: Record<string, string> } | { kind: "grant"; payload: unknown };
export type CredentialDocument = { refs: Record<string, string>; records: Record<string, CredentialRecord> };

interface SecretRefRow { secret_ref: string; provider: string; label: string | null; }

const legacyMigrationRef = "credential:migration:legacy";
const legacyMigrationPending = "legacy import pending";
const legacyMigrationComplete = "legacy import complete";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function credentialDocument(value: unknown): CredentialDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("credential legacy document must be an object");
  }
  const record = value as Record<string, unknown>;
  if ((record.refs !== undefined && (!record.refs || typeof record.refs !== "object" || Array.isArray(record.refs)))
    || (record.records !== undefined && (!record.records || typeof record.records !== "object" || Array.isArray(record.records)))) {
    throw new Error("credential legacy document must contain object-shaped refs and records");
  }
  const refs = Object.entries(object(record.refs)).map(([key, item]) => {
    if (typeof item !== "string") throw new Error(`credential legacy ref is not a string: ${key}`);
    return [key, item] as const;
  });
  return {
    refs: Object.fromEntries(refs),
    records: object(record.records) as Record<string, CredentialRecord>,
  };
}

function refKey(ref: string): string { return `credential:ref:${ref}`; }
function recordKey(key: string): string { return `credential:record:${key}`; }

export interface CredentialStoreOptions {
  databasePath: string;
  legacyPath?: string;
  secretStore: SecretStore;
  now?: () => string;
}

/** Stores credential values in SecretStore and only metadata in SQLite. */
export class CredentialStore {
  private storage?: Promise<OpenStorageResult>;
  private imported = false;
  private importPromise: Promise<void> | undefined;
  private readonly now: () => string;

  constructor(private readonly options: CredentialStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async driver() {
    return (await (this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: "openbuddy-credentials" }))).driver;
  }

  async importLegacy(): Promise<void> {
    if (this.imported || !this.options.legacyPath) return;
    if (this.importPromise) return this.importPromise;
    const pending = this.importLegacyInternal();
    this.importPromise = pending;
    try { await pending; } finally {
      if (this.importPromise === pending) this.importPromise = undefined;
    }
  }

  private async importLegacyInternal(): Promise<void> {
    if (this.imported || !this.options.legacyPath) return;
    const driver = await this.driver();
    const marker = driver.database.prepare("SELECT secret_ref, label FROM secret_refs WHERE secret_ref = ?").get(legacyMigrationRef) as SecretRefRow | undefined;
    if (marker?.label === legacyMigrationComplete) { this.imported = true; return; }
    let document: CredentialDocument;
    try {
      document = credentialDocument(JSON.parse(await readFile(this.options.legacyPath, "utf8")));
    } catch (error) {
      if (isMissingSource(error)) return;
      throw legacySourceError("credential", this.options.legacyPath, error);
    }
    const temporary = join(dirname(this.options.legacyPath), `.dsh-credentials.${process.pid}.${Date.now()}.tmp`);
    await driver.runExclusive((database) => database.prepare(`INSERT INTO secret_refs(secret_ref, provider, label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(secret_ref) DO UPDATE SET provider=excluded.provider, label=excluded.label, updated_at=excluded.updated_at`).run(legacyMigrationRef, "credential-store", legacyMigrationPending, this.now()));
    try {
      for (const [ref, value] of Object.entries(document.refs)) await this.setRef(ref, value);
      for (const [key, value] of Object.entries(document.records)) await this.setRecord(key, value);
      await writeFile(temporary, `${JSON.stringify({ refs: {}, records: {} }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.options.legacyPath);
      await driver.runExclusive((database) => database.prepare("UPDATE secret_refs SET label = ?, updated_at = ? WHERE secret_ref = ?").run(legacyMigrationComplete, this.now(), legacyMigrationRef));
      this.imported = true;
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async resolve(ref: string): Promise<string | undefined> {
    if (!this.imported) await this.importLegacy();
    const row = await this.row(refKey(ref));
    return row ? this.options.secretStore.get(refKey(ref)) : undefined;
  }

  async describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }> {
    if (!this.imported) await this.importLegacy();
    const row = await this.row(refKey(ref));
    return row ? { configured: true, source: row.provider, writable: true } : { configured: false, writable: true };
  }

  async setRef(ref: string, value: string): Promise<void> {
    await this.options.secretStore.put(refKey(ref), value, { label: `OpenBuddy credential ${ref}` });
    const driver = await this.driver();
    await driver.runExclusive((database) => database.prepare(`INSERT INTO secret_refs(secret_ref, provider, label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(secret_ref) DO UPDATE SET provider=excluded.provider, label=excluded.label, updated_at=excluded.updated_at`).run(refKey(ref), "secret-store", `OpenBuddy credential ${ref}`, this.now()));
  }

  async unsetRef(ref: string): Promise<void> {
    await this.options.secretStore.delete(refKey(ref));
    const driver = await this.driver();
    await driver.runExclusive((database) => database.prepare("DELETE FROM secret_refs WHERE secret_ref = ?").run(refKey(ref)));
  }

  async readRecord(key: string): Promise<CredentialRecord | undefined> {
    if (!this.imported) await this.importLegacy();
    const row = await this.row(recordKey(key));
    if (!row) return undefined;
    const value = await this.options.secretStore.get(recordKey(key));
    if (!value) return undefined;
    try { return JSON.parse(value) as CredentialRecord; } catch { return undefined; }
  }

  async listRecords(): Promise<Array<{ key: string; kind: string }>> {
    if (!this.imported) await this.importLegacy();
    const driver = await this.driver();
    const rows = driver.database.prepare("SELECT secret_ref FROM secret_refs WHERE secret_ref LIKE 'credential:record:%' ORDER BY secret_ref").all() as unknown as Array<{ secret_ref: string }>;
    const result: Array<{ key: string; kind: string }> = [];
    for (const row of rows) {
      const key = row.secret_ref.slice("credential:record:".length);
      const record = await this.readRecord(key);
      if (record) result.push({ key, kind: record.kind });
    }
    return result;
  }

  async modifyRecord(key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> {
    const current = await this.readRecord(key);
    const next = await mutate(current);
    if (next === undefined) return current;
    await this.setRecord(key, next);
    return next;
  }

  async deleteRecord(key: string): Promise<void> {
    await this.options.secretStore.delete(recordKey(key));
    const driver = await this.driver();
    await driver.runExclusive((database) => database.prepare("DELETE FROM secret_refs WHERE secret_ref = ?").run(recordKey(key)));
  }

  private async setRecord(key: string, value: CredentialRecord): Promise<void> {
    await this.options.secretStore.put(recordKey(key), JSON.stringify(value), { label: `OpenBuddy credential record ${key}` });
    const driver = await this.driver();
    await driver.runExclusive((database) => database.prepare(`INSERT INTO secret_refs(secret_ref, provider, label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(secret_ref) DO UPDATE SET provider=excluded.provider, label=excluded.label, updated_at=excluded.updated_at`).run(recordKey(key), "secret-store", `OpenBuddy credential record ${key}`, this.now()));
  }

  private async row(ref: string): Promise<SecretRefRow | undefined> {
    const driver = await this.driver();
    return driver.database.prepare("SELECT secret_ref, provider, label FROM secret_refs WHERE secret_ref = ?").get(ref) as SecretRefRow | undefined;
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }
}
