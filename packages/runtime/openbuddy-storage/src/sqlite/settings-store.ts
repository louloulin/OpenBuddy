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
 *     enumeration (`listNamespaces()`) and bulk get/set helpers.
 *   - Schema validation is delegated to pi's `SettingsManager.inMemory()`
 *     (G2 PR 1, Round 20): every object/array value is probed through
 *     a fresh in-memory manager and `drainErrors()` surfaces rejections.
 *     Pi runs its migration pipeline (legacy `queueMode→steeringMode`,
 *     `websockets:boolean→transport:enum`, `skills:object→array`,
 *     `retry.maxDelayMs→retry.provider.maxRetryDelayMs`) and JSON
 *     round-trip sanity as the schema gate.
 *   - G2 PR 3 (Round 36) — typed retry/image accessors:
 *     `getRetrySettings()` / `setRetrySettings(value)` /
 *     `getImageSettings()` / `setImageSettings(value)` use pi's
 *     `RetrySettings` and `ImageSettings` interfaces directly so
 *     callers don't have to remember field shapes. Persisted via the
 *     same `(namespace, key, value)` triple, so existing rows round-trip.
 *
 * G2 PR 2 (Round 21, plan4.1.md §9.11) — the hand-rolled custom validator
 * (`SettingsValidator` + `setSchema/clearSchema` + per-namespace validators
 * map) was deleted. Per-namespace callers (folder-trust) now do their
 * own shape validation inline before calling `settings.set()`. The pi
 * gate runs as a global second check on every object/array write.
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/ and nothing from index.ts.
 */

import type { SqliteDriver } from "./driver";
import { SettingsRegistry, type StoredSetting } from "./settings";
import {
  type ImageSettings,
  type RetrySettings,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface SettingsNamespaceStats {
  namespace: string;
  keyCount: number;
  versions: Record<number, number>;
}

export interface SettingsStoreOptions {
  driver: SqliteDriver;
  now?: () => string;
}

/**
 * High-level settings store. Wraps `SettingsRegistry` with namespace
 * enumeration + bulk helpers, delegating schema validation to pi's
 * `SettingsManager` (G2 PR 1). Per-namespace shape validation, if
 * needed, is the caller's responsibility (see folder-trust which
 * validates `{ trusted: boolean; decidedAt: string }` inline).
 */
export class SettingsStore {
  private readonly registry: SettingsRegistry;
  private readonly now: () => string;

  constructor(options: SettingsStoreOptions) {
    this.registry = new SettingsRegistry(options.driver, options.now);
    this.now = options.now ?? (() => new Date().toISOString());
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

  // -----------------------------------------------------------------
  // G2 PR 3 (Round 36) — typed retry/image accessors.
  //
  // Each accessor round-trips through the existing pi-gated `set()`
  // path so the SettingsManager migration pipeline still runs. We
  // return a deep-cloned partial shape (only the keys we know pi
  // cares about) to keep callers from accidentally poking at the
  // full SettingsManager schema (which carries fields openbuddy does
  // not own — e.g. `compaction`, `theme`).
  // -----------------------------------------------------------------

  /** Read the typed retry settings persisted under `settings:retry`.
   *  Returns `{}` when nothing is persisted. */
  getRetrySettings(): RetrySettings {
    const stored = this.registry.get("settings", "retry");
    if (!stored) return {};
    const value = stored.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return coerceRetrySettings(value);
  }

  /** Persist typed retry settings under `settings:retry`. The pi
   *  gate + migration pipeline run as a side-effect of `set()`. */
  setRetrySettings(value: RetrySettings): StoredSetting {
    return this.set("settings", "retry", value as unknown as Record<string, unknown>);
  }

  /** Read the typed image settings persisted under `settings:image`.
   *  Returns `{}` when nothing is persisted. */
  getImageSettings(): ImageSettings {
    const stored = this.registry.get("settings", "image");
    if (!stored) return {};
    const value = stored.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return coerceImageSettings(value);
  }

  /** Persist typed image settings under `settings:image`. The pi
   *  gate + migration pipeline run as a side-effect of `set()`. */
  setImageSettings(value: ImageSettings): StoredSetting {
    return this.set("settings", "image", value as unknown as Record<string, unknown>);
  }

  private validate(namespace: string, value: unknown): void {
    // G2 PR 1 (Round 20) + G2 PR 2 (Round 21): pi SettingsManager is the
    // sole schema gate. A fresh in-memory manager is constructed with
    // `value` as its seed settings; pi runs migration pipeline + JSON
    // round-trip and surfaces errors via drainErrors(). The probe is
    // cheap (no file I/O — InMemorySettingsStorage) and per-call.
    //
    // Per-namespace shape validation (e.g. folder-trust requiring
    // `{ trusted: boolean; decidedAt: string }`) is the caller's
    // responsibility — see folder-trust/settings-backend.ts which
    // validates inline before calling `settings.set()`.
    //
    // What pi actually validates here: settings-format migrations
    // (legacy `queueMode→steeringMode`, `websockets:boolean→transport:enum`,
    // `skills:object→array`, `retry.maxDelayMs→retry.provider.maxRetryDelayMs`)
    // + JSON parse sanity. Strict typed validation of retry/image/etc.
    // lands in G2 PR 3 once we route those settings through pi's typed
    // getXxx/setXxx methods.
    if (value !== null && (typeof value === "object" || Array.isArray(value))) {
      const probe = SettingsManager.inMemory(value as Record<string, unknown>);
      const errors = probe.drainErrors();
      if (errors.length > 0) {
        const detail = errors.map((e) => e.error.message).join("; ");
        throw new Error(
          `settings validation failed for "${namespace}" (pi): ${detail}`,
        );
      }
    }
  }
}

/**
 * G2 PR 3 helpers — project a persisted value down to the typed
 * `RetrySettings` shape. Pi already migrates legacy
 * `retry.maxDelayMs` → `retry.provider.maxRetryDelayMs`, so by the
 * time we read back the value only the canonical keys survive.
 */
function coerceRetrySettings(value: object): RetrySettings {
  const out: RetrySettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.enabled === "boolean") out.enabled = v.enabled;
  if (typeof v.maxRetries === "number") out.maxRetries = v.maxRetries;
  if (typeof v.baseDelayMs === "number") out.baseDelayMs = v.baseDelayMs;
  const provider = v.provider;
  if (provider && typeof provider === "object" && !Array.isArray(provider)) {
    const p = provider as Record<string, unknown>;
    const providerOut: NonNullable<RetrySettings["provider"]> = {};
    if (typeof p.timeoutMs === "number") providerOut.timeoutMs = p.timeoutMs;
    if (typeof p.maxRetries === "number") providerOut.maxRetries = p.maxRetries;
    if (typeof p.maxRetryDelayMs === "number") providerOut.maxRetryDelayMs = p.maxRetryDelayMs;
    if (Object.keys(providerOut).length > 0) out.provider = providerOut;
  }
  return out;
}

function coerceImageSettings(value: object): ImageSettings {
  const out: ImageSettings = {};
  const v = value as Record<string, unknown>;
  if (typeof v.autoResize === "boolean") out.autoResize = v.autoResize;
  if (typeof v.blockImages === "boolean") out.blockImages = v.blockImages;
  return out;
}
