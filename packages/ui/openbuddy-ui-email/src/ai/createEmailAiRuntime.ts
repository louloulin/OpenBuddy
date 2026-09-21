/**
 * createEmailAiRuntime — 生产用 runtime 工厂。
 *
 * 把 capability-email 的真实 IPC(`@/lib/agent/pi-client` 的命名导出)
 * 包装成 AiInboxRuntime。
 *
 * 调用方(应用层)在自己的模块里:
 *   ```ts
 *   import { createEmailAiRuntime } from "@openbuddy/ui-email/ai/runtime";
 *   import { emailUpdateThread, emailListAccounts, ... } from "@/lib/agent/pi-client";
 *
 *   const runtime = createEmailAiRuntime({
 *     listAccounts: emailListAccounts,
 *     threadsPage: emailListThreadsPage,
 *     updateThread: emailUpdateThread,
 *     ...
 *   });
 *   ```
 *
 * 这样 UI 包不依赖 `@/` 路径别名,生产由调用方注入 IPC。
 *
 * 测试覆盖:createEmailAiRuntime.test.ts 通过 spy 验证 5 个 IPC 绑定都被调用,
 * 与 FOLLOWUP.md P0-2 的"用 spy 验证 5 个绑定"验收标准一致。
 */
import type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary } from "./types";
import type { AiInboxRuntime } from "./hooks/useAiInbox";
import type { AiInboxAccount } from "./components/AiInboxShell";
import type { RailCounts } from "./components/MailRail";
import type { EmailListFilters } from "./hooks/useEmailData";

export interface CreateEmailAiRuntimeInputs {
  /** 拉取邮箱账户列表 → 写入侧栏下拉。 */
  listAccounts(): Promise<AiInboxAccount[]>;
  /** 拉取线程分页 → 写入列表。 */
  threadsPage(filters: EmailListFilters): Promise<{
    items: Array<{
      id: string;
      accountId: string;
      subject: string;
      from: { name?: string; address: string };
      date: string;
      snippet?: string;
      unread: boolean;
      messageCount: number;
      labels: string[];
    }>;
    nextCursor?: string;
  }>;
  /** 拉取计数:Today / Later / Inbox / Drafts / Scheduled / Snoozed。 */
  counts(): Promise<RailCounts>;
  /** 触发 triage(自动给线程打 chips)。 */
  triage?(input: { accountId?: string }): Promise<{
    items: Array<{ threadId: string; categories: Array<"urgent" | "needs-reply" | "waiting-for-reply" | "noise" | "normal"> }>;
  }>;
  /** 列出已有 AI 分析 → 摘要缓存。 */
  listAnalyses(input: { accountId: string; threadId: string }): Promise<{
    items: Array<{ summary?: string; confidence?: number }>;
  }>;
  /** LLM 生成新摘要。 */
  generateSummary?(input: { accountId: string; threadId: string }): Promise<AiThreadSummary>;
  /** LLM 生成回复建议(可空 → 走 fallback)。 */
  generateReplies?(input: { accountId: string; threadId: string; count?: number }): Promise<AiReplySuggestion[]>;
  /** AI LLM 路由 — 自然语言 → 拟 action 列表。 */
  routePrompt?(prompt: string): Promise<AiAction[]>;
  /** 真正执行(archive / snooze / mark-read / label)。 */
  updateThread(input: {
    accountId: string;
    threadId: string;
    kind: AiAction["kind"];
    labelId?: string;
    snoozeUntil?: string;
  }): Promise<unknown>;
  /** 创建草稿(用于 reply-draft)。 */
  createDraft?(input: { threadId?: string; subject: string; body: string }): Promise<{ draftId: string }>;
  /** 准备发送(用于 reply-draft)。 */
  prepareSend?(input: { draftId: string }): Promise<unknown>;
  /** 反向操作(可选 — 不支持则 ReceiptToast 的撤销按钮无效)。 */
  undoAction?(receipt: AiActionReceipt): Promise<void>;
}

const CATEGORY_TO_CHIP: Record<string, "priority" | "reply" | "muted" | "action"> = {
  urgent: "priority",
  "needs-reply": "reply",
  "waiting-for-reply": "reply",
  noise: "muted",
  normal: "action",
};

