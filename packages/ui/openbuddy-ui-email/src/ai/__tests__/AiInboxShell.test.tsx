import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiInboxShell } from "../components/AiInboxShell";
import type { AiAction, AiActionReceipt, AiInboxRuntime, AiReplySuggestion, AiThreadSummary } from "../index";
import { telemetryStore } from "../telemetry-store";

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
];

function makeRuntime(overrides: Partial<AiInboxRuntime> = {}): AiInboxRuntime {
  return {
    summarize: vi.fn().mockResolvedValue(summary),
    suggestReplies: vi.fn().mockResolvedValue(replies),
    plan: vi.fn<(prompt: string, threadIds?: string[]) => Promise<AiAction[]>>().mockResolvedValue([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "噪声" },
    ]),
    execute: vi.fn<(accepted: AiAction[]) => Promise<AiActionReceipt[]>>().mockResolvedValue([
      { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
    ]),
    undo: vi.fn().mockResolvedValue(undefined),
    routePrompt: vi.fn<(prompt: string, threadIds?: string[]) => Promise<AiAction[]>>().mockResolvedValue([
      { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "噪声" },
    ]),
    ...overrides,
  };
}

const baseProps = (runtime: AiInboxRuntime) => ({
  accounts: [{ id: "a1", address: "me@openbuddy.ai", name: "Work", status: "connected" as const }],
  accountId: "a1",
  threads: [
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
      aiChips: ["priority", "reply"] as Array<"priority" | "reply" | "action" | "muted">,
    },
  ],
  runtime,
  counts: { today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 },
  selectedThreadId: "t1",
  onSelectAccount: vi.fn(),
  onSelectThread: vi.fn(),
  onOpenComposer: vi.fn(),
  onReceipt: vi.fn(),
});

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiInboxShell", () => {
  it("renders sidebar with AI views and list rows", () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    expect(screen.getAllByText(/Today · 今天要看的/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Q4 roadmap").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Priority/)).toBeTruthy();
  });

  it("auto summarizes selected thread on mount", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    await waitFor(() => expect(runtime.summarize).toHaveBeenCalledWith("t1"));
  });

  it("renders AI summary card content", async () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    await waitFor(() => screen.getByText(/Lin 希望你今天/));
  });

  it("triggers clean inbox via the clean-noise button", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    await waitFor(() => expect(runtime.plan).toHaveBeenCalled());
  });

  it("opens command bar and submits prompt", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 命令/ }));
    const input = screen.getByTestId("ai-command-input");
    fireEvent.change(input, { target: { value: "归档所有 GitHub 通知" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(runtime.routePrompt).toHaveBeenCalledWith("归档所有 GitHub 通知"));
  });

  it("adopt reply suggestion calls onOpenComposer", async () => {
    const runtime = makeRuntime();
    const onOpenComposer = vi.fn();
    render(<AiInboxShell {...baseProps(runtime)} onOpenComposer={onOpenComposer} />);
    await waitFor(() => screen.getByTestId("adopt-reply-1"));
    fireEvent.click(screen.getByTestId("adopt-reply-1"));
    expect(onOpenComposer).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Re", body: "OK" }),
    );
  });

  it("switches rail view via clicks", () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    fireEvent.click(screen.getByRole("button", { name: /Later · 本周再处理/ }));
    const shell = screen.getByRole("main");
    expect(shell.getAttribute("data-view")).toBe("later");
  });
});

  it("renders a checkbox for each row + a hidden batch bar by default", () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    expect(screen.getByTestId("thread-check-t1")).toBeTruthy();
    expect(screen.queryByTestId("batch-clear")).toBeNull();
  });

  it("Ctrl+click toggles multi-selection and shows the batch bar", async () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    const row = screen.getByTestId("thread-row-t1");
    fireEvent.click(row, { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("batch-clear")).toBeTruthy());
    expect(screen.getByText(/已选 1 封/)).toBeTruthy();
  });

  it("plain click clears existing multi-selection", async () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    const row = screen.getByTestId("thread-row-t1");
    fireEvent.click(row, { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("batch-clear")).toBeTruthy());
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId("batch-clear")).toBeNull());
  });

  it("Esc clears the multi-selection", async () => {
    render(<AiInboxShell {...baseProps(makeRuntime())} />);
    fireEvent.click(screen.getByTestId("thread-row-t1"), { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("batch-clear")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("batch-clear")).toBeNull());
  });

  it("batch-plan button routes the current selection to runtime.plan", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    fireEvent.click(screen.getByTestId("thread-row-t1"), { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("batch-plan")).toBeTruthy());
    fireEvent.click(screen.getByTestId("batch-plan"));
    await waitFor(() => expect(runtime.plan).toHaveBeenCalled());
    const callArgs = (runtime.plan as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => Array.isArray(call[1]) && call[1].includes("t1"),
    );
    expect(callArgs?.[1]).toEqual(["t1"]);
    await waitFor(() => expect(screen.queryByTestId("batch-plan")).toBeNull());
  });

  it("'All on multi-select' batch button selects every row", async () => {
    render(
      <AiInboxShell
        {...baseProps(makeRuntime())}
        threads={[
          { ...baseProps(makeRuntime()).threads[0] },
          {
            id: "t2",
            accountId: "a1",
            subject: "B 邮件",
            from: { name: "Bob", address: "bob@openbuddy.ai" },
            date: "2026-09-20T10:00:00Z",
            snippet: "snip",
            unread: true,
            messageCount: 1,
            labels: [],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("thread-row-t1"), { ctrlKey: true });
    await waitFor(() => screen.getByTestId("batch-clear"));
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    await waitFor(() => expect(screen.getByText(/已选 2 封/)).toBeTruthy());
  });

  it("checkbox click does NOT trigger onSelectThread (modifier-only)", async () => {
    const onSelectThread = vi.fn();
    render(<AiInboxShell {...baseProps(makeRuntime())} onSelectThread={onSelectThread} />);
    const checkbox = screen.getByTestId("thread-check-t1");
    fireEvent.click(checkbox);
    expect(onSelectThread).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("batch-clear")).toBeTruthy());
  });

  it("Cmd+A (Ctrl+A) selects all rows", async () => {
    render(
      <AiInboxShell
        {...baseProps(makeRuntime())}
        threads={[
          { ...baseProps(makeRuntime()).threads[0] },
          {
            id: "t2",
            accountId: "a1",
            subject: "B",
            from: { name: "B", address: "b@x.com" },
            date: "2026-09-20T10:00:00Z",
            snippet: "",
            unread: false,
            messageCount: 1,
            labels: [],
          },
        ]}
      />,
    );
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await waitFor(() => expect(screen.getByText(/已选 2 封/)).toBeTruthy());
  });

  it("runs runtime.triage 2s after mount and merges chip into rows", async () => {
    const runtime = makeRuntime({
      triage: vi.fn().mockResolvedValue([
        { threadId: "t1", chips: ["action", "priority"], confidence: 0.9, reason: "需要处理" },
      ]),
    });
    render(<AiInboxShell {...baseProps(runtime)} />);
    expect(runtime.triage).not.toHaveBeenCalled();
    await waitFor(() => expect(runtime.triage).toHaveBeenCalledWith("a1", ["t1"]), { timeout: 4000 });
    // merged chips should now show "行动项" on the row
    await waitFor(() => {
      const chips = document.querySelectorAll(".ai-inbox-shell__row .ai-chip");
      const text = Array.from(chips).map((el) => el.textContent ?? "").join(" ");
      expect(text).toMatch(/行动项/);
    });
  });

  it("ignores runtime when triage is not provided", async () => {
    const runtime = makeRuntime();
    delete (runtime as { triage?: unknown }).triage;
    render(<AiInboxShell {...baseProps(runtime)} />);
    await new Promise((resolve) => setTimeout(resolve, 2300));
    // Should not throw; should not display new chips beyond the original two.
    const chips = document.querySelectorAll(".ai-inbox-shell__row .ai-chip");
    expect(chips.length).toBe(2); // priority + reply from base props
  });

  it("swallows triage failures without crashing the inbox", async () => {
    const runtime = makeRuntime({
      triage: vi.fn().mockRejectedValue(new Error("ai down")),
    });
    render(<AiInboxShell {...baseProps(runtime)} />);
    await waitFor(() => expect(runtime.triage).toHaveBeenCalled(), { timeout: 4000 });
    // No chips added, no errors thrown.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chips = document.querySelectorAll(".ai-inbox-shell__row .ai-chip");
    expect(chips.length).toBe(2);
  });

describe("AiInboxShell + VirtualList (P3-3)", () => {
  function makeBigThread(i: number) {
    return {
      id: `big-${i}`,
      accountId: "a1",
      subject: `Thread ${i}`,
      from: { name: `From ${i}`, address: `from${i}@openbuddy.ai` },
      date: "2026-09-21T09:00:00Z",
      snippet: `Snippet ${i}`,
      unread: i % 2 === 0,
      messageCount: 1,
      labels: [],
    };
  }

  it("does not render every row when there are 10k threads", () => {
    const threads = Array.from({ length: 10_000 }, (_, i) => makeBigThread(i));
    render(
      <AiInboxShell
        {...baseProps(makeRuntime())}
        threads={threads}
        counts={{ today: 10_000, later: 0, done: 0, inbox: 10_000, drafts: 0, scheduled: 0, snoozed: 0 }}
      />,
    );
    // 关键断言:不是 10k 个 row 同时在 DOM 里 — 虚拟化把视口外的不渲染。
    const rows = document.querySelectorAll('[data-testid^="thread-row-"]');
    expect(rows.length).toBeLessThan(threads.length);
    // 实际渲染的数量应远小于总数(jsdom 下默认容器高 600px / itemHeight 72px ≈ 9 行,
    // 加 overscan 6*2 ≈ 21 行,留充足余量)。
    expect(rows.length).toBeLessThan(100);
    // 至少可见首屏的 row。
    expect(rows.length).toBeGreaterThan(0);
    // data-vlist-total 应该正确报告总数。
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("data-vlist-total")).toBe("10000");
  });

  it("scrolling swaps the rendered subset without duplicating rows", () => {
    const threads = Array.from({ length: 200 }, (_, i) => makeBigThread(i));
    const { container } = render(
      <AiInboxShell
        {...baseProps(makeRuntime())}
        threads={threads}
        counts={{ today: 200, later: 0, done: 0, inbox: 200, drafts: 0, scheduled: 0, snoozed: 0 }}
      />,
    );
    const listbox = screen.getByRole("listbox");
    // 模拟滚动到第 100 行(itemHeight=72,scrollTop=7200)
    Object.defineProperty(listbox, "scrollTop", { configurable: true, value: 7200 });
    fireEvent.scroll(listbox);
    const rendered = Array.from(
      container.querySelectorAll('[data-testid^="thread-row-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    // 至少有一个 row 落在滚动后的区间(big-100 ~ big-120 附近)
    expect(rendered.some((id) => id && parseInt(id.replace("thread-row-big-", ""), 10) >= 90)).toBe(true);
  });
});

describe("AiInboxShell telemetry (P3-5)", () => {
  beforeEach(() => telemetryStore.reset());

  it("records triage_shown + triage_merged after runtime.triage resolves", async () => {
    const runtime = makeRuntime({
      triage: vi.fn().mockResolvedValue([
        { threadId: "t1", chips: ["action"], confidence: 0.9, reason: "需要处理" },
      ]),
    });
    render(<AiInboxShell {...baseProps(runtime)} />);
    await waitFor(() => expect(telemetryStore.getState().aggregate.triageShown).toBe(1), {
      timeout: 4000,
    });
    expect(telemetryStore.getState().aggregate.triageMerged).toBe(1);
  });

  it("records command_prompt when command bar submits", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 命令/ }));
    const input = screen.getByTestId("ai-command-input");
    fireEvent.change(input, { target: { value: "归档所有 GitHub 通知" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(telemetryStore.getState().aggregate.commandPrompt).toBe(1),
    );
  });

  it("records multiselect_batch_plan when batch-plan is clicked", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    fireEvent.click(screen.getByTestId("thread-row-t1"), { ctrlKey: true });
    await waitFor(() => screen.getByTestId("batch-plan"));
    fireEvent.click(screen.getByTestId("batch-plan"));
    await waitFor(() =>
      expect(telemetryStore.getState().aggregate.multiselectBatchPlan).toBe(1),
    );
  });

  it("records action_executed after receipts come back successful", async () => {
    const runtime = makeRuntime();
    render(<AiInboxShell {...baseProps(runtime)} />);
    // 触发 plan → 显示 AiActionPlanStrip → 点 "一键执行" → receipts
    fireEvent.click(screen.getByRole("button", { name: /一键清空噪声/ }));
    const acceptBtn = await screen.findByRole("button", { name: /一键执行/ });
    fireEvent.click(acceptBtn);
    await waitFor(() =>
      expect(telemetryStore.getState().aggregate.actionExecuted).toBeGreaterThanOrEqual(1),
    );
  });
});

