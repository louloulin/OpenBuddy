/**
 * useEmailData — 邮件数据拉取 hook。
 *
 * 设计目标:
 *   - 集中所有"账户/线程/计数"的 IPC 调用,返回稳定的 React state。
 *   - accountId / view / folder 任一变化 → 自动重新拉取。
 *   - triage 自动跑一次 → 写入 aiChips 字段(供列表行 chip 渲染)。
 *   - 失败统一调用 onProviderError,不抛到 UI。
 *
 * 不变量:
 *   - loading 状态由各自子集独立维护,UI 可单独渲染 skeleton。
 *   - 缓存:cancel pending request,避免 stale 数据覆盖 fresh 数据。
 *   - 拉数据期间不会调 mutation,完全是 read-only。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiInboxAccount, AiInboxThread, RailCounts } from "../components/AiInboxShell";

export interface EmailListFilters {
  accountId?: string;
  /** 智能视图 + 文件夹组合,语义由 EmailData 提供者决定。 */
  view: "today" | "later" | "done";
  folder: "inbox" | "sent" | "drafts" | "scheduled" | "snoozed" | "starred" | "important" | "archive" | "trash" | "spam";
  /** 是否需要 unread 过滤(只 Today 用)。 */
  unreadOnly?: boolean;
}

export interface EmailDataProvider {
  listAccounts(): Promise<AiInboxAccount[]>;
  listThreads(filters: EmailListFilters): Promise<AiInboxThread[]>;
  counts(): Promise<RailCounts>;
  /** createEmailDataProvider 总是提供 triage。 */
  triage(input: { accountId?: string }): Promise<Record<string, Array<"priority" | "reply" | "action" | "muted">>>;
}

export interface UseEmailDataArgs {
  provider: EmailDataProvider;
  filters: EmailListFilters;
  /** 拉取失败 → 路由到 P0 错误处理。 */
  onProviderError?: (err: { message: string; code?: string }) => void;
  /** 关闭拉取(比如路由切换)。 */
  enabled?: boolean;
}

export interface UseEmailDataResult {
  accounts: AiInboxAccount[];
  threads: AiInboxThread[];
  counts: RailCounts;
  accountsLoading: boolean;
  threadsLoading: boolean;
  countsLoading: boolean;
  triageLoading: boolean;
  refresh: () => void;
}

const EMPTY_COUNTS: RailCounts = { today: 0, later: 0, done: 0, inbox: 0, drafts: 0, scheduled: 0, snoozed: 0 };

export function useEmailData({
  provider,
  filters,
  onProviderError,
  enabled = true,
}: UseEmailDataArgs): UseEmailDataResult {
  const [accounts, setAccounts] = useState<AiInboxAccount[]>([]);
  const [threads, setThreads] = useState<AiInboxThread[]>([]);
  const [counts, setCounts] = useState<RailCounts>(EMPTY_COUNTS);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [countsLoading, setCountsLoading] = useState(false);
  const [triageLoading, setTriageLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const cancelledRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, [filters.accountId, filters.view, filters.folder, refreshKey]);

  // ── accounts ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setAccountsLoading(true);
    provider.listAccounts()
      .then((next) => { if (!cancelled) setAccounts(next); })
      .catch((err: unknown) => onProviderError?.({ message: errMessage(err) }))
      .finally(() => { if (!cancelled) setAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [provider, enabled, refreshKey, onProviderError]);

  // ── counts ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setCountsLoading(true);
    provider.counts()
      .then((next) => { if (!cancelled) setCounts(next); })
      .catch((err: unknown) => onProviderError?.({ message: errMessage(err) }))
      .finally(() => { if (!cancelled) setCountsLoading(false); });
    return () => { cancelled = true; };
  }, [provider, enabled, refreshKey, onProviderError]);

  // ── threads (depends on filters) ──────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setThreadsLoading(true);
    provider.listThreads(filters)
      .then(async (next) => {
        if (cancelled) return;
        // 同步跑 triage(若有),把 aiChips 写到 thread。
        if (provider.triage) {
          try {
            setTriageLoading(true);
            const chips = await provider.triage({ accountId: filters.accountId });
            if (!cancelled) {
              const merged = next.map((t) => ({ ...t, aiChips: chips[t.id] ?? t.aiChips ?? [] }));
              setThreads(merged);
            }
          } catch (err) {
            onProviderError?.({ message: errMessage(err) });
            if (!cancelled) setThreads(next);
          } finally {
            if (!cancelled) setTriageLoading(false);
          }
        } else {
          setThreads(next);
        }
      })
      .catch((err: unknown) => onProviderError?.({ message: errMessage(err) }))
      .finally(() => { if (!cancelled) setThreadsLoading(false); });
    return () => { cancelled = true; };
  }, [provider, enabled, filters, refreshKey, onProviderError]);

  return {
    accounts,
    threads,
    counts,
    accountsLoading,
    threadsLoading,
    countsLoading,
    triageLoading,
    refresh,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
