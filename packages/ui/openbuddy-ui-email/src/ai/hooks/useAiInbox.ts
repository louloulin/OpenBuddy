/**
 * useAiInbox — Email AI 闭环编排 hook。
 *
 * 设计意图:把 capability-email 暴露的 60+ IPC 调用,合并成 5 个 UI 友好的原子操作:
 *   - `summarize(threadId)`   → 一次性生成摘要,带缓存
 *   - `suggestReplies(threadId, count=3)` → 生成 N 个回复候选
 *   - `propose(prompt, threadIds)`  → AI 给一组待执行 action
 *   - `execute(actions)` → 执行(基于 capability-email mutation + compose)
 *   - `inbox(prompt)` → 顶层入口,自动 distribute 到对应动作
 *
 * P3-4 改进 — SWR 缓存:
 *   - summaries / replies 走模块级 SWR 缓存(共享给所有 useAiInbox 实例)。
 *   - 默认 30s TTL,过期返回旧值并后台重抓,避免每次切线程都重 fetch。
 *   - `invalidate(threadId)` 仍可强制重抓(thread 已删除 / 用户手动刷新)。
 *
 * 关键不变量:
 *   - 摘要/回复建议是 read-only,绝不触发 email mutation。
 *   - 任何 mutation 必须经由 useAiLoop 的 acceptPlan,不可直接调用。
 *   - planner/executor 由父组件注入 — 这样测试可 mock,且将来切换本地/远程 AI 不破坏 UI。
 */
import { useCallback, useMemo, useState } from "react";
import type {
  AiAction,
  AiActionReceipt,
  AiReplySuggestion,
  AiThreadSummary,
  AsyncPhase,
} from "../types";
import { phaseError, phaseIdle, phaseLoading, phaseReady } from "../types";
import { swrCacheInternal } from "./useSwrCache";
import { recordTelemetry } from "../telemetry-store";

/** SWR TTL,可在测试 / Storybook 改短。 */
const SWR_TTL_MS = 30_000;

function summaryKey(threadId: string): string { return `summary:${threadId}`; }
function repliesKey(threadId: string): string { return `replies:${threadId}`; }

export type AiTriageChip = "priority" | "reply" | "action" | "muted";

export interface AiTriageHint {
  /** 线程 id。 */
  threadId: string;
  /** AI 自动识别的标签列表 — 合并到行的 aiChips 上。 */
  chips: AiTriageChip[];
  /** 0..1,只用来给行排序 / 显示粗略强度,不参与 plan。 */
  confidence: number;
  /** AI 给的简短原因,前端可 tooltip。 */
  reason?: string;
}

export interface AiInboxRuntime {
  /** 生成摘要 — read-only。 */
  summarize: (threadId: string) => Promise<AiThreadSummary>;
  /** 生成回复建议 — read-only。 */
  suggestReplies: (threadId: string, count?: number) => Promise<AiReplySuggestion[]>;
  /** 根据自然语言 + 线程列表,生成拟执行 action 列表。 */
  plan: (prompt: string, threadIds: string[]) => Promise<AiAction[]>;
  /** 真正执行 action — 必须经 useAiLoop 包裹。 */
  execute: (actions: AiAction[]) => Promise<AiActionReceipt[]>;
  /** 撤销 — 同一组 receipt 必须可逆。 */
  undo: (receipts: AiActionReceipt[]) => Promise<void>;
  /** 反向:input → 自动路由。 */
  routePrompt: (prompt: string) => Promise<AiAction[]>;
  /**
   * 自动 triage(可选)。
   * 返回当前账户下应该被高亮的若干线程 + chip。Shell 启动后 ~2s 自动调用一次,
   * 用于让 AI 标签无需用户主动点击即出现。失败/缺失时直接返回 []。
   */
  triage?: (accountId: string, threadIds: string[]) => Promise<AiTriageHint[]>;
}

export interface UseAiInboxArgs {
  /** 实现注入 — 测试可替换。 */
  runtime: AiInboxRuntime;
  /** SWR TTL,默认 30s。 */
  swrTtlMs?: number;
}

export interface UseAiInboxResult {
  summaries: Record<string, AsyncPhase<AiThreadSummary>>;
  replies: Record<string, AsyncPhase<AiReplySuggestion[]>>;
  /** 摘要当前线程(命中 SWR 缓存则不再重抓)。 */
  ensureSummary: (threadId: string) => Promise<AiThreadSummary>;
  /** 生成 N 个回复建议。 */
  ensureReplies: (threadId: string, count?: number) => Promise<AiReplySuggestion[]>;
  /** 让 AI 处理 inbox 自然语言命令。 */
  routePrompt: (prompt: string) => Promise<AiAction[]>;
  /** 清空缓存(thread 已删除时)。 */
  invalidate: (threadId: string) => void;
}

