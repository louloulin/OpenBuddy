import type { AppEntry } from "@openbuddy/client/api/files";

/**
 * 应用面板的两组数据 (20261127-upup2 §8.5 / WorkBuddy 5.11.3 实机)。
 *
 * - 最近使用：按「最近一次使用」倒序。时间取本地切换时间（精确到毫秒）与宿主使用日
 *   （`lastUsedAt`，按天，记在当天 0 点）的较大者；同一时刻按本地切换先后。当前应用**不置顶**，
 *   只有从没用过时才补到末尾，保证绿点总有落点。面板只显示前 6 个，其余进「更多」。
 * - 推荐：已安装且启用的应用 − 最近使用 − 推荐卡点过「不用了」的 − 长期闲置的；有一句话定位的
 *   在前，其次按安装时间倒序。没有云端推荐源，不伪造。
 */
export const RECENT_VISIBLE = 6;

const dayStart = (day: string): number => {
  const at = Date.parse(`${day.slice(0, 10)}T00:00:00`);
  return Number.isFinite(at) ? at : 0;
};

export function rankRecent(
  apps: AppEntry[],
  options: { recentAppIds: string[]; recentAppAt: Record<string, string>; currentId?: string | null },
): AppEntry[] {
  const order = new Map(options.recentAppIds.map((id, index) => [id, index]));
  const timeOf = (app: AppEntry) => {
    const local = options.recentAppAt[app.id] ? Date.parse(options.recentAppAt[app.id]!) : 0;
    const host = app.lastUsedAt ? dayStart(app.lastUsedAt) : 0;
    return Math.max(Number.isFinite(local) ? local : 0, host);
  };
  const used = apps
    .filter((app) => order.has(app.id) || timeOf(app) > 0)
    .sort((a, b) => timeOf(b) - timeOf(a) || (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const current = options.currentId ? apps.find((app) => app.id === options.currentId) : undefined;
  return current && !used.includes(current) ? [...used, current] : used;
}

export function pickRecommended(
  apps: AppEntry[],
  options: { exclude: string[]; dismissed: string[]; idle: string[] },
): AppEntry[] {
  const skip = new Set([...options.exclude, ...options.dismissed, ...options.idle]);
  const installedAt = (app: AppEntry) => (app.installedAt ? Date.parse(app.installedAt) || 0 : 0);
  return apps
    .filter((app) => app.enabled !== false && !skip.has(app.id))
    .sort((a, b) => Number(!!b.tagline) - Number(!!a.tagline) || installedAt(b) - installedAt(a));
}
