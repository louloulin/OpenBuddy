/**
 * useSwrCache — 通用 stale-while-revalidate 缓存。
 *
 * 第 5 周改进(P3-4):把 `useAiInbox` 的 summaries / replies 升级成 SWR 缓存:
 *   - 模块级 Map,跨 React 实例共享(多个 EmailAiPanel 共享同一份摘要)。
 *   - 默认 30s TTL,过期返回旧值并后台重抓,避免每次切线程都重 fetch。
 *   - `invalidate(threadId)` 仍可强制重抓(thread 已删除 / 用户手动刷新)。
 *
 * 不依赖 zustand / react-query — 直接闭包,零依赖。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

interface CacheEntry<T> {
  value: T;
  generatedAt: number;
}

const cacheStore: {
  cache: Map<string, CacheEntry<unknown>>;
  listeners: Map<string, Set<() => void>>;
} = {
  cache: new Map(),
  listeners: new Map(),
};

function subscribe(key: string, listener: () => void): () => void {
  let set = cacheStore.listeners.get(key);
  if (!set) {
    set = new Set();
    cacheStore.listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

function notify(key: string): void {
  const set = cacheStore.listeners.get(key);
  if (!set) return;
  for (const l of set) l();
}

function getSnapshot<T>(key: string): CacheEntry<T> | undefined {
  return cacheStore.cache.get(key) as CacheEntry<T> | undefined;
}

function setEntry<T>(key: string, value: T): void {
  cacheStore.cache.set(key, { value, generatedAt: Date.now() });
  notify(key);
}

function invalidateKey(key: string): void {
  cacheStore.cache.delete(key);
  notify(key);
}

function invalidateAll(): void {
  for (const key of Array.from(cacheStore.cache.keys())) {
    invalidateKey(key);
  }
}

export interface UseSwrCacheResult<T> {
  value: T | undefined;
  loading: boolean;
  error: Error | null;
  revalidate: () => Promise<T | undefined>;
}

export function useSwrCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 30_000,
): UseSwrCacheResult<T> {
  // 订阅 cache[key] 的更新 — useSyncExternalStore 让 React 在 cache 变化时重渲染。
  const entry = useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => getSnapshot<T>(key),
    () => undefined,
  );
  // tick 周期性重算 stale — 没有 cache 更新也能在 TTL 过期时触发 revalidate。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!entry) return undefined;
    const interval = window.setInterval(() => setTick((n) => n + 1), Math.max(1000, Math.min(Math.floor(ttlMs / 2), 5_000)));
    return () => window.clearInterval(interval);
  }, [entry, ttlMs]);

  const stale = entry ? Date.now() - entry.generatedAt >= ttlMs : false;
  const loading = !entry;

  const revalidate = useCallback(async () => {
    try {
      const next = await fetcher();
      setEntry(key, next);
      return next;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn(`[useSwrCache] ${key} revalidate failed`, error);
      return undefined;
    }
  }, [key, fetcher]);

  useEffect(() => {
    if (!entry) {
      void revalidate();
      return;
    }
    if (stale) {
      // 后台 revalidate — 不阻塞当前渲染。
      void revalidate();
    }
    return undefined;
  }, [key, entry, stale, tick, revalidate]);

  return useMemo<UseSwrCacheResult<T>>(
    () => ({
      value: entry?.value,
      loading,
      error: null,
      revalidate,
    }),
    [entry, loading, revalidate],
  );
}

/** 模块级 helpers — 在 useAiInbox 内部使用,无需走 React state。 */
export const swrCacheInternal = {
  get<T>(key: string): CacheEntry<T> | undefined {
    return cacheStore.cache.get(key) as CacheEntry<T> | undefined;
  },
  set<T>(key: string, value: T): void {
    setEntry(key, value);
  },
  invalidate(key: string): void {
    invalidateKey(key);
  },
  invalidateAll(): void {
    invalidateAll();
  },
  /** 测试用:完全清空(包含 listeners)。 */
  reset(): void {
    cacheStore.cache.clear();
    cacheStore.listeners.clear();
  },
  /**
   * 测试用:把某个 key 的 generatedAt 改到过去 — 用于测试 stale revalidate。
   * 不在生产路径使用。
   */
  backdateForTests(key: string, msAgo: number): void {
    const entry = cacheStore.cache.get(key);
    if (entry) {
      entry.generatedAt = Date.now() - msAgo;
      notify(key);
    }
  },
};
