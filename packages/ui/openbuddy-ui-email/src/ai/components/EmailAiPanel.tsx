/**
 * EmailAiPanel — 推荐的新邮件面板入口(渐进迁移目标)。
 *
 * 第 3 周改进:
 *   - P0-3: 接入 useEmailData,自动从 provider 拉数据。
 *   - P1-1: 把 AI 预填的 subject/body/threadId 转发到 onOpenComposer。
 *   - 提供 isEmailAiPanelAvailable() 帮路由判断何时升级。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiInboxShell,
  type AiActionReceipt,
  type AiInboxAccount,
  type AiInboxShellProps,
  type AiInboxThread,
  type AiInboxRuntime,
  type RailCounts,
} from "./AiInboxShell";
import { AiErrorBoundary } from "./AiErrorBoundary";
import { useEmailAiRuntime } from "../hooks/useEmailAiRuntime";
import { emailStore, useEmailStore } from "../email-store";
import { useEmailData, type EmailDataProvider, type EmailListFilters } from "../hooks/useEmailData";
import { pushProviderErrorToast, pushReceipt } from "../../lib/push-provider-error-toast";

export interface EmailAiPanelProps {
  /** UI 注入(可选)。 */
  onToast?: (message: string) => void;
  onLaunch?: (prompt: string) => void;
  sessionId?: string;
  onNavigate?: (label: string) => void;
  /** 打开 Composer 的回调 — subject/body 预填(支持 AI 回复建议采纳)。 */
  onOpenComposer?: (initial?: { subject: string; body: string; threadId: string }) => void;
  /** 可选:PI AI 取消回调(应用层注入)。 */
  cancelAi?: (id: string) => void;
  /** 自定义 accounts / threads / counts / runtime 注入(测试 / Storybook)。 */
  accounts?: AiInboxAccount[];
  threads?: AiInboxThread[];
  counts?: RailCounts;
  runtime?: AiInboxRuntime;
  dataProvider?: EmailDataProvider;
  /** 可选:外部控制 selectedThreadId(测试 / 路由集成)。 */
  selectedThreadId?: string | null;
  /** 智能视图 + 文件夹 — 控制 useEmailData 拉什么数据。 */
  view?: "today" | "later" | "done";
  folder?: EmailListFilters["folder"];
}

