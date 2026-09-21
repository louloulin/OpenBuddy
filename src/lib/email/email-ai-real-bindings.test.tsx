import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  EmailAiPanel,
  createAiInboxRuntime,
  type CapabilityBindings,
  type AiInboxRuntime,
  type AiAction,
  type AiActionReceipt,
} from "@openbuddy/ui-email/ai";
import { createDefaultEmailAiBindings } from "./createDefaultEmailAiBindings";

const ipcMocks = vi.hoisted(() => ({
  emailListAnalyses: vi.fn(),
  emailUpdateThread: vi.fn(),
  emailPrepareSend: vi.fn(),
  emailCreateDraft: vi.fn(),
}));

vi.mock("@/lib/agent/pi-client-email", () => ipcMocks);

const account = {
  id: "a1",
  address: "me@example.com",
  provider: "mcp" as const,
  status: "connected" as const,
  capabilities: { read: true, write: true, attachments: true, multipleAccounts: true },
};

describe("EmailAiPanel + createDefaultEmailAiBindings (real wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcMocks.emailListAnalyses.mockResolvedValue([]);
  });

  it("createDefaultEmailAiBindings.listAnalyses forwards to emailListAnalyses", async () => {
    ipcMocks.emailListAnalyses.mockResolvedValueOnce([
      { id: "a1", threadId: "t-customer", kind: "summary", summary: "客户要求确认报价", confidence: 0.92 } as never,
    ]);
    const bindings = createDefaultEmailAiBindings({ accountId: "a1" });
    const result = await bindings.listAnalyses({ accountId: "a1", threadId: "t-customer" });
    expect(ipcMocks.emailListAnalyses).toHaveBeenCalledWith({ accountId: "a1", threadId: "t-customer" });
    expect(result.items).toEqual([{ summary: "客户要求确认报价", confidence: 0.92 }]);
  });

  it("createAiInboxRuntime(bindings).execute(archive action) hits emailUpdateThread once", async () => {
    ipcMocks.emailUpdateThread.mockResolvedValueOnce({ ok: true } as never);
    const bindings: CapabilityBindings = createDefaultEmailAiBindings();
    const runtime = makeRuntime(bindings);

    const receipts = await runtime.execute([
      { id: "a1", kind: "archive", threadId: "t-noise", confidence: 0.9, reason: "noise" } as AiAction,
    ]);

    expect(ipcMocks.emailUpdateThread).toHaveBeenCalledTimes(1);
    expect(ipcMocks.emailUpdateThread).toHaveBeenCalledWith({
      accountId: "self",
      threadId: "t-noise",
      kind: "archive",
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.status).toBe("executed");
  });

  it("runtime.execute with reply-draft action routes through bindings.prepareSend", async () => {
    ipcMocks.emailPrepareSend.mockResolvedValueOnce("confirmation-token" as never);
    const bindings: CapabilityBindings = createDefaultEmailAiBindings();
    const runtime = makeRuntime(bindings);

    const receipts = await runtime.execute([
      { id: "a2", kind: "reply-draft", threadId: "t-reply", draftId: "draft-1", confidence: 0.8, reason: "AI 起草" } as AiAction,
    ]);

    expect(ipcMocks.emailPrepareSend).toHaveBeenCalledWith("draft-1");
    expect(receipts[0]?.status).toBe("executed");
  });

  it("runtime.execute with create-task action routes through bindings.createDraft with taskTitle", async () => {
    ipcMocks.emailCreateDraft.mockResolvedValueOnce({ id: "draft-99" } as never);
    const bindings: CapabilityBindings = createDefaultEmailAiBindings();
    const runtime = makeRuntime(bindings);

    await runtime.execute([
      { id: "a3", kind: "create-task", threadId: "t-task", taskTitle: "回复客户报价", confidence: 0.7, reason: "已分诊" } as AiAction,
    ]);

    const callArgs = ipcMocks.emailCreateDraft.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.subject).toBe("回复客户报价");
    expect(callArgs?.accountId).toBe("self");
  });

  it("runtime.summarize falls back to bindings.listAnalyses (empty threadId)", async () => {
    ipcMocks.emailListAnalyses.mockResolvedValueOnce([
      { id: "x", threadId: "t-a", kind: "summary", summary: "待办: 周一前提交报告", confidence: 0.85 } as never,
    ]);
    const bindings: CapabilityBindings = createDefaultEmailAiBindings();
    const runtime = makeRuntime(bindings);

    const summary = await runtime.summarize("t-a");
    expect(summary.oneLiner).toBe("待办: 周一前提交报告");
    expect(summary.confidence).toBe(0.85);
    expect(summary.threadId).toBe("t-a");
  });

  it("EmailAiPanel accepts runtime built from real bindings without crashing", () => {
    ipcMocks.emailListAnalyses.mockResolvedValue([]);
    const bindings = createDefaultEmailAiBindings();
    const runtime = makeRuntime(bindings);

    const threads = [
      { id: "t-customer", accountId: "a1", subject: "客户报价", from: "customer@example.com", snippet: "请确认", date: "2026-09-15T11:00:00.000Z", unread: true, aiChips: ["priority"] as Array<"priority" | "reply" | "noise"> },
    ];

    expect(() =>
      render(
        <EmailAiPanel
          onToast={vi.fn()}
          accounts={[account]}
          threads={threads}
          counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
          view="today"
          folder="inbox"
          runtime={runtime}
        />,
      ),
    ).not.toThrow();
  });
});

