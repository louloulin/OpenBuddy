/** @openbuddy/storage/sqlite/settings-store — thin facade over SettingsRegistry + pi SettingsManager schema gate. G2 PR 1 (R20) pi gate; PR 2 (R21) delete SettingsValidator; PR 3 (R36) typed retry/image; PR 4 (R37) drop unused bulk/namespace helpers, move coerce to typed-settings.ts. GA gate: ≤ 50 LOC. Imports nothing from electron/main/ and nothing from index.ts. */
import type { SqliteDriver } from "./driver";
import { SettingsRegistry, type StoredSetting } from "./settings";
import { type ImageSettings, type RetrySettings, SettingsManager } from "@earendil-works/pi-coding-agent";
import { coerceImageSettings, coerceRetrySettings } from "./typed-settings";

export interface SettingsStoreOptions { driver: SqliteDriver; now?: () => string; }

/** Thin facade: set/get/list/delete + typed retry/image accessors. */
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
  get(namespace: string, key: string): StoredSetting | undefined { return this.registry.get(namespace, key); }
  getStrict(namespace: string, key: string): StoredSetting | undefined { return this.registry.getStrict(namespace, key); }
  list(namespace?: string): StoredSetting[] { return this.registry.list(namespace); }
  delete(namespace: string, key: string): boolean { return this.registry.delete(namespace, key); }
  deleteNamespace(namespace: string): number { return this.registry.deleteNamespace(namespace); }
  getRetrySettings(): RetrySettings {
    const v = this.registry.get("settings", "retry")?.value;
    return v && typeof v === "object" && !Array.isArray(v) ? coerceRetrySettings(v) : {};
  }
  setRetrySettings(value: RetrySettings): StoredSetting {
    return this.set("settings", "retry", value as unknown as Record<string, unknown>);
  }
  getImageSettings(): ImageSettings {
    const v = this.registry.get("settings", "image")?.value;
    return v && typeof v === "object" && !Array.isArray(v) ? coerceImageSettings(v) : {};
  }
  setImageSettings(value: ImageSettings): StoredSetting {
    return this.set("settings", "image", value as unknown as Record<string, unknown>);
  }
  private validate(namespace: string, value: unknown): void {
    if (value === null || (typeof value !== "object" && !Array.isArray(value))) return;
    const errors = SettingsManager.inMemory(value as Record<string, unknown>).drainErrors();
    if (errors.length === 0) return;
    throw new Error(`settings validation failed for "${namespace}" (pi): ${errors.map((e) => e.error.message).join("; ")}`);
  }
}