export function EmailAiPanel({
  onToast,
  onLaunch,
  sessionId,
  onNavigate,
  onOpenComposer,
  cancelAi,
  accounts: accountsProp,
  threads: threadsProp,
  counts: countsProp,
  runtime: runtimeProp,
  dataProvider,
  selectedThreadId: selectedThreadIdProp,
  view = "today",
  folder = "inbox",
}: EmailAiPanelProps): JSX.Element {
  const onToastRef = useRef(onToast);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onToastRef.current = onToast;
    onNavigateRef.current = onNavigate;
  }, [onToast, onNavigate]);

  const handleProviderError = useCallback(
    ({ message, code }: { message: string; code?: string }) => {
      pushProviderErrorToast({
        message,
        code,
        sessionId,
        cancelAi: cancelAi ? (id: string) => cancelAi(id) : undefined,
        onNavigate: (label: string) => onNavigateRef.current?.(label),
        onToast: (m: string) => onToastRef.current?.(m),
      });
    },
    [sessionId, cancelAi],
  );

  // ── P0-3 数据层 ────────────────────────────────────────────────
  const fallbackRuntime = useEmailAiRuntime({
    bindings: { listAnalyses: async () => ({ items: [] }) },
    onProviderError: handleProviderError,
  });
  const runtime = runtimeProp ?? fallbackRuntime;

  const filters: EmailListFilters = useMemo(
    () => ({ accountId: "all", view: view ?? "today", folder: folder ?? "inbox" }),
    [view, folder],
  );

  // 只有 dataProvider 存在 + 没有 props override,才走拉取模式。
  const shouldFetch = !!(dataProvider && !accountsProp && !threadsProp && !countsProp);
  const fetched = useEmailData({
    provider: dataProvider ?? createNoopProvider(),
    filters,
    onProviderError: handleProviderError,
    enabled: shouldFetch,
  });

  const accounts = accountsProp ?? fetched.accounts;
  const threads = threadsProp ?? fetched.threads;
  const counts = countsProp ?? fetched.counts;

  // ── P3-2:UI 状态走 zustand email-store,跨路由保留。──────────────
  const accountId = useEmailStore((s) => s.accountId);
  const selectedThreadId = useEmailStore((s) => s.selectedThreadId);
  const storeView = useEmailStore((s) => s.view);
  const storeFolder = useEmailStore((s) => s.folder);
  const commandOpen = useEmailStore((s) => s.commandOpen);
  // 受控 prop 优先(测试 / Storybook)。
  useEffect(() => {
    if (selectedThreadIdProp !== undefined && selectedThreadIdProp !== selectedThreadId) {
      emailStore.setSelectedThread(selectedThreadIdProp);
    }
  }, [selectedThreadIdProp, selectedThreadId]);
  useEffect(() => { emailStore.setView(view); }, [view]);
  useEffect(() => { emailStore.setFolder(folder); }, [folder]);

  // ── P1-1: 真正把 subject / body / threadId 转发给 Composer ──────
  const handleOpenComposer = useCallback(
    (init?: { subject: string; body: string }) => {
      const subject = init?.subject ?? "";
      const body = init?.body ?? "";
      if (onOpenComposer) {
        onOpenComposer({ subject, body, threadId: selectedThreadId ?? "" });
      } else {
        // 旧默认 — 通过 onLaunch 兜底,保持兼容。
        onLaunch?.(subject);
      }
    },
    [onOpenComposer, onLaunch, selectedThreadId],
  );

  const handleReceipt = useCallback(
    (receipts: AiActionReceipt[]) => {
      if (receipts.length === 0) return;
      const executed = receipts.filter((r) => r.status === "executed");
      const failed = receipts.filter((r) => r.status === "failed");
      const parts: string[] = [];
      if (executed.length > 0) parts.push(`已执行 ${executed.length} 项`);
      if (failed.length > 0) parts.push(`失败 ${failed.length} 项`);
      onToastRef.current?.(parts.join(" · "));
      // P3-1:把回执也推到全局 toast-store — 与 provider error 走同一份队列。
      // ReceiptToast 仍渲染,作为更详细的视觉入口(toast 是次要/全局)。
      pushReceipt({ receipts });
    },
    [],
  );

  const shellProps: AiInboxShellProps = useMemo(
    () => ({
      accounts,
      accountId,
      threads,
      runtime,
      counts,
      selectedThreadId,
      onSelectAccount: emailStore.setAccount,
      onSelectThread: emailStore.setSelectedThread,
      onOpenComposer: handleOpenComposer,
      onReceipt: handleReceipt,
      ...(commandOpen ? { commandOpen } : {}),
    }),
    [accounts, accountId, threads, runtime, counts, selectedThreadId, handleOpenComposer, handleReceipt, commandOpen],
  );

  return (
    <AiErrorBoundary scope="ai-inbox">
      <AiInboxShell {...shellProps} />
    </AiErrorBoundary>
  );
}

/** 当 dataProvider 没注入时,所有数据走空 — 测试用。 */
function createNoopProvider(): EmailDataProvider {
  return {
    listAccounts: async () => [],
    listThreads: async () => [],
    counts: async () => ({ today: 0, later: 0, done: 0, inbox: 0, drafts: 0, scheduled: 0, snoozed: 0 }),
    triage: async () => ({}),
  };
}

/** 兼容旧 client.tsx slot 注册 — 让运行时可路由到 EmailAiPanel。 */
export function isEmailAiPanelAvailable(threadCount: number): boolean {
  return threadCount > 0;
}
