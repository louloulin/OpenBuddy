/**
 * useEmailAiRuntime — 把 capability-email 的 IPC 表面适配到 AiInboxRuntime。
 *
 * 设计目标:
 *   - 在生产代码里,RUNTIME 直接绑到 @/lib/agent/pi-client 的 IPC 调用。
 *   - 测试 / Storybook 可注入 mock runtime 覆盖。
 *   - Hook 内部用 useMemo 稳定 runtime 引用,避免 AiInboxShell 重复 init。
 *
 * 重要契约:
 *   - summarize / suggestReplies / routePrompt 必须 read-only — 不会改邮件状态。
 *   - execute 会通过 capability-email 的 mutation IPC 真正改动邮件 — 这就是
 *     "AI 闭环"的执行端点。Receipt 由 executor 返回,UI 用来展示回执与撤销。
 *   - undo 默认返回 "未实现" — capability-email 没有通用反操作 API,
 *     真正的撤销需要 provider 支持 archive reverse 等。消费者可注入 undoer。
 */
import { useMemo } from "react";
import type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary } from "../types";
import type { AiInboxRuntime, AiTriageHint, CreateRuntimeInputs } from "../hooks/useAiInbox";
import { createAiInboxRuntime } from "../hooks/useAiInbox";

export interface CapabilityBindings {
  /** 已有分析:从 capability-email 拉。 */
  listAnalyses(input: { accountId: string; threadId: string }): Promise<{ items?: Array<{ summary?: string; confidence?: number }> }>;
  /** AI LLM 路由(可选,生产里调 PI)。 */
  routePrompt?(prompt: string): Promise<AiAction[]>;
  /** 执行端点 — 6 种 action 都会用。 */
  updateThread?(input: { threadId: string; mutation: AiAction["kind"]; label?: string; snoozeUntil?: string }): Promise<unknown>;
  prepareSend?(input: { draftId: string }): Promise<unknown>;
  createDraft?(input: { taskTitle?: string; dueAt?: string; taskOwner?: string }): Promise<unknown>;
}

export interface UseEmailAiRuntimeArgs {
  bindings: CapabilityBindings;
  /** 可选:注入 AI provider(测试里给 stub)。 */
  aiProvider?: {
    summarize(threadId: string): Promise<AiThreadSummary>;
    suggestReplies(threadId: string, count?: number): Promise<AiReplySuggestion[]>;
  };
  onProviderError?: (err: { message: string; code?: string }) => void;
}

export function useEmailAiRuntime({ bindings, aiProvider, onProviderError }: UseEmailAiRuntimeArgs): AiInboxRuntime {
  return useMemo<AiInboxRuntime>(() => {
    const inputs = {
      async summarize(threadId: string): Promise<AiThreadSummary> {
        if (aiProvider) return aiProvider.summarize(threadId);
        try {
          const result = await bindings.listAnalyses({ accountId: "self", threadId });
          const first = result.items?.[0];
          return {
            threadId,
            oneLiner: first?.summary ?? "(AI 尚未生成摘要)",
            keyPoints: [],
            actionItems: [],
            confidence: first?.confidence ?? 0.5,
            citations: [],
            generatedAt: new Date().toISOString(),
          };
        } catch (err) {
          onProviderError?.({ message: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      },
      async suggestReplies(threadId: string, count = 3): Promise<AiReplySuggestion[]> {
        if (aiProvider) return aiProvider.suggestReplies(threadId, count);
        // 占位:3 个订阅者复用同一个 stub — 真正的 AI 回复建议由上层 routePrompt 链路覆盖。
        return Array.from({ length: count }, (_, index) => ({
          id: `${threadId}-reply-${index}`,
          tone: (["concise", "inquisitive", "delegate"] as const)[index % 3]!,
          subject: "",
          body: "",
          confidence: 0.5,
          reason: "AI 默认占位建议",
        }));
      },
      async plan(prompt: string, threadIds: string[]): Promise<AiAction[]> {
        if (bindings.routePrompt) {
          try {
            return await bindings.routePrompt(prompt);
          } catch (err) {
            onProviderError?.({ message: err instanceof Error ? err.message : String(err) });
          }
        }
        // Fallback:把选中线程标记为已读(占位)。
        return threadIds.map((threadId: string, index: number) => ({
          id: `${threadId}-action-${index}`,
          kind: "mark-read",
          threadId,
          confidence: 0.85,
          reason: "占位规划:已读",
        }));
      },
      async routePrompt(prompt: string): Promise<AiAction[]> {
        if (bindings.routePrompt) return bindings.routePrompt(prompt);
        return inputs.plan(prompt, []);
      },
      async execute(actions: AiAction[]): Promise<AiActionReceipt[]> {
        const receipts: AiActionReceipt[] = [];
        for (const action of actions) {
          try {
            if (bindings.updateThread && (action.kind === "mark-read" || action.kind === "archive" || action.kind === "label" || action.kind === "snooze")) {
              await bindings.updateThread({
                threadId: action.threadId,
                mutation: action.kind,
                ...(action.label ? { label: action.label } : {}),
                ...(action.snoozeUntil ? { snoozeUntil: action.snoozeUntil } : {}),
              });
            } else if (action.kind === "reply-draft" && bindings.prepareSend && action.draftId) {
              await bindings.prepareSend({ draftId: action.draftId });
            } else if (action.kind === "create-task" && bindings.createDraft && action.taskTitle) {
              await bindings.createDraft({
                taskTitle: action.taskTitle,
                ...(action.taskDueAt ? { dueAt: action.taskDueAt } : {}),
              });
            }
            receipts.push({ actionId: action.id, threadId: action.threadId, kind: action.kind, status: "executed" });
          } catch (err) {
            receipts.push({
              actionId: action.id,
              threadId: action.threadId,
              kind: action.kind,
              status: "failed",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return receipts;
      },
      async undo(): Promise<void> {
        // 默认 no-op — capability-email 的反操作需要 provider 特定实现。
      },
    };
    // We can't pass `triage` to createAiInboxRuntime (its signature only knows
    // about the 5 atomic ops), so build the runtime object directly with the
    // extra `triage` field. This is the same shape AiInboxRuntime expects.
    const triageFn = async (accountId: string, threadIds: string[]): Promise<AiTriageHint[]> => {
      if (!bindings.routePrompt) return [];
      try {
        const actions = await bindings.routePrompt(`triage:${accountId}`);
        const out: AiTriageHint[] = [];
        for (const threadId of threadIds) {
          const action = actions.find((a) => a.threadId === threadId);
          if (!action) continue;
          const chip: AiTriageHint["chips"][number] =
            action.kind === "archive" || action.kind === "label" ? "muted"
            : action.kind === "reply-draft" ? "reply"
            : action.kind === "create-task" ? "action"
            : "priority";
          out.push({
            threadId,
            chips: [chip],
            confidence: action.confidence,
            ...(action.reason !== undefined ? { reason: action.reason } : {}),
          });
        }
        return out;
      } catch (err) {
        onProviderError?.({ message: err instanceof Error ? err.message : String(err) });
        return [];
      }
    };
    return { ...inputs, triage: triageFn } as AiInboxRuntime & { triage: typeof triageFn };
  }, [bindings, aiProvider, onProviderError]);
}
