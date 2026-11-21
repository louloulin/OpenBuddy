/**
 * 升级前快照与损坏自愈 (A2).
 *
 * Snapshots live under `<pi>/snapshots/<timestamp>-<label>/` with a `manifest.json`; the newest
 * three are kept. `JsonStore` calls `latestFor(name)` when a file no longer parses and restores
 * the newest snapshot that still contains a readable copy. Snapshot copies are byte-identical, so
 * an encrypted credential file round-trips as well.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "./schema.js";

/** The user-data JSON files covered by snapshots, export and restore. */
export const DATA_FILES = [
  "openbuddy.json",
  "providers.json",
  "projects.json",
  "automations.json",
  "automation-records.json",
  "mcp.json",
  "pi-settings.json",
] as const;

export interface SnapshotFile {
  name: string;
  bytes: number;
}

export interface SnapshotManifest {
  id: string;
  at: string;
  label: string;
  schemaVersion: number;
  files: SnapshotFile[];
}

export interface SnapshotHit {
  manifest: SnapshotManifest;
  path: string;
}

const MANIFEST = "manifest.json";
const KEEP = 3;
const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sanitize = (label: string) => label.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "snapshot";

function parses(path: string): boolean {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

export class SnapshotStore {
  readonly root: string;

  constructor(readonly dataDir: string) {
    this.root = join(dataDir, "snapshots");
  }

  /** Copy the existing covered files into a new snapshot; returns undefined when there is nothing to save. */
  capture(label: string, files: readonly string[] = DATA_FILES): SnapshotManifest | undefined {
    const source = this.dataDir;
    const present = files.filter((name) => existsSync(join(source, name)));
    if (!present.length) return undefined;
    const now = new Date();
    const id = `${now.getTime()}-${sanitize(label)}`;
    const dir = join(this.root, id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const entries: SnapshotFile[] = [];
    try {
      for (const name of present) {
        const from = join(source, name);
        const to = join(dir, name);
        copyFileSync(from, to);
        entries.push({ name, bytes: statSync(to).size });
      }
      const manifest: SnapshotManifest = {
        id,
        at: now.toISOString(),
        label,
        schemaVersion: SCHEMA_VERSION,
        files: entries,
      };
      writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 });
      this.prune();
      return manifest;
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** One snapshot per local day, taken when the app first starts and data already exists. */
  captureStartup(files: readonly string[] = DATA_FILES): SnapshotManifest | undefined {
    const today = dayKey(new Date());
    const existing = this.list().find((item) => item.label === "startup");
    if (existing && dayKey(new Date(existing.at)) === today) return undefined;
    return this.capture("startup", files);
  }

  list(): SnapshotManifest[] {
    let names: string[];
    try {
      names = readdirSync(this.root);
    } catch {
      return [];
    }
    const manifests: SnapshotManifest[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.root, name, MANIFEST), "utf8")) as SnapshotManifest;
        if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.files)) manifests.push(parsed);
      } catch {
        // A half-written snapshot is not a candidate.
      }
    }
    return manifests.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  /** Newest snapshot that still contains a readable copy of `name`. */
  latestFor(name: string): SnapshotHit | undefined {
    for (const manifest of this.list()) {
      if (!manifest.files.some((file) => file.name === name)) continue;
      const path = join(this.root, manifest.id, name);
      if (existsSync(path) && parses(path)) return { manifest, path };
    }
    return undefined;
  }

  /** Copy every file of one snapshot back; returns the names actually restored. */
  restore(id: string): string[] {
    const manifest = this.list().find((item) => item.id === id);
    if (!manifest) throw new Error("snapshot_not_found");
    const source = this.dataDir;
    const restored: string[] = [];
    for (const file of manifest.files) {
      const from = join(this.root, manifest.id, file.name);
      if (!existsSync(from)) continue;
      // Never restore a truncated copy over a good file.
      if (!parses(from)) throw new Error(`snapshot_corrupt:${file.name}`);
      writeAtomic(join(source, file.name), readFileSync(from));
      restored.push(file.name);
    }
    return restored;
  }

  private prune(): void {
    const snapshots = this.list();
    for (const item of snapshots.slice(KEEP)) rmSync(join(this.root, item.id), { recursive: true, force: true });
  }
}

export function writeAtomic(path: string, content: Buffer | string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
}

/** The file name a store cares about, for snapshot lookups. */
export const storeName = (path: string) => basename(path);
