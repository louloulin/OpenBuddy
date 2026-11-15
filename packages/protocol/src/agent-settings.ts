/**
 * Agent behaviour settings (20261116-pii W0.4 / W1.5 / W1.6).
 *
 * Session behaviour — compaction, retry, queue delivery, cache warming, favourite models and the
 * built-in extension switches — is persisted in `pi-settings.json` and applied through Pi's own
 * `SettingsManager` (pii §8). App and security settings (permissions, trust, notifications) stay
 * in `openbuddy.json`. Nothing here is a secret.
 */
import type { ModelState } from './dto.js';
import type { SessionExpertInfo } from './experts.js';

/** 逐条: one queued message per turn. 合并: everything queued goes in one turn. */
export type QueueDeliveryMode = 'one-at-a-time' | 'all';
export const QUEUE_DELIVERY_MODES: readonly QueueDeliveryMode[] = ['one-at-a-time', 'all'];
/** Prompt-cache warming: off / while a reply streams / also between runs (Pi's default). */
export type CacheWarmingMode = 'off' | 'streaming' | 'idle';
export const CACHE_WARMING_MODES: readonly CacheWarmingMode[] = ['off', 'streaming', 'idle'];
/** 做一做 / 想一想 / 问一问. */
export type AgentModeName = 'craft' | 'plan' | 'ask';

export interface AutoCompactionSettings {
  enabled: boolean;
  /** Compact once fewer than this many tokens of the context window are left. */
  reserveTokens: number;
  /** Recent tokens kept verbatim when older history is summarised. */
  keepRecentTokens: number;
}
export interface AutoRetrySettings {
  enabled: boolean;
  /** Retries after a transient provider error (rate limit, overload, 5xx). */
  maxRetries: number;
}
export interface BuiltinExtensionSetting {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
}

/** `settings_agent_get` / `settings_agent_set` result. */
export interface AgentSettings {
  autoCompaction: AutoCompactionSettings;
  autoRetry: AutoRetrySettings;
  /** 插话 (steer) delivery. */
  steeringMode: QueueDeliveryMode;
  /** 追加 (follow-up) delivery. */
  followUpMode: QueueDeliveryMode;
  cacheWarming: CacheWarmingMode;
  /** Favourite models as provider-qualified model keys (`model:<provider>/<model>`), in cycle order. */
  favoriteModels: string[];
  builtins: BuiltinExtensionSetting[];
}

/** `settings_agent_set` payload `{ patch }`: only the fields that change. */
export interface AgentSettingsPatch {
  autoCompaction?: Partial<AutoCompactionSettings>;
  autoRetry?: Partial<AutoRetrySettings>;
  steeringMode?: QueueDeliveryMode;
  followUpMode?: QueueDeliveryMode;
  cacheWarming?: CacheWarmingMode;
  favoriteModels?: string[];
  builtins?: Record<string, boolean>;
}

export const AGENT_SETTINGS_LIMITS = {
  reserveTokens: { min: 1024, max: 1_000_000 },
  keepRecentTokens: { min: 1024, max: 1_000_000 },
  maxRetries: { min: 0, max: 10 },
  favoriteModels: 50,
  builtins: 64,
} as const;

/** Model state plus the session facts the composer shows next to it (W0.5, W1.6). */
export interface SessionModelState extends ModelState {
  mode?: AgentModeName;
  /** False when the current model has no reasoning: the thinking control is greyed out. */
  supportsThinking?: boolean;
  /** The expert bound on the current branch (W2.2); null when none. Follows branch moves. */
  expert?: SessionExpertInfo | null;
}

/** `agent_cycle_model` (Ctrl/Cmd+P) result. `changed: false` says why nothing moved. */
export interface ModelCycleResult {
  changed: boolean;
  reason?: 'no_favorites' | 'single_favorite';
  state: SessionModelState;
}

/** Spend from Pi's own accounting (S4). `priced` is false when no price data is known. */
export interface SessionCost {
  total: number;
  priced: boolean;
  currency: 'USD';
}

/** Extra fields of `agent_session_usage` (W1.5). */
export interface SessionUsageExtras {
  cost?: SessionCost;
}

/** Extra fields of `agent_session_info` (W0.5, W1.5). */
export interface SessionInfoExtras {
  mode?: AgentModeName;
  /** Whether automatic compaction is on for this session (the popover switch). */
  autoCompaction?: boolean;
}

const MODEL_KEY = /^model:[^/\s]+\/\S+$/;
const BUILTIN_ID = /^[a-z][a-z0-9-]{0,63}$/;

/** Shape check for `settings_agent_set` (validate.ts); the host still resolves model keys. */
export function validateAgentSettingsPatch(value: unknown): AgentSettingsPatch {
  const fail = (key: string): never => { throw new Error(`invalid_payload: patch.${key}`); };
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(value)) fail('object');
  const patch = value as Record<string, unknown>;
  const allowed = ['autoCompaction', 'autoRetry', 'steeringMode', 'followUpMode', 'cacheWarming', 'favoriteModels', 'builtins'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) fail(key);
  const integer = (group: Record<string, unknown>, key: 'reserveTokens' | 'keepRecentTokens' | 'maxRetries', path: string) => {
    const v = group[key];
    if (v === undefined) return;
    const { min, max } = AGENT_SETTINGS_LIMITS[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path);
  };
  const group = (key: string, fields: string[]) => {
    const v = patch[key];
    if (v === undefined) return undefined;
    if (!isObject(v)) return fail(key);
    for (const field of Object.keys(v)) if (!fields.includes(field)) fail(`${key}.${field}`);
    if (v.enabled !== undefined && typeof v.enabled !== 'boolean') fail(`${key}.enabled`);
    return v;
  };
  const compaction = group('autoCompaction', ['enabled', 'reserveTokens', 'keepRecentTokens']);
  if (compaction) { integer(compaction, 'reserveTokens', 'autoCompaction.reserveTokens'); integer(compaction, 'keepRecentTokens', 'autoCompaction.keepRecentTokens'); }
  const retry = group('autoRetry', ['enabled', 'maxRetries']);
  if (retry) integer(retry, 'maxRetries', 'autoRetry.maxRetries');
  for (const key of ['steeringMode', 'followUpMode'])
    if (patch[key] !== undefined && !QUEUE_DELIVERY_MODES.includes(patch[key] as QueueDeliveryMode)) fail(key);
  if (patch.cacheWarming !== undefined && !CACHE_WARMING_MODES.includes(patch.cacheWarming as CacheWarmingMode)) fail('cacheWarming');
  if (patch.favoriteModels !== undefined) {
    const list = patch.favoriteModels;
    if (!Array.isArray(list) || list.length > AGENT_SETTINGS_LIMITS.favoriteModels) fail('favoriteModels');
    const keys = list as unknown[];
    if (keys.some((k) => typeof k !== 'string' || k.length > 1024 || !MODEL_KEY.test(k)) || new Set(keys).size !== keys.length) fail('favoriteModels');
  }
  if (patch.builtins !== undefined) {
    if (!isObject(patch.builtins)) fail('builtins');
    const entries = Object.entries(patch.builtins as Record<string, unknown>);
    if (entries.length > AGENT_SETTINGS_LIMITS.builtins || entries.some(([id, on]) => !BUILTIN_ID.test(id) || typeof on !== 'boolean')) fail('builtins');
  }
  return patch as AgentSettingsPatch;
}
