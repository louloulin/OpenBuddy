/**
 * host-modules/session-metadata-store.ts — Phase F.2.
 *
 * SQLite-backed replacement for the legacy `~/.pi/openbuddy-state.json`
 * JSON mirror previously maintained by `session-metadata.ts`. The
 * JSON mirror had three top-level fields (`pinned: string[]`,
 * `archived: string[]`, `experts: Record<sessionId, ExpertInfo>`) and
 * was atomically rewritten on every metadata change via the
 * `writeFile → rename` pattern.
 *
 * Why move to SQLite (plan §F.2):
 *   - One file → one SQLite database. Folder-trust, calendar,
 *     task-automation, harness-cursors all share `openbuddy.sqlite`
 *     via the SettingsStore pattern; session-metadata was the last
 *     remaining JSON file under `piHome()`. Consolidating means one
 *     backup target, one migration path, one fsync surface.
 *   - Atomic per-key writes. Today a single `setSessionArchived()`
 *     call rewrites the whole JSON file. SQLite's UPSERT gives us
 *     "only touch the key you meant to" without read-modify-write
 *     races across multiple Cordis services that share the mirror.
 *   - The expert map becomes indexable. `getExpert(sessionId)` is
 *     O(1) via `get("session-metadata", "expert:<id>")` instead of
 *     "read+parse the whole file".
 *
 * Schema:
 *   namespace = "session-metadata" (single namespace for the three
 *     logical fields)
 *   - key "pinned"   → string[] (all pinned session ids)
 *   - key "archived" → string[] (all archived session ids)
 *   - key "expert:<sessionId>" → { expertId, expertName, avatarLocal? }
 *
 * Backward compatibility:
 *   On first call, the store reads the legacy JSON file (if present)
 *   and migrates each field into SQLite, then deletes the JSON file.
 *   Subsequent reads/writes are SQLite-only. If migration fails
 *   (e.g. malformed JSON), the file is left in place and the store
 *   starts fresh — the next manual cleanup or `clearAll()` removes it.
 */
import { rm, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { openStorageSync, SettingsStore } from "@openbuddy/storage";

import { piHome } from "./_host-paths";

const NAMESPACE = "session-metadata";
const KEY_PINNED = "pinned";
const KEY_ARCHIVED = "archived";
const KEY_EXPERT_PREFIX = "expert:";
const LEGACY_JSON_FILE = "openbuddy-state.json";

export interface ExpertInfo {
  expertId: string;
  expertName: string;
  avatarLocal?: string;
}

export interface SessionMetadataSnapshot {
  pinned: string[];
  archived: string[];
  experts: Record<string, ExpertInfo>;
}

/**
 * Single shared instance — `openbuddy.sqlite` is process-wide so we
 * don't need a per-call driver. Construction is idempotent; subsequent
 * `getInstance()` calls return the same store.
 */
let cachedStore: SessionMetadataStore | null = null;

function defaultDatabasePath(): string {
  return join(piHome(), "openbuddy.sqlite");
}

function defaultLegacyJsonPath(): string {
  return join(piHome(), LEGACY_JSON_FILE);
}

function defaultPiHome(): string {
  return process.env.PI_CODING_AGENT_DIR ?? process.env.PI_HOME ?? join(homedir(), ".pi", "agent");
}

/**
 * Validate that an unknown value is a well-shaped `string[]` (filter
 * non-strings defensively to avoid corrupting the SQL row).
 */
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Validate an `ExpertInfo` value before persisting. Mirrors the
 * defensive shape the legacy JSON mirror produced (expertId +
 * expertName required, avatarLocal optional).
 */
function normalizeExpertInfo(value: unknown): ExpertInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.expertId !== "string" || typeof candidate.expertName !== "string") {
    return undefined;
  }
  return {
    expertId: candidate.expertId,
    expertName: candidate.expertName,
    ...(typeof candidate.avatarLocal === "string" ? { avatarLocal: candidate.avatarLocal } : {}),
  };
}

export interface SessionMetadataStoreOptions {
  /** Override SQLite path (default: `<piHome>/openbuddy.sqlite`). */
  databasePath?: string;
  /** Override legacy JSON path (default: `<piHome>/openbuddy-state.json`). */
  legacyJsonPath?: string;
  /** Inject a pre-built SettingsStore (test seam). */
  settings?: SettingsStore;
}

export class SessionMetadataStore {
  private readonly settings: SettingsStore;
  private readonly legacyJsonPath: string;
  private migrationPromise: Promise<void> | null = null;
  private migrationDone = false;

  constructor(options: SessionMetadataStoreOptions = {}) {
    if (options.settings) {
      this.settings = options.settings;
    } else {
      this.settings = new SettingsStore({
        driver: openStorageSync({ filePath: options.databasePath ?? defaultDatabasePath() }).driver,
      });
    }
    this.legacyJsonPath = options.legacyJsonPath ?? defaultLegacyJsonPath();
  }

  /** Lazily migrate the legacy JSON mirror (if it exists) into
   *  SQLite. Idempotent — a second call after a successful migration
   *  is a no-op. Concurrency-safe: concurrent calls share a single
   *  in-flight Promise. */
  async ensureMigrated(): Promise<void> {
    if (this.migrationDone) return;
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = this.runMigration().catch((error) => {
      // Don't poison the cache — allow a retry on the next call.
      this.migrationPromise = null;
      throw error;
    });
    try {
      await this.migrationPromise;
    } finally {
      // Even on failure, mark as done so we don't keep retrying per
      // call. The caller can read the empty defaults and re-trigger
      // a migration by constructing a new store.
      this.migrationDone = true;
    }
  }