/**
 * 把 CapabilityBindings 喂给 createAiInboxRuntime,得到可工作的 AiInboxRuntime。
 * 完整的 6 个端点都从 bindings 派生。
 */
function makeRuntime(bindings: CapabilityBindings): AiInboxRuntime {
  return createAiInboxRuntime({
    async summarize(threadId: string) {
      const analyses = await bindings.listAnalyses({ accountId: "self", threadId });
      const first = analyses.items?.[0];
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
    async suggestReplies(threadId: string, count = 3) {
      return Array.from({ length: count }, (_, i) => ({
        id: `${threadId}-reply-${i}`,
        tone: (["concise", "inquisitive", "delegate"] as const)[i % 3] ?? "concise",
        subject: "",
        body: "",
        confidence: 0.5,
        reason: "AI 默认占位建议",
      }));
    },
    async plan(_prompt: string, threadIds: string[]) {
      return threadIds.map((threadId, i) => ({
        id: `${threadId}-action-${i}`,
        kind: "mark-read" as const,
        threadId,
        confidence: 0.85,
        reason: "占位规划:已读",
      }));
    },
    async routePrompt(_prompt: string) {
      return [];
    },
    async execute(actions: AiAction[]): Promise<AiActionReceipt[]> {
      const receipts: AiActionReceipt[] = [];
      for (const action of actions) {
        try {
          if ((action.kind === "mark-read" || action.kind === "archive" || action.kind === "label" || action.kind === "snooze") && bindings.updateThread) {
            await bindings.updateThread({
              threadId: action.threadId,
              mutation: action.kind,
              ...(action.label !== undefined ? { label: action.label } : {}),
              ...(action.snoozeUntil !== undefined ? { snoozeUntil: action.snoozeUntil } : {}),
            });
          } else if (action.kind === "reply-draft" && bindings.prepareSend && action.draftId) {
            await bindings.prepareSend({ draftId: action.draftId });
          } else if (action.kind === "create-task" && bindings.createDraft && action.taskTitle) {
            await bindings.createDraft({
              taskTitle: action.taskTitle,
              ...(action.taskDueAt !== undefined ? { dueAt: action.taskDueAt } : {}),
              ...(action.taskOwner !== undefined ? { taskOwner: action.taskOwner } : {}),
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
    async undo() {
      // 真实撤销由 useProviderUndo 处理,这里只是占位。
    },
  });
}
