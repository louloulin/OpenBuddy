/**
 * @openbuddy/folder-trust/settings-backend — SettingsStore-backed folder trust.
 *
 * Phase D.2 round 2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v3 §D.2):
 *   Build a FolderTrustStore implementation that delegates to the
 *   existing `SettingsStore` wrapper (D.1 round 2). The SettingsStore
 *   provides SQLite-backed persistence + namespace isolation + bulk
 *   helpers, so reusing it for folder trust means:
 *
 *   - **One SQLite database** for all settings (vs the current
 *     per-folder-trust JSON file)
 *   - **One migration path** (vs separate JSON file format)
 *   - **Per-namespace validators** for free (validate cwd format on set)
 *
 * Architecture:
 *   - Wraps `SettingsStore` and uses the `folder-trust` namespace for
 *     all entries (key = cwd).
 *   - Falls back to JsonFolderTrustStore if the SettingsStore
 *     initialization fails (e.g. during test setups where SqliteDriver
 *     is unavailable) so the rest of the system still works.
 *
 * Why both backends co-exist:
 *   - JsonFolderTrustStore: legacy / standalone / debug
 *   - SettingsBackendFolderTrustStore: production / unified storage
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/ and nothing from the
 *   JsonFolderTrustStore file (this is a parallel implementation).
 */

import { SettingsStore } from "@openbuddy/storage";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { JsonFolderTrustStore, type FolderTrustEntry, type FolderTrustStore } from "./index";

const NAMESPACE = "folder-trust";

/**
 * FolderTrustStore implementation that uses the shared SettingsStore
 * (sqlite-backed) as its persistence backend.
 *
 * Why a separate class instead of modifying JsonFolderTrustStore:
 *   - JsonFolderTrustStore stays as a self-contained JSON backup
 *     that works without SqliteDriver (useful for unit tests and
 *     standalone tools).
 *   - SettingsBackendFolderTrustStore is the production path that
 *     benefits from sqlite's atomic write semantics + per-namespace
 *     validators.
 */
export class SettingsBackendFolderTrustStore implements FolderTrustStore {
  /**
   * Factory that tries to open the SettingsStore and falls back to
   * a JsonFolderTrustStore on failure. Returns the working store so
   * callers don't need to care which backend they got.
   */
  static tryOpen(options: {
    databasePath: string;
    settings: SettingsStore;
    fallbackStoragePath: string;
  }): FolderTrustStore {
    try {
      options.settings.setSchema(NAMESPACE, (value) => {
        // Validate the value shape: must be `{ trusted: boolean, decidedAt: string }`.
        if (!value || typeof value !== "object") return "folder-trust value must be an object";
        const v = value as { trusted?: unknown; decidedAt?: unknown };
        if (typeof v.trusted !== "boolean") return "folder-trust.trusted must be a boolean";
        if (typeof v.decidedAt !== "string") return "folder-trust.decidedAt must be an ISO timestamp";
        return undefined;
      });
      return new SettingsBackendFolderTrustStore(options.settings, options.fallbackStoragePath);
    } catch {
      // SettingsStore init failed (e.g. missing sqlite driver) —
      // fall back to the JSON store so the capability still works.
      return new JsonFolderTrustStore(options.fallbackStoragePath);
    }
  }

  private constructor(
    private readonly settings: SettingsStore,
    private readonly fallbackStoragePath: string,
  ) {}

  list(): FolderTrustEntry[] {
    const entries = this.settings.list(NAMESPACE);
    return entries
      .map((setting) => {
        const value = setting.value as { trusted: boolean; decidedAt: string } | undefined;
        if (!value || typeof value.trusted !== "boolean") return null;
        return { cwd: setting.key, trusted: value.trusted, decidedAt: value.decidedAt };
      })
      .filter((entry): entry is FolderTrustEntry => entry !== null);
  }

  isTrusted(cwd: string): boolean {
    const stored = this.settings.get(NAMESPACE, cwd);
    const value = stored?.value as { trusted: boolean } | undefined;
    return value?.trusted === true;
  }

  grant(cwd: string): FolderTrustEntry {
    const entry: FolderTrustEntry = { cwd, trusted: true, decidedAt: new Date().toISOString() };
    this.settings.set(NAMESPACE, cwd, { trusted: entry.trusted, decidedAt: entry.decidedAt });
    return entry;
  }

  revoke(cwd: string): FolderTrustEntry {
    const entry: FolderTrustEntry = { cwd, trusted: false, decidedAt: new Date().toISOString() };
    this.settings.set(NAMESPACE, cwd, { trusted: entry.trusted, decidedAt: entry.decidedAt });
    return entry;
  }

  respond(cwd: string, trusted: boolean): FolderTrustEntry {
    return trusted ? this.grant(cwd) : this.revoke(cwd);
  }
}