export function useAiInbox({ runtime, swrTtlMs = SWR_TTL_MS }: UseAiInboxArgs): UseAiInboxResult {
  // 本地维护 summaries / replies 的 phase 镜像 — SWR cache 是单一存储。
  const [summaries, setSummaries] = useState<Record<string, AsyncPhase<AiThreadSummary>>>({});
  const [replies, setReplies] = useState<Record<string, AsyncPhase<AiReplySuggestion[]>>>({});

  const ensureSummary = useCallback(
    async (threadId: string) => {
      const key = summaryKey(threadId);
      const cached = swrCacheInternal.get<AiThreadSummary>(key);
      const isFresh = cached && Date.now() - cached.generatedAt < swrTtlMs;
      if (isFresh) {
        return cached.value;
      }
      // SWR 模式:无论是否 stale,都先显示已缓存的值(若有)。
      if (cached) {
        setSummaries((current) => ({ ...current, [threadId]: phaseReady(cached.value) }));
        // 埋点:stale 命中(命中缓存但 TTL 已过期)— 用于评估缓存命中率。
        recordTelemetry("ai_summary_stale_hit", { threadId });
        // 后台 revalidate。
        void runtime.summarize(threadId)
          .then((value) => {
            swrCacheInternal.set(key, value);
            setSummaries((current) => ({ ...current, [threadId]: phaseReady(value) }));
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setSummaries((current) => ({ ...current, [threadId]: phaseError<AiThreadSummary>(message) }));
          });
        return cached.value;
      }
      // 首次加载:走 loading + 完整 fetcher。
      setSummaries((current) => ({ ...current, [threadId]: phaseLoading() }));
      try {
        const value = await runtime.summarize(threadId);
        swrCacheInternal.set(key, value);
        setSummaries((current) => ({ ...current, [threadId]: phaseReady(value) }));
        return value;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errored = phaseError<AiThreadSummary>(message);
        setSummaries((current) => ({ ...current, [threadId]: errored }));
        throw err;
      }
    },
    [runtime, swrTtlMs],
  );

  const ensureReplies = useCallback(
    async (threadId: string, count = 3) => {
      const key = repliesKey(threadId);
      const cached = swrCacheInternal.get<AiReplySuggestion[]>(key);
      const isFresh = cached && Date.now() - cached.generatedAt < swrTtlMs;
      if (isFresh) {
        return cached.value;
      }
      if (cached) {
        setReplies((current) => ({ ...current, [threadId]: phaseReady(cached.value) }));
        void runtime.suggestReplies(threadId, count)
          .then((value) => {
            swrCacheInternal.set(key, value);
            setReplies((current) => ({ ...current, [threadId]: phaseReady(value) }));
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setReplies((current) => ({ ...current, [threadId]: phaseError<AiReplySuggestion[]>(message) }));
          });
        return cached.value;
      }
      setReplies((current) => ({ ...current, [threadId]: phaseLoading() }));
      try {
        const value = await runtime.suggestReplies(threadId, count);
        swrCacheInternal.set(key, value);
        setReplies((current) => ({ ...current, [threadId]: phaseReady(value) }));
        return value;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errored = phaseError<AiReplySuggestion[]>(message);
        setReplies((current) => ({ ...current, [threadId]: errored }));
        throw err;
      }
    },
    [runtime, swrTtlMs],
  );

  const routePromptFn = useCallback(
    async (prompt: string) => runtime.routePrompt(prompt),
    [runtime],
  );

  const invalidate = useCallback((threadId: string) => {
    swrCacheInternal.invalidate(summaryKey(threadId));
    swrCacheInternal.invalidate(repliesKey(threadId));
    setSummaries((current) => {
      if (!(threadId in current)) return current;
      const { [threadId]: _drop, ...rest } = current;
      return rest;
    });
    setReplies((current) => {
      if (!(threadId in current)) return current;
      const { [threadId]: _drop, ...rest } = current;
      return rest;
    });
  }, []);

  return useMemo(
    () => ({ summaries, replies, ensureSummary, ensureReplies, routePrompt: routePromptFn, invalidate }),
    [summaries, replies, ensureSummary, ensureReplies, routePromptFn, invalidate],
  );
}

/**
 * 工厂:把 capability-email 的 IPC 函数映射成 AIInboxRuntime。
 * 调用方在生产代码里把具体 IPC 注入;测试里可注入 stub。
 */
export interface CreateRuntimeInputs {
  summarize: (threadId: string) => Promise<AiThreadSummary>;
  suggestReplies: (threadId: string, count?: number) => Promise<AiReplySuggestion[]>;
  plan: (prompt: string, threadIds: string[]) => Promise<AiAction[]>;
  execute: (actions: AiAction[]) => Promise<AiActionReceipt[]>;
  undo: (receipts: AiActionReceipt[]) => Promise<void>;
  routePrompt: (prompt: string) => Promise<AiAction[]>;
}

export function createAiInboxRuntime(inputs: CreateRuntimeInputs): AiInboxRuntime {
  return {
    summarize: inputs.summarize,
    suggestReplies: inputs.suggestReplies,
    plan: inputs.plan,
    execute: inputs.execute,
    undo: inputs.undo,
    routePrompt: inputs.routePrompt,
  };
}
