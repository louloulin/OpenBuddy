import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { TaskOverview } from "../TaskOverview";
import { usePlanStore } from "@/features/chat/state/plan-store";
import { useSessionStore, type ChatMessage } from "@/features/chat/state/session-store";
import { useArtifactsStore } from "@/features/workbench/state/artifacts-store";
import { onTaskOverview } from "@/features/chat/task-overview-bus";
import { ToolCallCard } from "@/shared/agent-ui/ToolCallCard";

const artifact = (path: string, status: "created" | "modified") => ({ path, status, toolCallIds: [], added: 3, removed: 1, firstAt: 1, lastAt: 2, exists: true });
const messages: ChatMessage[] = [
  { id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "生成季度报告" }], meta: { timestamp: 1000 } },
  { id: "a1", role: "assistant", complete: true, parts: [{ kind: "text", text: "好" }], meta: { timestamp: 1200, endedAt: 13000 } },
];

const commandMessages: ChatMessage[] = [
  ...messages,
  {
    id: "a2",
    role: "assistant",
    complete: true,
    parts: [{
      kind: "tool_call",
      contentIndex: 0,
      toolCall: {
        toolCallId: "t-cmd-1",
        title: "run_terminal_command",
        kind: "run_terminal_command",
        status: "completed",
        durationMs: 1200,
        content: [{ type: "command_output", command: "npm test", output: "PASS unit\n2 files passed", exitCode: 0 }],
      },
    }],
  },
];

describe("任务概览 (pii W3.3)", () => {
  beforeEach(() => {
    usePlanStore.setState({ plans: {} });
    useArtifactsStore.setState({ bySession: {} });
    useSessionStore.setState({ sessionId: "s1", messages: [], streaming: false });
  });

  it("stays hidden for an empty task", () => {
    const { container } = render(<TaskOverview sessionId="s1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 步骤 x/y · 产物 n and a popover with progress, artifacts and turns", () => {
    useSessionStore.setState({ messages });
    useArtifactsStore.setState({ bySession: { s1: { list: [artifact("/w/docs/report.md", "created"), artifact("/w/site/index.html", "modified")], version: 1 } } });
    act(() => usePlanStore.getState().apply({ sessionId: "s1", items: [{ id: 1, text: "收集数据", status: "done" }, { id: 2, text: "写报告", status: "in_progress" }, { id: 3, text: "复核", status: "pending" }] }));
    render(<TaskOverview sessionId="s1" />);
    const button = screen.getByRole("button", { name: "任务概览" });
    expect(button).toHaveTextContent("步骤 1/3 · 产物 2");
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "任务概览" });
    expect(dialog).toHaveTextContent("任务进度");
    expect(dialog).toHaveTextContent("写报告");
    expect(dialog).toHaveTextContent("report.md");
    expect(dialog).toHaveTextContent("修改 +3 −1");
    expect(dialog).toHaveTextContent("任务进程 · 1 轮");
    expect(dialog).toHaveTextContent("完成 · 12s");

    const picked = vi.fn();
    const off = onTaskOverview(picked);
    fireEvent.click(screen.getByRole("button", { name: /report\.md/ }));
    expect(picked).toHaveBeenLastCalledWith({ path: "/w/docs/report.md" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /生成季度报告/ }));
    expect(picked).toHaveBeenLastCalledWith({ messageId: "u1" });
    off();
  });
});

describe("ob_todo transcript row (pii W3.2)", () => {
  it("任务概览可折叠查看后台命令输出", () => {
    useSessionStore.setState({ messages: commandMessages });
    render(<TaskOverview sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "任务概览" }));
    expect(screen.getByText("命令输出 · 1")).toBeInTheDocument();
    const summary = screen.getByText("npm test");
    expect(summary).toBeInTheDocument();
    const details = summary.closest("details");
    expect(details?.open).toBe(false);

    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(screen.getByText(/PASS unit/)).toBeInTheDocument();
  });

  it("shows the step change and the plan progress instead of raw arguments", () => {
    render(<ToolCallCard tc={{
      toolCallId: "t1", title: "ob_todo", kind: "ob_todo", status: "completed", content: [{ type: "text", text: "#1 已完成。" }],
      rawInput: { action: "complete", id: 1 },
      details: { action: "complete", items: [{ id: 1, text: "收集数据", status: "done" }, { id: 2, text: "写报告", status: "pending" }], nextId: 3, changed: [1] },
    }} />);
    expect(screen.getByText("更新计划")).toBeInTheDocument();
    expect(screen.getByText("完成 #1 收集数据")).toBeInTheDocument();
    expect(screen.getByLabelText("计划进度 1/2")).toHaveTextContent("1/2");
    expect(screen.queryByText(/"action"/)).toBeNull();
  });
});
