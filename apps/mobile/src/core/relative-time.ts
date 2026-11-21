/**
 * Relative time for lists (sessions, notifications).
 *
 * Lists want "刚刚 / 3 分钟前 / 5 小时前 / 1 天前" and a short date once an item
 * is old enough that counting days stops being useful. Accepts epoch ms or an
 * ISO string because the desktop mixes both in its payloads.
 */

export function relativeTime(at: number | string | undefined | null, now = Date.now()): string | undefined {
  if (at === undefined || at === null) return undefined
  const ms = typeof at === 'number' ? at : Date.parse(at)
  if (!Number.isFinite(ms)) return undefined
  // Clock skew between phone and desktop can make an event look "in the
  // future"; clamp it instead of rendering a negative count.
  const delta = Math.max(0, now - ms)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}
