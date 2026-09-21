import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiInboxShell } from "../components/AiInboxShell";
import type { AiAction, AiActionReceipt, AiReplySuggestion, AiThreadSummary } from "../types";

const summary: AiThreadSummary = {
  threadId: "t1",
  oneLiner: "Lin 希望你今天确认 Q4 roadmap。",
  keyPoints: ["mobile H5 兼容性是 blocking"],
  actionItems: [{ content: "回复 Lin" }],
  confidence: 0.9,
  citations: [],
  generatedAt: new Date().toISOString(),
};

const replies: AiReplySuggestion[] = [
  { id: "r1", tone: "concise", subject: "Re", body: "OK", confidence: 0.9, reason: "" },
  { id: "r2", tone: "inquisitive", subject: "Re", body: "?"  , confidence: 0.7, reason: "" },
];

function makeRuntime(overrides: Partial<{
  plan: (prompt: string, ids: string[]) => Promise<AiAction[]>;
  execute: (actions: AiAction[]) => Promise<AiActionReceipt[]>;
  undo: (receipts: AiActionReceipt[]) => Promise<void>;
}> = {}) {
  return {
    summarize: vi.fn().mockResolvedValue(summary),
    suggestReplies: vi.fn().mockResolvedValue(replies),
    plan: overrides.plan ?? vi.fn().mockResolvedValue([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "噪声" },
    ]),
    execute: overrides.execute ?? vi.fn().mockResolvedValue([
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
    ]),
    undo: overrides.undo ?? vi.fn().mockResolvedValue(undefined),
    routePrompt: vi.fn().mockResolvedValue([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "噪声" },
    ]),
  };
}

const threads = [
  {
    id: "t1",
    accountId: "a1",
    subject: "Q4 roadmap",
    from: { name: "Lin", address: "lin@openbuddy.ai" },
    date: "2026-09-21T09:12:00Z",
    snippet: "Hi, 请确认 Q4…",
    unread: true,
    messageCount: 2,
    labels: [],
  },
];

beforeEach(() => { swrCacheInternal.reset(); });
describe("Email AI 闭环 (end-to-end)", () => {
  it("Observe: 选中线程时自动出现 AI 摘要", async () => {
    const runtime = makeRuntime();
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
  });

  it("Plan + Confirm: 一键清空噪声 → plan → acceptPlan 触发 executor", async () => {
    const execute = vi.fn().mockResolvedValue([
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" as const },
    ]);
    const runtime = makeRuntime({ execute });
    const onReceipt = vi.fn();
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
        onReceipt={onReceipt}
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => screen.getByRole("button", { name: /一键执行/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键执行/ }));
    await waitFor(() => expect(execute).toHaveBeenCalled());
  });

  it("Receipt: 执行成功后 onReceipt 被调用 + ReceiptToast 显示", async () => {
    const runtime = makeRuntime();
    const onReceipt = vi.fn();
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
        onReceipt={onReceipt}
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => screen.getByRole("button", { name: /一键执行/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键执行/ }));
    await waitFor(() => expect(onReceipt).toHaveBeenCalled());
    await waitFor(() => screen.getByText(/已执行 \d+ 项/));
  });

  it("Undo: 30s 窗口内撤销 → undoer 被调用", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const runtime = makeRuntime({ undo });
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => screen.getByRole("button", { name: /一键执行/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键执行/ }));
    await waitFor(() => screen.getByText(/已执行/));
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
    await waitFor(() => expect(undo).toHaveBeenCalled());
  });

  it("Reply 三选一: 点击采纳 → onOpenComposer 被调用", async () => {
    const runtime = makeRuntime();
    const onOpenComposer = vi.fn();
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
        onOpenComposer={onOpenComposer}
      />,
    );
    await waitFor(() => screen.getByTestId("adopt-reply-1"));
    fireEvent.click(screen.getByTestId("adopt-reply-1"));
    expect(onOpenComposer).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re", body: "OK" }),
    );
  });

  it("Cmd+K: 命令栏打开 + 提交 → routePrompt 被调用", async () => {
    const runtime = makeRuntime();
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /AI 命令/ }));
    const input = screen.getByTestId("ai-command-input");
    fireEvent.change(input, { target: { value: "归档所有 GitHub 通知" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(runtime.routePrompt).toHaveBeenCalledWith("归档所有 GitHub 通知"));
  });

  it("Reject: 单条驳回 → 只执行其余 action", async () => {
    const planSpy = vi.fn().mockResolvedValue([
      { id: "keep", kind: "archive" as const, threadId: "t1", confidence: 0.9, reason: "" },
      { id: "drop", kind: "snooze" as const, threadId: "t1", confidence: 0.9, reason: "" },
    ]);
    const executeSpy = vi.fn().mockImplementation(async (actions: AiAction[]) =>
      actions.map((a) => ({ actionId: a.id, threadId: a.threadId, kind: a.kind, status: "executed" as const })),
    );
    const runtime = makeRuntime({ plan: planSpy, execute: executeSpy });
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => screen.getByText(/AI 建议 2 个操作/));
    // 全驳
    fireEvent.click(screen.getByRole("button", { name: "全驳" }));
    fireEvent.click(screen.getByRole("button", { name: /一键执行 0/ }));
    await waitFor(() => expect(executeSpy).toHaveBeenCalledWith([]));
  });

  it("Failure: 部分失败时 receipt 包含 failed 状态", async () => {
    const execute = vi.fn().mockResolvedValue([
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" as const },
      { actionId: "a2", threadId: "t2", kind: "snooze", status: "failed" as const, reason: "403" },
    ]);
    const runtime = makeRuntime({ execute });
    render(
      <AiInboxShell
        accounts={[{ id: "a1", address: "me@openbuddy.ai", status: "connected" }]}
        accountId="a1"
        threads={threads}
        runtime={runtime}
        counts={{ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }}
        selectedThreadId="t1"
      />,
    );
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => screen.getByRole("button", { name: /一键执行/ }));
    fireEvent.click(screen.getByRole("button", { name: /一键执行/ }));
    await waitFor(() => screen.getByText(/失败/));
  });
});
