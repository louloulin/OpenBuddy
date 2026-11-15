import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  AutoCompactionSettings,
  AutoRetrySettings,
  CacheWarmingMode,
  QueueDeliveryMode,
} from "@openbuddy/protocol/agent-settings";

/**
 * `pi-settings.json` (20261116-pii W0.4): the session-behaviour settings that Pi's own
 * `SettingsManager` reads — compaction, retry, queue delivery, cache warming, favourite models —
 * plus the built-in extension switches. It sits next to `openbuddy.json` in the app's Pi data dir;
 * app and security settings stay there (§8).
 *
 * File shape: `{ version: 1, pi: <Pi global settings>, builtins: { [id]: boolean } }`.
 * Only the Pi keys in PERSISTED_KEYS reach the disk; anything else Pi writes stays in memory, so the
 * file never holds a secret (e.g. an `httpProxy` with credentials).
 */
export const PI_SETTINGS_FILE = "pi-settings.json";
const PERSISTED_KEYS = ["compaction", "retry", "steeringMode", "followUpMode", "cacheWarming", "enabledModels", "deviceId"];

type Json = Record<string, unknown>;
interface PiSettingsFile {
  version: 1;
  pi: Json;
  builtins: Record<string, boolean>;
}
/** Pi's `SettingsStorage` (not exported from the SDK root; `fromStorage` accepts it structurally). */
interface SettingsStorageLike {
  withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void;
}

/** What the settings screen shows: stored values resolved against Pi's defaults. */
export interface ResolvedPiSettings {
  autoCompaction: AutoCompactionSettings;
  autoRetry: AutoRetrySettings;
  steeringMode: QueueDeliveryMode;
  followUpMode: QueueDeliveryMode;
  cacheWarming: CacheWarmingMode;
  /** Favourite models as Pi model references (`<provider>/<modelId>`, Pi's `enabledModels`). */
  favoriteRefs: string[];
  builtins: Record<string, boolean>;
}
export interface PiSettingsPatch {
  autoCompaction?: Partial<AutoCompactionSettings>;
  autoRetry?: Partial<AutoRetrySettings>;
  steeringMode?: QueueDeliveryMode;
  followUpMode?: QueueDeliveryMode;
  cacheWarming?: CacheWarmingMode;
  favoriteRefs?: string[];
  builtins?: Record<string, boolean>;
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const pick = (value: Json) => Object.fromEntries(Object.entries(value).filter(([key, v]) => PERSISTED_KEYS.includes(key) && v !== undefined));
const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

export class PiSettingsStore {
  readonly path: string;
  /** Set while the file on disk does not parse; the next write keeps a copy aside first. */
  private corrupt = false;
  constructor(dir: string) {
    this.path = join(dir, PI_SETTINGS_FILE);
  }
  private load(): PiSettingsFile {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
      this.corrupt = false;
    } catch (error) {
      this.corrupt = (error as NodeJS.ErrnoException).code !== "ENOENT" && existsSync(this.path);
      raw = undefined;
    }
    const data = isObject(raw) ? raw : {};
    const builtins = isObject(data.builtins)
      ? Object.fromEntries(Object.entries(data.builtins).filter(([, on]) => typeof on === "boolean")) as Record<string, boolean>
      : {};
    return { version: 1, pi: isObject(data.pi) ? pick(data.pi) : {}, builtins };
  }
  private save(file: PiSettingsFile) {
    if (this.corrupt && existsSync(this.path)) renameSync(this.path, `${this.path}.corrupt-${Date.now()}`);
    this.corrupt = false;
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, pi: pick(file.pi), builtins: file.builtins }, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  /**
   * Pi `SettingsStorage`: the global scope is this file's `pi` section. Project settings are never
   * read from disk (a workspace's `.pi/settings.json` was not read before W0.4 either), so this
   * file is the single source and the settings screen never disagrees with what runs; the
   * per-session `projectTrusted` flag is still handed to Pi for everything else it gates.
   */
  private readonly storage: SettingsStorageLike = {
    withLock: (scope, fn) => {
      if (scope === "project") {
        fn(undefined);
        return;
      }
      const file = this.load();
      const next = fn(Object.keys(file.pi).length ? JSON.stringify(file.pi) : undefined);
      if (next === undefined) return;
      const parsed: unknown = JSON.parse(next);
      file.pi = isObject(parsed) ? pick(parsed) : {};
      this.save(file);
    },
  };
  /** A real Pi `SettingsManager` backed by this file; one per session (trust differs per workspace). */
  manager(projectTrusted: boolean): SettingsManager {
    return SettingsManager.fromStorage(this.storage, { projectTrusted });
  }
  resolved(): ResolvedPiSettings {
    const file = this.load();
    const m = this.manager(false);
    let compaction = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
    let retry = { enabled: true, maxRetries: 3 };
    try { compaction = m.getCompactionSettings(); } catch { /* hand-edited bad numbers: Pi's defaults */ }
    try { const r = m.getRetrySettings(); retry = { enabled: r.enabled, maxRetries: r.maxRetries }; } catch { /* defaults */ }
    const refs = m.getEnabledModels();
    return {
      autoCompaction: { enabled: compaction.enabled, reserveTokens: compaction.reserveTokens, keepRecentTokens: compaction.keepRecentTokens },
      autoRetry: retry,
      steeringMode: m.getSteeringMode(),
      followUpMode: m.getFollowUpMode(),
      cacheWarming: m.getCacheWarmingMode(),
      favoriteRefs: Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [],
      builtins: file.builtins,
    };
  }
  /** Built-ins are on unless switched off (pii §5: each can be turned off on its own). */
  builtinEnabled(id: string): boolean {
    return this.load().builtins[id] !== false;
  }
  update(patch: PiSettingsPatch): ResolvedPiSettings {
    const file = this.load();
    const pi = file.pi;
    if (patch.autoCompaction) pi.compaction = { ...(isObject(pi.compaction) ? pi.compaction : {}), ...defined(patch.autoCompaction) };
    if (patch.autoRetry) pi.retry = { ...(isObject(pi.retry) ? pi.retry : {}), ...defined(patch.autoRetry) };
    if (patch.steeringMode) pi.steeringMode = patch.steeringMode;
    if (patch.followUpMode) pi.followUpMode = patch.followUpMode;
    if (patch.cacheWarming) pi.cacheWarming = patch.cacheWarming;
    if (patch.favoriteRefs) pi.enabledModels = patch.favoriteRefs.length ? [...patch.favoriteRefs] : undefined;
    if (patch.builtins) file.builtins = { ...file.builtins, ...patch.builtins };
    this.save(file);
    return this.resolved();
  }
}
