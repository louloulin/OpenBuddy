/**
 * Shared fixture data used by all AI inbox stories.
 * Mirrors the data shapes from `__tests__/AiInboxShell.test.tsx` so that visual
 * regressions stay in sync with behavioural tests.
 */
import type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary } from "../types";
import type { AiInboxRuntime } from "../hooks/useAiInbox";

export const sampleSummary: AiThreadSummary = {
  threadId: "t1",
  oneLiner: "Lin 希望你今天确认 Q4 roadmap,并在周三前给出 mobile H5 兼容性结论。",
  keyPoints: [
    "mobile H5 兼容性是 blocking",
    "周三前端 review 之前需要确认方向",
  ],
  actionItems: [
    { content: "回复 Lin" },
    { content: "检查 mobile H5 兼容性" },
  ],
  confidence: 0.92,
  citations: [],
  generatedAt: "2026-09-21T09:12:00.000Z",
};

export const sampleReplies: AiReplySuggestion[] = [
  { id: "r1", tone: "concise", subject: "Re: Q4 roadmap", body: "好的,周三前给结论。", confidence: 0.9, reason: "简洁直接" },
  { id: "r2", tone: "inquisitive", subject: "Re: Q4 roadmap", body: "在确认之前,能否先告诉我 mobile H5 是哪条路径阻塞?", confidence: 0.78, reason: "先澄清再决策" },
  { id: "r3", tone: "delegate", subject: "Re: Q4 roadmap", body: "我把 mobile H5 这块转交给 @yang,周三前给你结论。", confidence: 0.71, reason: "分派给团队成员" },
];

export const sampleActions: AiAction[] = [
  { id: "a1", kind: "archive", threadId: "t2", confidence: 0.9, reason: "营销邮件" },
  { id: "a2", kind: "mark-read", threadId: "t3", confidence: 0.85, reason: "已处理" },
  { id: "a3", kind: "label", threadId: "t4", confidence: 0.7, label: "重要", reason: "优先级" },
];

export const sampleReceipts: AiActionReceipt[] = [
  { actionId: "a1", threadId: "t2", kind: "archive", status: "executed" },
  { actionId: "a2", threadId: "t3", kind: "mark-read", status: "executed" },
  { actionId: "a3", threadId: "t4", kind: "label", status: "failed", reason: "Gmail 限流" },
];

export function makeSampleRuntime(overrides: Partial<AiInboxRuntime> = {}): AiInboxRuntime {
  return {
    summarize: async (threadId: string) => ({ ...sampleSummary, threadId }),
    suggestReplies: async (threadId: string, count = 3) =>
      sampleReplies.slice(0, count).map((r) => ({ ...r, id: `${threadId}-${r.id}` })),
    plan: async () => sampleActions,
    execute: async () => sampleReceipts,
    undo: async () => undefined,
    routePrompt: async () => sampleActions,
    ...overrides,
  };
}

export const sampleAccounts = [
  { id: "a1", address: "me@openbuddy.ai", name: "Work", status: "connected" as const },
];

export const sampleThreads = [
  {
    id: "t1",
    accountId: "a1",
    subject: "Q4 roadmap 终稿",
    from: { name: "Lin", address: "lin@openbuddy.ai" },
    date: "2026-09-21T09:12:00Z",
    snippet: "Hi,请在周三前确认 Q4 的 mobile H5 兼容方向…",
    unread: true,
    messageCount: 4,
    labels: ["INBOX"],
    aiChips: ["priority", "reply"] as Array<"priority" | "reply" | "action" | "muted">,
  },
  {
    id: "t2",
    accountId: "a1",
    subject: "🎉 GitHub Universe 早鸟票",
    from: { name: "GitHub", address: "noreply@github.com" },
    date: "2026-09-20T12:00:00Z",
    snippet: "Last chance — 早鸟票今天截止。",
    unread: false,
    messageCount: 1,
    labels: ["CATEGORY_PROMOTIONS"],
    aiChips: ["muted"] as Array<"priority" | "reply" | "action" | "muted">,
  },
  {
    id: "t3",
    accountId: "a1",
    subject: "Standup notes 09-21",
    from: { name: "Bob", address: "bob@openbuddy.ai" },
    date: "2026-09-21T08:30:00Z",
    snippet: "今天讨论:H5 兼容性、API 重构、Compose 自动保存",
    unread: true,
    messageCount: 1,
    labels: ["INBOX"],
    aiChips: ["action"] as Array<"priority" | "reply" | "action" | "muted">,
  },
];

export const sampleCounts = {
  today: 1,
  later: 1,
  done: 0,
  inbox: 3,
  drafts: 0,
  scheduled: 0,
  snoozed: 0,
};
