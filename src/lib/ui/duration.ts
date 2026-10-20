/**
 * duration — 通用时间 / 计数格式化工具。
 *
 * 与 `MessageItem.tsx` 中既有的 `formatDurationMs` / `formatRelativeTime` /
 * `formatTokenCount` / `formatThroughput` 等价,搬到公共位置后便于:
 *   - 流式 caret / thought chip / meta chip / loading row 共用同一份实现
 *   - 单测集中维护
 *   - 各 part 子组件不再携带自己的私有 formatter
 */
export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * R8.15 — "42 tok/s" / "1.2k tok/s" formatter. Mirrors PI-Desktop's
 *  `formatTokenCount` rounding so the chip is glanceable. */
export function formatThroughput(tps: number): string {
  if (tps >= 1000) return `${(tps / 1000).toFixed(tps >= 10000 ? 0 : 1)}k`;
  if (tps >= 100) return `${Math.round(tps)}`;
  if (tps >= 10) return tps.toFixed(1);
  return tps.toFixed(2);
}

/**
 * R58 — "1.2k" / "12k" / "1.5m" formatter for raw token counts.
 *  Mirrors how ChatMinimap / ContextUsagePill already shorten large
 *  numbers so the meta chip reads consistently across the app. */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

/**
 * R8.14 — Chinese relative-time formatter. Mirrors how iOS / WeChat
 *  surface chat timestamps: 0–59s → `刚刚`, 1–59m → `X 分钟前`, 1–23h →
 *  `X 小时前`, 1d → `昨天`, 2–6d → `X 天前`, ≥7d → absolute MM-DD. */
export function formatRelativeTime(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  const date = new Date(Date.now() - ms);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}
