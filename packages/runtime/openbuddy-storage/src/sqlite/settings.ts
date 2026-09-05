import type { SqliteDriver } from "./driver";

export interface StoredSetting {
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
}

interface SettingRow {
  namespace: string;
  setting_key: string;
  value_json: string;
  version: number;
  updated_at: string;
}

function parse(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function parseStrict(value: string): unknown {
  return JSON.parse(value);
}

export class SettingsRegistry {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  set(namespace: string, key: string, value: unknown, version = 1): StoredSetting {
    const updatedAt = this.now();
    this.driver.runExclusiveSync((database) => database.prepare(`
      INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, setting_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(namespace, key, JSON.stringify(value), version, updatedAt));
    return { namespace, key, value, version, updatedAt };
  }

  async setAsync(namespace: string, key: string, value: unknown, version = 1): Promise<StoredSetting> {
    const updatedAt = this.now();
    await this.driver.runExclusive((database) => database.prepare(`
      INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, setting_key) DO UPDATE SET
        value_json = excluded.value_json,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(namespace, key, JSON.stringify(value), version, updatedAt));
    return { namespace, key, value, version, updatedAt };
  }

  get(namespace: string, key: string): StoredSetting | undefined {
    const row = this.driver.database.prepare(`
      SELECT namespace, setting_key, value_json, version, updated_at
      FROM settings WHERE namespace = ? AND setting_key = ?
    `).get(namespace, key) as SettingRow | undefined;
    return row ? { namespace: row.namespace, key: row.setting_key, value: parse(row.value_json), version: row.version, updatedAt: row.updated_at } : undefined;
  }

  getStrict(namespace: string, key: string): StoredSetting | undefined {
    const row = this.driver.database.prepare(`
      SELECT namespace, setting_key, value_json, version, updated_at
      FROM settings WHERE namespace = ? AND setting_key = ?
    `).get(namespace, key) as SettingRow | undefined;
    return row ? { namespace: row.namespace, key: row.setting_key, value: parseStrict(row.value_json), version: row.version, updatedAt: row.updated_at } : undefined;
  }

  list(namespace?: string): StoredSetting[] {
    const rows = namespace
      ? this.driver.database.prepare(`SELECT namespace, setting_key, value_json, version, updated_at FROM settings WHERE namespace = ? ORDER BY setting_key`).all(namespace)
      : this.driver.database.prepare(`SELECT namespace, setting_key, value_json, version, updated_at FROM settings ORDER BY namespace, setting_key`).all();
    return (rows as unknown as SettingRow[]).map((row) => ({ namespace: row.namespace, key: row.setting_key, value: parse(row.value_json), version: row.version, updatedAt: row.updated_at }));
  }
}
