/**
 * 全量用户数据导出 / 恢复 (A2).
 *
 * A bundle is plain JSON covering the versioned user-data files. Secrets (`credentials.enc.json`)
 * are deliberately omitted: the payload is encrypted with the OS keychain and would be unusable
 * on another machine, so restoring prompts for keys again instead of silently failing.
 *
 * Restore always snapshots the current files first ("pre-restore") and the caller asks the user
 * to restart, because services hold their data in memory for the lifetime of the process.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "../settings/settings.js";
import { isJsonObject, SCHEMA_VERSION } from "./schema.js";
import { DATA_FILES, SnapshotStore, writeAtomic, type SnapshotManifest } from "./snapshots.js";

export const BUNDLE_KIND = "openbuddy-data";
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;

export interface DataBundle {
  kind: typeof BUNDLE_KIND;
  schemaVersion: number;
  exportedAt: string;
  files: Record<string, unknown>;
  omitted: string[];
}

export interface RestoreResult {
  restored: string[];
  skipped: string[];
  snapshotId?: string;
  /** Always true: the running services keep their in-memory copy until the app restarts. */
  restartRequired: true;
}

export class DataBackupService {
  private readonly snapshots: SnapshotStore;

  constructor(private readonly settings: Settings) {
    this.snapshots = settings.snapshots;
  }

  exportBundle(now = new Date()): DataBundle {
    const files: Record<string, unknown> = {};
    for (const name of DATA_FILES) {
      const path = join(this.settings.dir, name);
      if (!existsSync(path)) continue;
      try {
        files[name] = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        // A corrupt file is not exported; it is still present in the snapshots.
      }
    }
    return {
      kind: BUNDLE_KIND,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      files,
      omitted: ["credentials.enc.json"],
    };
  }

  restoreBundle(raw: unknown): RestoreResult {
    const bundle = validateBundle(raw);
    const snapshot = this.snapshots.capture("pre-restore");
    const restored: string[] = [];
    const skipped: string[] = [];
    for (const [name, content] of Object.entries(bundle.files)) {
      if (!(DATA_FILES as readonly string[]).includes(name)) {
        skipped.push(name);
        continue;
      }
      writeAtomic(join(this.settings.dir, name), JSON.stringify(content, null, 2));
      restored.push(name);
    }
    return {
      restored,
      skipped,
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
      restartRequired: true,
    };
  }

  listSnapshots(): SnapshotManifest[] {
    return this.snapshots.list();
  }

  restoreSnapshot(id: string): RestoreResult {
    if (!this.snapshots.list().some((item) => item.id === id)) throw new Error("snapshot_not_found");
    const snapshot = this.snapshots.capture("pre-restore");
    const restored = this.snapshots.restore(id);
    return {
      restored,
      skipped: [],
      ...(snapshot ? { snapshotId: snapshot.id } : {}),
      restartRequired: true,
    };
  }
}

/** Boundary validation: unknown bundles are rejected before anything touches disk. */
export function validateBundle(raw: unknown): DataBundle {
  if (!isJsonObject(raw)) throw new Error("invalid_bundle");
  if (raw.kind !== BUNDLE_KIND) throw new Error("invalid_bundle_kind");
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) throw new Error("invalid_bundle_version");
  if (version > SCHEMA_VERSION) throw new Error("future_bundle_version");
  if (!isJsonObject(raw.files)) throw new Error("invalid_bundle_files");
  const files = raw.files;
  const entries = Object.entries(files);
  if (entries.length > DATA_FILES.length) throw new Error("invalid_bundle_files");
  let bytes = 0;
  for (const [name, content] of entries) {
    if (typeof name !== "string" || !name || content === undefined) throw new Error("invalid_bundle_files");
    const size = Buffer.byteLength(JSON.stringify(content) ?? "");
    bytes += size;
    if (bytes > MAX_BUNDLE_BYTES) throw new Error("bundle_too_large");
  }
  return {
    kind: BUNDLE_KIND,
    schemaVersion: version,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date(0).toISOString(),
    files,
    omitted: Array.isArray(raw.omitted) ? raw.omitted.filter((item): item is string => typeof item === "string") : [],
  };
}
