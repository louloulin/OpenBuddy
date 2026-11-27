import { JsonStore } from "../settings/settings.js";
import { join } from "node:path";
import { installKey } from "./install-state.js";
import type { AppEntry } from "./manifest.js";

/**
 * 应用使用统计与上下文治理 (20261126-upup UP-6.4 / 20261127-upup U5)。
 *
 * - 记录：引擎在每次工具调用结束时，按工具的来源包记一次「最近使用日」。按日聚合，同一天只写一次，
 *   不记参数、不记结果。键用包的**安装目录**（`installedPath`）：实测 Pi 对本地包在不同 cwd 下会把
 *   来源写成相对或绝对路径，安装目录才稳定；没有安装目录时退回去掉 ref 的来源。
 * - 提醒：一个已启用的应用 ≥14 天没用过（从未用过则从安装那天算起），提示「一键停用」；
 *   用户点「保留」后 14 天内不再提醒。不知道安装时间又从没用过的不提醒（宁可漏提醒，不乱提醒）。
 *
 * 文件 `<agentDir>/app-usage.json`，与会话无关。
 */
export const IDLE_DAYS = 14;

export interface AppUsageState {
  /** usageKey → 最近使用日（YYYY-MM-DD）。 */
  lastUsed: Record<string, string>;
  /** usageKey → 用户点「保留」的日期。 */
  kept: Record<string, string>;
}

export interface IdleApp {
  appId: string;
  name: string;
  packageSource: string;
  /** 最近使用日；从未用过为 null。 */
  lastUsedAt: string | null;
  idleDays: number;
}

const DAY_MS = 86_400_000;
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);
const daysBetween = (from: string, to: Date) => Math.floor((Date.parse(dayOf(to)) - Date.parse(from.slice(0, 10))) / DAY_MS);

/** 统计键：安装目录优先，其次去掉 ref 的来源。 */
export const usageKey = (pkg: { installedPath?: string; packageSource?: string; source?: string }): string =>
  pkg.installedPath ?? installKey(pkg.packageSource ?? pkg.source ?? "");

/** 记一次使用；当天已记过返回 null（调用方不必写盘）。`key` 用 `usageKey()`。 */
export function recordAppUse(state: AppUsageState, key: string, now: Date): AppUsageState | null {
  const day = dayOf(now);
  if (state.lastUsed[key] === day) return null;
  return { ...state, lastUsed: { ...state.lastUsed, [key]: day } };
}

/**
 * ≥14 天未用的已启用应用。`installedAt` 取自安装记录（U6 `appInstalls[key].current.at`）。
 */
export function idleApps(
  apps: AppEntry[],
  state: AppUsageState,
  now: Date,
  options: { installedAt?: (source: string) => string | undefined; enabled?: (app: AppEntry) => boolean } = {},
): IdleApp[] {
  const out: IdleApp[] = [];
  for (const app of apps) {
    if (!app.packageSource || app.kind === "extension" || app.source !== "pi") continue;
    if (options.enabled && !options.enabled(app)) continue;
    const key = usageKey(app);
    const kept = state.kept[key];
    if (kept && daysBetween(kept, now) < IDLE_DAYS) continue;
    const last = state.lastUsed[key];
    const since = last ?? options.installedAt?.(app.packageSource);
    if (!since) continue;
    const idle = daysBetween(since, now);
    if (idle < IDLE_DAYS) continue;
    out.push({ appId: app.id, name: app.name, packageSource: app.packageSource, lastUsedAt: last ?? null, idleDays: idle });
  }
  return out.sort((a, b) => b.idleDays - a.idleDays);
}

/** `<agentDir>/app-usage.json` 的读写；坏文件按空状态处理。 */
export class AppUsageStore {
  private readonly store: JsonStore<AppUsageState>;
  constructor(dir: string) {
    this.store = new JsonStore(join(dir, "app-usage.json"), () => ({ lastUsed: {}, kept: {} }));
  }
  read(): AppUsageState {
    const raw = this.store.read() as Partial<AppUsageState>;
    return { lastUsed: raw.lastUsed && typeof raw.lastUsed === "object" ? raw.lastUsed : {}, kept: raw.kept && typeof raw.kept === "object" ? raw.kept : {} };
  }
  /** 引擎在工具调用结束时调用；同一天重复调用不写盘。 */
  touch(key: string, now = new Date()): void {
    const next = recordAppUse(this.read(), key, now);
    if (next) this.store.write(next);
  }
  keep(key: string, now = new Date()): AppUsageState {
    const state = this.read();
    const next = { ...state, kept: { ...state.kept, [key]: dayOf(now) } };
    this.store.write(next);
    return next;
  }
  forget(key: string): void {
    const state = this.read();
    const { [key]: _used, ...lastUsed } = state.lastUsed;
    const { [key]: _kept, ...kept } = state.kept;
    this.store.write({ lastUsed, kept });
  }
}
