import { closeStorage, openStorage, type OpenStorageResult } from "../sqlite/open-storage";
import { SettingsRegistry } from "../sqlite/settings";

export interface RendererStorageValue {
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
}

export class RendererStorageVersionConflictError extends Error {
  readonly code = "renderer-storage-version-conflict";
  readonly currentVersion: number | undefined;

  constructor(namespace: string, key: string, expectedVersion: number, currentVersion: number | undefined) {
    super(`renderer storage version conflict for ${namespace}.${key}: expected ${expectedVersion}, current ${currentVersion ?? "missing"}`);
    this.name = "RendererStorageVersionConflictError";
    this.currentVersion = currentVersion;
  }
}

const forbiddenKey = /token|secret|password|api.?key|authorization|cookie|credential/i;
const allowedNamespace = /^[a-z][a-z0-9._-]{0,63}$/;
const allowedKey = /^[a-z][a-z0-9._-]{0,127}$/;

function validate(namespace: string, key: string, value?: unknown): void {
  if (!allowedNamespace.test(namespace) || forbiddenKey.test(namespace)) throw new Error("invalid renderer storage namespace");
  if (!allowedKey.test(key) || forbiddenKey.test(`${namespace}.${key}`)) throw new Error("invalid renderer storage key");
  if (value !== undefined) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 1_000_000) throw new Error("renderer storage value is too large or not serializable");
    rejectSecretFields(value);
  }
}

function rejectSecretFields(value: unknown, path = "value"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key)) throw new Error(`renderer storage value contains a secret field at ${path}.${key}`);
    rejectSecretFields(item, `${path}.${key}`);
  }
}

/** Versioned, allowlistable renderer persistence facade; never exposes SQLite to the renderer. */
export class RendererStorageGateway {
  private storage?: Promise<OpenStorageResult>;
  private readonly now: () => string;

  constructor(databasePath: string, now?: () => string) {
    this.databasePath = databasePath;
    this.now = now ?? (() => new Date().toISOString());
  }

  private readonly databasePath: string;

  private storageResult(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.databasePath, appVersion: "openbuddy-renderer-storage" });
  }

  async read(namespace: string, key: string): Promise<RendererStorageValue | undefined> {
    validate(namespace, key);
    const driver = (await this.storageResult()).driver;
    return new SettingsRegistry(driver, this.now).get(namespace, key) as RendererStorageValue | undefined;
  }

  async write(namespace: string, key: string, value: unknown, version = 1): Promise<RendererStorageValue> {
    return this.writeVersioned(namespace, key, value, version);
  }

  async writeVersioned(namespace: string, key: string, value: unknown, version = 1, expectedVersion?: number): Promise<RendererStorageValue> {
    validate(namespace, key, value);
    const driver = (await this.storageResult()).driver;
    const updatedAt = this.now();
    return await driver.runExclusive((database) => {
      const current = database.prepare("SELECT version FROM settings WHERE namespace = ? AND setting_key = ?").get(namespace, key) as { version: number } | undefined;
      const currentVersion = current ? Number(current.version) : 0;
      if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
        throw new RendererStorageVersionConflictError(namespace, key, expectedVersion, current ? currentVersion : undefined);
      }
      database.prepare(`
        INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(namespace, setting_key) DO UPDATE SET
          value_json = excluded.value_json,
          version = excluded.version,
          updated_at = excluded.updated_at
      `).run(namespace, key, JSON.stringify(value), version, updatedAt);
      return { namespace, key, value, version, updatedAt };
    }) as RendererStorageValue;
  }

  async list(namespace: string): Promise<RendererStorageValue[]> {
    if (!allowedNamespace.test(namespace) || forbiddenKey.test(namespace)) throw new Error("invalid renderer storage namespace");
    const driver = (await this.storageResult()).driver;
    return new SettingsRegistry(driver, this.now).list(namespace) as RendererStorageValue[];
  }

  async remove(namespace: string, key: string): Promise<boolean> {
    validate(namespace, key);
    const driver = (await this.storageResult()).driver;
    return await driver.runExclusive((database) => {
      const result = database.prepare("DELETE FROM settings WHERE namespace = ? AND setting_key = ?").run(namespace, key);
      return Number(result.changes) > 0;
    });
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }
}