  private async runMigration(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.legacyJsonPath, "utf8");
    } catch {
      // No legacy file → nothing to migrate.
      return;
    }
    let parsed: {
      pinned?: unknown;
      archived?: unknown;
      experts?: unknown;
    };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      // Malformed JSON — leave the legacy file in place for forensic
      // inspection and start fresh. The next `clearAll()` will delete
      // it.
      return;
    }

    // If SQLite already has data, the migration is a no-op. This
    // protects users who upgraded mid-write (partial migration) from
    // losing their SQLite state.
    if (this.settings.list(NAMESPACE).length > 0) {
      await rm(this.legacyJsonPath, { force: true });
      return;
    }

    const pinned = normalizeStringList(parsed.pinned);
    const archived = normalizeStringList(parsed.archived);
    const expertsRaw = parsed.experts && typeof parsed.experts === "object"
      ? parsed.experts as Record<string, unknown>
      : {};
    const bulk: Array<{ key: string; value: unknown }> = [
      { key: KEY_PINNED, value: pinned },
      { key: KEY_ARCHIVED, value: archived },
    ];
    for (const [sessionId, info] of Object.entries(expertsRaw)) {
      const normalized = normalizeExpertInfo(info);
      if (normalized) bulk.push({ key: `${KEY_EXPERT_PREFIX}${sessionId}`, value: normalized });
    }
    for (const entry of bulk) {
      this.settings.set(NAMESPACE, entry.key, entry.value);
    }
    // Delete the legacy file on success — it's now redundant.
    await rm(this.legacyJsonPath, { force: true });
  }

  async getPinned(): Promise<string[]> {
    await this.ensureMigrated();
    return normalizeStringList(this.settings.get(NAMESPACE, KEY_PINNED)?.value);
  }

  async getArchived(): Promise<string[]> {
    await this.ensureMigrated();
    return normalizeStringList(this.settings.get(NAMESPACE, KEY_ARCHIVED)?.value);
  }

  async getExpert(sessionId: string): Promise<ExpertInfo | undefined> {
    await this.ensureMigrated();
    return normalizeExpertInfo(
      this.settings.get(NAMESPACE, `${KEY_EXPERT_PREFIX}${sessionId}`)?.value,
    );
  }

  async getAllExperts(): Promise<Record<string, ExpertInfo>> {
    await this.ensureMigrated();
    const out: Record<string, ExpertInfo> = {};
    for (const entry of this.settings.list(NAMESPACE)) {
      if (!entry.key.startsWith(KEY_EXPERT_PREFIX)) continue;
      const sessionId = entry.key.slice(KEY_EXPERT_PREFIX.length);
      const normalized = normalizeExpertInfo(entry.value);
      if (normalized) out[sessionId] = normalized;
    }
    return out;
  }

  async snapshot(): Promise<SessionMetadataSnapshot> {
    await this.ensureMigrated();
    return {
      pinned: normalizeStringList(this.settings.get(NAMESPACE, KEY_PINNED)?.value),
      archived: normalizeStringList(this.settings.get(NAMESPACE, KEY_ARCHIVED)?.value),
      experts: await this.getAllExperts(),
    };
  }

  /**
   * Atomically read+update+write the three top-level fields. Mirrors
   * the legacy `updateSessionMetadata(updateFn)` contract.
   */
  async updateMetadata(update: (snapshot: SessionMetadataSnapshot) => void): Promise<void> {
    await this.ensureMigrated();
    const pinned = await this.getPinned();
    const archived = await this.getArchived();
    const experts = await this.getAllExperts();
    const existingExpertIds = new Set(Object.keys(experts));
    const next: SessionMetadataSnapshot = { pinned, archived, experts: { ...experts } };
    update(next);
    this.settings.set(NAMESPACE, KEY_PINNED, next.pinned);
    this.settings.set(NAMESPACE, KEY_ARCHIVED, next.archived);
    // Diff the experts map so we delete entries that the update removed.
    for (const existing of existingExpertIds) {
      if (!(existing in next.experts)) {
        this.settings.delete(NAMESPACE, `${KEY_EXPERT_PREFIX}${existing}`);
      }
    }
    for (const [sessionId, info] of Object.entries(next.experts)) {
      this.settings.set(NAMESPACE, `${KEY_EXPERT_PREFIX}${sessionId}`, info);
    }
  }

  async clearAll(): Promise<void> {
    await this.ensureMigrated();
    this.settings.deleteNamespace(NAMESPACE);
    // Also remove the legacy file in case the user is clearing
    // after a partial migration.
    await rm(this.legacyJsonPath, { force: true });
  }
}

/** Singleton accessor. */
export function getSessionMetadataStore(): SessionMetadataStore {
  if (!cachedStore) {
    cachedStore = new SessionMetadataStore();
  }
  return cachedStore;
}

/** Test seam: reset the singleton so the next call rebuilds it. */
export function __resetSessionMetadataStoreForTest(): void {
  cachedStore = null;
}

/** Test seam: ensure the legacy JSON file is gone (used by the
 *  migration tests to reset state between cases). */
export async function __deleteLegacyJsonForTest(path?: string): Promise<void> {
  await rm(path ?? defaultLegacyJsonPath(), { force: true });
}

/** Test seam: write a known legacy JSON shape (used by migration tests). */
export async function __writeLegacyJsonForTest(snapshot: {
  pinned?: string[];
  archived?: string[];
  experts?: Record<string, ExpertInfo>;
}, path?: string): Promise<void> {
  await writeFile(
    path ?? defaultLegacyJsonPath(),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

/** Internal: lazily-used by the migration tests to confirm the
 *  default piHome path is correctly derived. */
export const __testInternals = {
  defaultDatabasePath,
  defaultLegacyJsonPath,
  defaultPiHome,
};