export function createEmailAiRuntime(inputs: CreateEmailAiRuntimeInputs): AiInboxRuntime {
  return {
    async summarize(threadId: string): Promise<AiThreadSummary> {
      // 优先从已有分析读 → 没有再调 generate。
      try {
        const result = await inputs.listAnalyses({ accountId: "self", threadId });
        const first = result.items?.[0];
        if (first?.summary) {
          return {
            threadId,
            oneLiner: first.summary,
            keyPoints: [],
            actionItems: [],
            confidence: first.confidence ?? 0.5,
            citations: [],
            generatedAt: new Date().toISOString(),
          };
        }
      } catch { /* ignore — fallback */ }
      if (inputs.generateSummary) {
        return inputs.generateSummary({ accountId: "self", threadId });
      }
      // No-op fallback — UI 会显示 "AI 尚未生成摘要"。
      return {
        threadId,
        oneLiner: "(AI 尚未生成摘要)",
        keyPoints: [],
        actionItems: [],
        confidence: 0.5,
        citations: [],
        generatedAt: new Date().toISOString(),
      };
    },
    async suggestReplies(threadId: string, count = 3): Promise<AiReplySuggestion[]> {
      if (inputs.generateReplies) {
        return inputs.generateReplies({ accountId: "self", threadId, count });
      }
      // 占位 fallback。
      const tones: Array<AiReplySuggestion["tone"]> = ["concise", "inquisitive", "delegate"];
      return Array.from({ length: count }, (_, index) => ({
        id: `${threadId}-reply-${index}`,
        tone: tones[index % tones.length]!,
        subject: "",
        body: "",
        confidence: 0.5,
        reason: "AI 默认占位建议",
      }));
    },
    async plan(prompt: string, threadIds: string[]): Promise<AiAction[]> {
      if (inputs.routePrompt) {
        try {
          return await inputs.routePrompt(prompt);
        } catch { /* fall through */ }
      }
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
          if (action.kind === "mark-read" || action.kind === "archive" || action.kind === "label" || action.kind === "snooze") {
            await inputs.updateThread({
              accountId: "self",
              threadId: action.threadId,
              kind: action.kind,
              ...(action.label ? { labelId: action.label } : {}),
              ...(action.snoozeUntil ? { snoozeUntil: action.snoozeUntil } : {}),
            });
          } else if (action.kind === "reply-draft" && inputs.prepareSend && action.draftId) {
            await inputs.prepareSend({ draftId: action.draftId });
          } else if (action.kind === "create-task" && inputs.createDraft && action.taskTitle) {
            await inputs.createDraft({ subject: action.taskTitle, body: "" });
          }
          receipts.push({ actionId: action.id, threadId: action.threadId, kind: action.kind, status: "executed" });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          receipts.push({
            actionId: action.id,
            threadId: action.threadId,
            kind: action.kind,
            status: "failed",
            reason: errMsg,
          });
        }
      }
      return receipts;
    },
    async undo(receipts: AiActionReceipt[]): Promise<void> {
      if (!inputs.undoAction) return;
      for (const r of receipts) {
        if (r.status !== "executed") continue;
        try { await inputs.undoAction(r); } catch (e: unknown) { /* swallow per-receipt */ void e; }
      }
    },
    async routePrompt(prompt: string): Promise<AiAction[]> {
      if (inputs.routePrompt) return inputs.routePrompt(prompt);
      return [];
    },
  };
}

/** 暴露 listAccounts / threadsPage / counts / triage 给 useEmailData 注入。 */
export function createEmailDataProvider(runtimeInputs: CreateEmailAiRuntimeInputs): {
  listAccounts(): Promise<AiInboxAccount[]>;
  listThreads(filters: EmailListFilters): Promise<Array<{
    id: string;
    accountId: string;
    subject: string;
    from: { name?: string; address: string };
    date: string;
    snippet?: string;
    unread: boolean;
    messageCount: number;
    labels: string[];
    aiChips?: Array<"priority" | "reply" | "action" | "muted">;
  }>>;
  counts(): Promise<RailCounts>;
  triage?(input: { accountId?: string }): Promise<Record<string, Array<"priority" | "reply" | "action" | "muted">>>;
} {
  return {
    listAccounts: runtimeInputs.listAccounts,
    async listThreads(filters) {
      const result = await runtimeInputs.threadsPage(filters);
      return result.items;
    },
    counts: runtimeInputs.counts,
    triage: runtimeInputs.triage
      ? async (input) => {
          const result = await runtimeInputs.triage!(input);
          const out: Record<string, Array<"priority" | "reply" | "action" | "muted">> = {};
          for (const item of result.items) {
            const chips = new Set<"priority" | "reply" | "muted" | "action">();
            for (const cat of item.categories) {
              const chip = CATEGORY_TO_CHIP[cat];
              if (chip) chips.add(chip);
            }
            out[item.threadId] = [...chips];
          }
          return out;
        }
      : undefined,
  };
}
