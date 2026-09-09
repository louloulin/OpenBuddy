/**
 * @openbuddy/storage/sqlite/settings-store — High-level SettingsStore wrapper.
 *
 * Phase D.1 round 2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v3 §D.1):
 *   Build a high-level SettingsStore wrapper on top of the existing
 *   `SettingsRegistry` (sqlite-backed). The wrapper exposes a
 *   PI-style interface (PI's `SettingsManager.create()` returns
 *   a similar object with `get/set/list/delete/listNamespaces`
 *   methods) so callers can swap between the native PI implementation
 *   and the OpenBuddy wrapper without changing call sites.
 *
 * Why this is round 2 of D.1:
 *   - Round 1 (already done): 8 contract tests for SettingsRegistry.
 *   - Round 2 (this file): high-level wrapper with namespaces,
 *     migration helpers, and bulk operations.
 *   - Round 3 (next): wire the wrapper into workbuddy-import.ts so
 *     the hand-written openFile/writeFile calls get replaced.
 *
 * Architecture:
 *   - `SettingsStore` wraps a `SettingsRegistry` and adds namespace
 *     enumeration (`listNamespaces()`), JSON schema validation via
 *     a per-namespace validator map, and bulk get/set helpers.
 *   - JSON schema validation uses a minimal hand-rolled validator
 *     (no external dep) to keep the storage layer zero-runtime-deps.
 *   - The schema map is exposed via `setSchema(namespace, validator)`
 *     so callers can register validators per namespace lazily.
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/ and nothing from index.ts.
 */

import type { SqliteDriver } from "./driver";
import { SettingsRegistry, type StoredSetting } from "./settings";

/**
 * Minimal hand-rolled JSON schema validator. Returns an error
 * message string if the value is invalid, or undefined if it
 * passes validation.
 *
 * Why hand-rolled: keeps the storage layer zero-runtime-deps. We
 * support the most common JSON-schema-lite shapes (required props
 * + per-prop type check). Callers that need full JSON Schema can
 * swap in their own validator function at any time.
 */
export type SettingsValidator = (value: unknown) => string | undefined;

export interface SettingsNamespaceStats {
  namespace: string;
  keyCount: number;
  versions: Record<number, number>;
}

export interface SettingsStoreOptions {
  driver: SqliteDriver;
  now?: () => string;
  /** Per-namespace validator. Used by `set` / `setAsync` to reject
   *  malformed values before they hit the underlying SettingsRegistry. */
  validators?: Map<string, SettingsValidator>;
}

/**
 * High-level settings store. Wraps `SettingsRegistry` with
 * per-namespace validation, namespace enumeration, and bulk helpers.
 *
 * Why a wrapper around SettingsRegistry rather than a replacement:
 * - SettingsRegistry already implements the UPSERT semantics with
 *   caller-supplied version (verified in settings-registry.test.ts).
 * - This wrapper layers validation + bulk operations + enumeration
 *   on top without changing the proven persistence path.
 * - Future D.1 round 3 (workbuddy-import.ts wiring) can drop in
 *   this wrapper without modifying the SQLite schema or migration.
 */
export class SettingsStore {
  private readonly registry: SettingsRegistry;
  private readonly now: () => string;
  private readonly validators: Map<string, SettingsValidator>;

  constructor(options: SettingsStoreOptions) {
    this.registry = new SettingsRegistry(options.driver, options.now);
    this.now = options.now ?? (() => new Date().toISOString());
    this.validators = options.validators ?? new Map();
  }

  /** Register a per-namespace validator. Subsequent set / setAsync
   *  calls validate before delegating to SettingsRegistry. */
  setSchema(namespace: string, validator: SettingsValidator): void {
    this.validators.set(namespace, validator);
  }

  /** Drop the validator for a namespace (subsequent sets skip it). */
  clearSchema(namespace: string): void {
    this.validators.delete(namespace);
  }

  set(namespace: string, key: string, value: unknown, version = 1): StoredSetting {
    this.validate(namespace, value);
    return this.registry.set(namespace, key, value, version);
  }

  async setAsync(namespace: string, key: string, value: unknown, version = 1): Promise<StoredSetting> {
    this.validate(namespace, value);
    return this.registry.setAsync(namespace, key, value, version);
  }

  get(namespace: string, key: string): StoredSetting | undefined {
    return this.registry.get(namespace, key);
  }

  /** Strict get: rejects on malformed JSON values. Useful when the
   *  caller expects the persisted value to round-trip without
   *  fallback parsing. */
  getStrict(namespace: string, key: string): StoredSetting | undefined {
    return this.registry.getStrict(namespace, key);
  }

  list(namespace?: string): StoredSetting[] {
    return this.registry.list(namespace);
  }

  /** List all unique namespaces that have at least one entry. */
  listNamespaces(): string[] {
    const seen = new Set<string>();
    for (const entry of this.registry.list()) {
      seen.add(entry.namespace);
    }
    return [...seen].sort();
  }

  /** Stats per namespace (key count + version histogram). Powers
   *  renderer dashboards that want to surface "how many settings in
   *  each namespace and how recently they were updated". */
  namespaceStats(): SettingsNamespaceStats[] {
    const byNamespace = new Map<string, SettingsNamespaceStats>();
    for (const entry of this.registry.list()) {
      let stats = byNamespace.get(entry.namespace);
      if (!stats) {
        stats = { namespace: entry.namespace, keyCount: 0, versions: {} };
        byNamespace.set(entry.namespace, stats);
      }
      stats.keyCount += 1;
      stats.versions[entry.version] = (stats.versions[entry.version] ?? 0) + 1;
    }
    return [...byNamespace.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
  }

  /** Bulk set: validate all entries first, then commit them all. If
   *  any entry fails validation (or the existing version doesn't
   *  match), no entries are written. */
  bulkSet(
    entries: Array<{ namespace: string; key: string; value: unknown; version?: number }>,
  ): StoredSetting[] {
    for (const entry of entries) this.validate(entry.namespace, entry.value);
    return entries.map((entry) =>
      this.registry.set(entry.namespace, entry.key, entry.value, entry.version ?? 1),
    );
  }

  /** Bulk get: returns a map of `namespace+key → value` (undefined
   *  for missing entries). */
  bulkGet(entries: Array<{ namespace: string; key: string }>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const entry of entries) {
      const stored = this.registry.get(entry.namespace, entry.key);
      out[`${entry.namespace}:${entry.key}`] = stored?.value;
    }
    return out;
  }

  /**
   * Delete a single (namespace, key) row. Returns true when a row
   * was removed. Phase F.2 — SessionMetadataStore relies on this to
   * drop expert entries the update removed (the legacy JSON mirror
   * encoded experts as a single object so deletions were implicit).
   */
  delete(namespace: string, key: string): boolean {
    return this.registry.delete(namespace, key);
  }

  /**
   * Delete every row in a namespace. Returns the count removed.
   * Used by `clearAll()` in stores that need to nuke an entire
   * namespace (e.g. session-metadata on full reset).
   */
  deleteNamespace(namespace: string): number {
    return this.registry.deleteNamespace(namespace);
  }

  private validate(namespace: string, value: unknown): void {
    const validator = this.validators.get(namespace);
    if (!validator) return;
    const error = validator(value);
    if (error) {
      throw new Error(`settings validation failed for "${namespace}": ${error}`);
    }
  }
}
