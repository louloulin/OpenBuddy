/**
 * host-modules/_cache.ts — tiny TTL + single-flight cache for session-list hot paths.
 *
 * Used by listSessions (5 s TTL) and listAllPiSessions (30 s TTL) to coalesce the
 * IPC loop driven by `App.tsx`'s `useEffect` on `initCwd` / `currentSessionId`
 * (debounced 200 ms but still fires several times per session switch). Without
 * this, every call walks the full piHome + per-cwd JSONL tree and parses every
 * file.
 *
 * Design notes:
 *   - Per-key TTL via `expires`. Returns cached result when fresh.
 *   - In-flight coalescing: concurrent calls share the same Promise so a renderer
 *     burst triggers at most ONE disk scan.
 *   - A monotonic **epoch** prefixes every key. Any writer that mutates the
 *     underlying session state bumps the epoch instead of having to enumerate
 *     and call `invalidateSessionsCache()` itself. That inversion is the whole
 *     point: the previous shape required every mutation site to remember, and
 *     the ones that didn't (slash-command renames, `updateMetadata` edits,
 *     core-session mirror writes) left a stale list on screen for up to the
 *     30 s `listAllPiSessions` TTL — a rename that "didn't stick" until you
 *     switched directories.
 *   - `invalidateSessionsCache()` remains as an explicit escape hatch for
 *     lifecycle events (rebind / dispose) that aren't store writes.
 */

interface CacheEntry<T> {
  result: T;
  expires: number;
  inFlight?: Promise<T>;
}

const sessionsCache = new Map<string, CacheEntry<unknown>>();

const LIST_SESSIONS_TTL_MS = 5_000;
const LIST_ALL_PI_SESSIONS_TTL_MS = 30_000;

const LIST_SESSIONS_KEY_PREFIX = "listSessions:";
const LIST_ALL_PI_SESSIONS_KEY = "listAllPiSessions";

/**
 * Bumped by every mutation of the state these caches project. A bump makes
 * every previously-issued key unreachable, so the whole map is dropped —
 * which also bounds its size, since keys would otherwise accumulate one
 * generation per epoch.
 */
let epoch = 0;

export function currentCacheEpoch(): number {
  return epoch;
}

/**
 * Invalidate every cached session-list projection. Call this from any write
 * path that mutates session titles, pin/archive state, or membership.
 */
export function bumpCacheEpoch(): void {
  epoch += 1;
  sessionsCache.clear();
}

export function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const scopedKey = `${epoch}:${key}`;
  const now = Date.now();
  const hit = sessionsCache.get(scopedKey) as CacheEntry<T> | undefined;
  if (hit && hit.expires > now) {
    return Promise.resolve(hit.result);
  }
  if (hit?.inFlight) {
    return hit.inFlight;
  }
  const p = fn()
    .then((result) => {
      sessionsCache.set(scopedKey, { result: result as unknown, expires: Date.now() + ttlMs });
      return result;
    })
    .finally(() => {
      const entry = sessionsCache.get(scopedKey) as CacheEntry<T> | undefined;
      if (entry) delete entry.inFlight;
    });
  sessionsCache.set(scopedKey, { ...(hit ?? {}), inFlight: p } as CacheEntry<T>);
  return p;
}

export function cachedListSessions<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return withCache(`${LIST_SESSIONS_KEY_PREFIX}${cwd}`, LIST_SESSIONS_TTL_MS, fn);
}

export function cachedListAllPiSessions<T>(fn: () => Promise<T>): Promise<T> {
  return withCache(LIST_ALL_PI_SESSIONS_KEY, LIST_ALL_PI_SESSIONS_TTL_MS, fn);
}

/** Drop every cached result. Alias of {@link bumpCacheEpoch}; kept because
 * lifecycle call sites (rebind / dispose) read better as "invalidate". */
export function invalidateSessionsCache(): void {
  bumpCacheEpoch();
}

/** Test/debug helper. */
export function __resetSessionsCacheForTest(): void {
  sessionsCache.clear();
}