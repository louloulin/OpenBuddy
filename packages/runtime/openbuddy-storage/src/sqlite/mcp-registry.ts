import type { SqliteDriver } from "./driver";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";

export interface McpRegistryRecord {
  name: string;
  source: string;
  sourcePath?: string;
  transport: string;
  target: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
  updatedAt: string;
}

export class McpRegistry {
  private storage?: Promise<OpenStorageResult>;
  constructor(private readonly databasePath: string) { }
  private async driver(): Promise<SqliteDriver> {
    return (await (this.storage ??= openStorage({ filePath: this.databasePath, appVersion: "openbuddy-mcp-registry" }))).driver;
  }
  async upsert(record: McpRegistryRecord): Promise<void> {
    const driver = await this.driver();
    await driver.runExclusive((database) => database.prepare(`INSERT INTO plugin_registry(plugin_id, version, enabled, manifest_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(plugin_id) DO UPDATE SET version=excluded.version, enabled=excluded.enabled, manifest_json=excluded.manifest_json, updated_at=excluded.updated_at`).run(registryKey(record), record.source, Number(record.enabled), JSON.stringify({ ...record, target: sanitizeMcpTarget(record.target), configJson: sanitizeMcpConfig(record.configJson) }), record.updatedAt));
  }
  async list(): Promise<McpRegistryRecord[]> {
    const driver = await this.driver();
    return (driver.database.prepare("SELECT plugin_id, version, enabled, manifest_json AS manifestJson, updated_at AS updatedAt FROM plugin_registry WHERE plugin_id LIKE 'mcp:%' ORDER BY plugin_id").all() as unknown as Array<Record<string, unknown>>).map((row) => {
      const value = JSON.parse(String(row.manifestJson)) as McpRegistryRecord;
      return { ...value, name: value.name || String(row.plugin_id).slice(4), source: value.source || String(row.version), enabled: Boolean(row.enabled), updatedAt: String(row.updatedAt) };
    });
  }
  async remove(name: string, sourcePath?: string): Promise<void> {
    const driver = await this.driver();
    await driver.runExclusive((database) => {
      if (sourcePath) {
        database.prepare("DELETE FROM plugin_registry WHERE plugin_id = ?").run(registryKey({ name, source: "", sourcePath }));
        return;
      }
      const rows = database.prepare("SELECT plugin_id, manifest_json AS manifestJson FROM plugin_registry WHERE plugin_id LIKE 'mcp:%'").all() as unknown as Array<{ plugin_id: string; manifestJson: string }>;
      for (const row of rows) {
        if ((JSON.parse(row.manifestJson) as Partial<McpRegistryRecord>).name === name) database.prepare("DELETE FROM plugin_registry WHERE plugin_id = ?").run(row.plugin_id);
      }
    });
  }
  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }
}

function registryKey(record: Pick<McpRegistryRecord, "name" | "source" | "sourcePath">): string {
  return `mcp:${record.sourcePath ?? record.source}:${record.name}`;
}

function sanitizeMcpConfig(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api.?key|authorization|cookie/i.test(key)) continue;
    result[key] = Array.isArray(item)
      ? item.map((entry) => entry && typeof entry === "object" ? sanitizeMcpConfig(entry as Record<string, unknown>) : entry)
      : item && typeof item === "object" ? sanitizeMcpConfig(item as Record<string, unknown>) : item;
  }
  return result;
}

function sanitizeMcpTarget(target: string): string {
  try {
    const url = new URL(target);
    if (url.username || url.password) { url.username = ""; url.password = ""; }
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|api.?key|authorization|cookie|credential/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return target;
  }
}
