/**
 * A tiny sliding-window rate limiter with bounded memory.
 *
 * Keys arrive from untrusted sources (public IPs), so the map must not grow
 * forever: once it passes `sweepAt` keys, every entry whose newest hit has
 * fallen out of the window is dropped on the next call.
 */

export type SlidingWindowLimiter = {
  /** Records a hit and reports whether the key is still under the limit. */
  allow: (key: string, now?: number) => boolean
  /** Drops expired keys; returns how many were removed. */
  sweep: (now?: number) => number
  /** Current key count, for tests and metrics. */
  size: () => number
}

export function slidingWindow(limit: number, windowMs = 60_000, sweepAt = 4_096): SlidingWindowLimiter {
  const seen = new Map<string, number[]>()
  const sweep = (now: number): number => {
    let dropped = 0
    for (const [key, hits] of seen) {
      const alive = hits.filter((at) => at > now - windowMs)
      if (alive.length === 0) {
        seen.delete(key)
        dropped += 1
      } else if (alive.length !== hits.length) {
        seen.set(key, alive)
      }
    }
    return dropped
  }
  return {
    allow(key, now = Date.now()): boolean {
      if (seen.size >= sweepAt) sweep(now)
      const recent = (seen.get(key) ?? []).filter((at) => at > now - windowMs)
      if (recent.length >= limit) {
        seen.set(key, recent)
        return false
      }
      recent.push(now)
      seen.set(key, recent)
      return true
    },
    sweep: (now = Date.now()) => sweep(now),
    size: () => seen.size,
  }
}
