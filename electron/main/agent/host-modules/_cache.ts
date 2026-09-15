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
 *   - `invalidateSessionsCache()` clears both the listSessions and
 *     listAllPiSessions caches; wired in session lifecycle emit sites
 *     (rebind, dispose, metadata updates) so the TTL is the worst-case staleness,
 *     not the steady-state.
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

export function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = sessionsCache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > now) {
    return Promise.resolve(hit.result);
  }
  if (hit?.inFlight) {
    return hit.inFlight;
  }
  const p = fn()
    .then((result) => {
      sessionsCache.set(key, { result: result as unknown, expires: Date.now() + ttlMs });
      return result;
    })
    .finally(() => {
      const entry = sessionsCache.get(key) as CacheEntry<T> | undefined;
      if (entry) delete entry.inFlight;
    });
  sessionsCache.set(key, { ...(hit ?? {}), inFlight: p } as CacheEntry<T>);
  return p;
}

export function cachedListSessions<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return withCache(`${LIST_SESSIONS_KEY_PREFIX}${cwd}`, LIST_SESSIONS_TTL_MS, fn);
}

export function cachedListAllPiSessions<T>(fn: () => Promise<T>): Promise<T> {
  return withCache(LIST_ALL_PI_SESSIONS_KEY, LIST_ALL_PI_SESSIONS_TTL_MS, fn);
}

/** Drop every cached result; called from session lifecycle event emit sites. */
export function invalidateSessionsCache(): void {
  sessionsCache.clear();
}

/** Test/debug helper. */
export function __resetSessionsCacheForTest(): void {
  sessionsCache.clear();
}