/**
 * EmailAiBridge — 把 capability-email 的 IPC 表面适配到 AiInboxRuntime。
 *
 * 设计意图:
 *   - 让 AiInboxShell 与具体 IPC 解耦;测试可以注入 mock runtime。
 *   - 这里只暴露 5 个原子:summary / suggestReplies / plan / execute / undo / routePrompt。
 *   - 实际生产代码使用 `createEmailCapabilityRuntime(...)` 工厂注入即可。
 */
import type { AiInboxRuntime } from "./hooks/useAiInbox";
import type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary } from "./types";

export type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary };

export interface EmailCapabilityHandlers {
  listAnalyses(input: { accountId: string; threadId: string }): Promise<unknown>;
  saveAnalysis(input: unknown): Promise<unknown>;
  createRemindersFromAnalysis(input: unknown): Promise<unknown>;
  update(input: unknown, bypass?: unknown): Promise<unknown>;
  createDraft(input: unknown): Promise<unknown>;
  prepareSend(draftId: string, bypass?: unknown): Promise<unknown>;
  sendDraft(draftId: string, confirmationToken?: string): Promise<unknown>;
  /** AI route planner — 在生产里调 LLM,测试里可 mock。 */
  routePrompt?(prompt: string): Promise<AiAction[]>;
}

/**
 * 默认实现 — 不调任何外部副作用,只把 prompt 解析为最朴素的 action。
 * 真正的 AI 接入由使用方覆盖 `routePrompt`。
 */
import { createAiInboxRuntime } from "./hooks/useAiInbox";

export function createEmailCapabilityRuntime(
  handlers: EmailCapabilityHandlers,
): AiInboxRuntime {
  return createAiInboxRuntime({
    async summarize(threadId: string): Promise<AiThreadSummary> {
      const analyses = (await handlers.listAnalyses({
        accountId: "self",
        threadId,
      })) as { items?: Array<{ summary?: string; confidence?: number }> } | undefined;
      const first = analyses?.items?.[0];
      return {
        threadId,
        oneLiner: first?.summary ?? "(AI 尚未生成摘要)",
        keyPoints: [],
        actionItems: [],
        confidence: first?.confidence ?? 0.5,
        citations: [],
        generatedAt: new Date().toISOString(),
      };
    },
    async suggestReplies(threadId: string, count = 3): Promise<AiReplySuggestion[]> {
      // 生产实现:调 LLM 生成 3 选 1。这里给一个保守的占位,确保 UI 闭环跑通。
      const tones: Array<AiReplySuggestion["tone"]> = ["concise", "inquisitive", "delegate"];
      return Array.from({ length: count }, (_, index) => ({
        id: `${threadId}-reply-${index}`,
        tone: tones[index % tones.length] ?? "concise",
        subject: "",
        body: "",
        confidence: 0.5,
        reason: "AI 默认占位建议",
      }));
    },
    async plan(_prompt: string, threadIds: string[]): Promise<AiAction[]> {
      // 默认规划:把选中线程标记为已读 + 归档(占位)。
      return threadIds.map((threadId, index) => ({
        id: `${threadId}-action-${index}`,
        kind: "mark-read",
        threadId,
        confidence: 0.85,
        reason: "占位规划:已读",
      }));
    },
    async execute(actions: AiAction[]): Promise<AiActionReceipt[]> {
      const receipts: AiActionReceipt[] = [];
      for (const action of actions) {
        try {
          if (action.kind === "mark-read" || action.kind === "archive" || action.kind === "label") {
            await handlers.update({ threadId: action.threadId, mutation: action.kind });
          } else if (action.kind === "reply-draft" && action.draftId) {
            await handlers.prepareSend(action.draftId);
          } else if (action.kind === "create-task" && action.taskTitle) {
            await handlers.createDraft({ taskTitle: action.taskTitle, dueAt: action.taskDueAt });
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
    async undo(_receipts: AiActionReceipt[]): Promise<void> {
      // 占位:实际由 capability-email 的反向 mutation 提供。
    },
    async routePrompt(prompt: string): Promise<AiAction[]> {
      if (handlers.routePrompt) {
        return handlers.routePrompt(prompt);
      }
      return [];
    },
  });
}
