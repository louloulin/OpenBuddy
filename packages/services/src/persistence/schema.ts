/**
 * 数据 schema 版本与顺序迁移 (A2).
 *
 * Every user-data JSON file carries `schemaVersion`. Files written before versioning (v0) are
 * upgraded in order by `migrations[n]` (n → n+1) and written back once. Migrations must be
 * idempotent: a crash between "wrote the file" and "reloaded" simply runs them again.
 *
 * A file from a newer app version is never silently downgraded — the caller quarantines it and
 * falls back to the latest snapshot instead.
 */
export const SCHEMA_VERSION = 1;

export type JsonObject = Record<string, unknown>;
/** Upgrades one file from version n to n+1. Receives the parsed JSON as written on disk. */
export type Migration = (data: unknown) => JsonObject;

export interface MigrationResult {
  data: JsonObject;
  /** Version found on disk (0 when the file predates versioning). */
  from: number;
  migrated: boolean;
}

export const isJsonObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The v0→v1 step for object-shaped files: keep the fields, just add the version. */
export const identityMigration: Migration = (data) => {
  if (!isJsonObject(data)) throw new Error("invalid_data");
  return data;
};

export class FutureSchemaError extends Error {
  constructor(readonly version: number) {
    super(`future_schema_version:${version}`);
    this.name = "FutureSchemaError";
  }
}

export function migrate(
  raw: unknown,
  migrations: Record<number, Migration> = { 0: identityMigration },
  current = SCHEMA_VERSION,
): MigrationResult {
  let version = 0;
  if (isJsonObject(raw)) {
    const declared = raw.schemaVersion;
    if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0) version = declared;
  }
  if (version > current) throw new FutureSchemaError(version);
  const from = version;
  let data: unknown = raw;
  while (version < current) {
    const step = migrations[version];
    if (!step) throw new Error(`missing_migration:${version}`);
    data = step(data);
    version += 1;
  }
  if (!isJsonObject(data)) throw new Error("invalid_data");
  return { data: { ...data, schemaVersion: current }, from, migrated: from < current };
}
