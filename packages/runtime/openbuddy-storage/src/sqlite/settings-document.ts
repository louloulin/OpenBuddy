import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";
import type { SqliteDriver } from "./driver";
import { SettingsRegistry } from "./settings";

export type SettingsDocument = Record<string, Record<string, unknown>>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class SettingsDocumentStore {
  private importedLegacy = false;

  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  async importLegacy(path?: string): Promise<void> {
    if (this.importedLegacy || !path) return;
    const count = this.driver.database.prepare(`SELECT COUNT(*) AS count FROM settings`).get() as { count: number } | undefined;
    if (Number(count?.count ?? 0) > 0) { this.importedLegacy = true; return; }
    let document: SettingsDocument;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings legacy document must be an object");
      document = parsed as SettingsDocument;
    } catch (error) {
      if (isMissingSource(error)) { this.importedLegacy = true; return; }
      throw legacySourceError("settings", path, error);
    }
    this.driver.runExclusiveSync((database) => {
      for (const [namespace, value] of Object.entries(document)) {
        this.write(database, namespace, object(value));
      }
    });
    this.importedLegacy = true;
  }

  get(namespace: string): Record<string, unknown> {
    const value = new SettingsRegistry(this.driver, this.now).get(namespace, "document")?.value;
    return object(value);
  }

  set(namespace: string, value: Record<string, unknown>): void {
    const setting = object(value);
    this.driver.runExclusiveSync((database) => database.prepare(`
      INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
      VALUES (?, 'document', ?, 1, ?)
      ON CONFLICT(namespace, setting_key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at
    `).run(namespace, JSON.stringify(setting), this.now()));
  }

  delete(namespace: string): boolean {
    const result = this.driver.runExclusiveSync((database) => database.prepare(`
      DELETE FROM settings WHERE namespace = ?
    `).run(namespace));
    return Number((result as { changes?: number }).changes ?? 0) > 0;
  }

  list(): SettingsDocument {
    const document: SettingsDocument = {};
    for (const setting of new SettingsRegistry(this.driver, this.now).list()) {
      if (setting.key !== "document") continue;
      document[setting.namespace] = object(setting.value);
    }
    return document;
  }

  private write(database: DatabaseSync, namespace: string, value: Record<string, unknown>): void {
    database.prepare(`
      INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
      VALUES (?, 'document', ?, 1, ?)
      ON CONFLICT(namespace, setting_key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at
    `).run(namespace, JSON.stringify(value), this.now());
  }
}
