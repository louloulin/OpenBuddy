import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SubagentPanel } from "@openbuddy/ui-collaboration";
import { useSubagentStore } from "@/stores/subagent-store";
import { useSessionStore } from "@/stores/session-store";
import type { ChatMessage } from "@/stores/session-store";
import type { SubagentLiveEvent } from "@openbuddy/shared-types";
import type { DeepSeekSessionListSnapshot } from "@openbuddy/renderer-host";

const rendererMocks = vi.hoisted(() => {
  let snapshot: DeepSeekSessionListSnapshot = {
    items: [],
    byId: {},
    current: "parent-1",
    state: "idle" as const,
    phase: "ready" as const,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    subagentBreadcrumb: [],
    error: undefined,
  };
  const listeners = new Set<() => void>();
  const open = vi.fn();
  const openSubagent = vi.fn();
  return {
    events: { on: vi.fn(() => () => undefined) },
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      open,
      openSubagent,
    },
    setSnapshot(next: DeepSeekSessionListSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    reset() {
      snapshot = {
        items: [],
        byId: {},
        current: "parent-1",
        state: "idle",
        phase: "ready",
        subagentsByParent: {},
        jobsBySession: {},
        currentAddress: undefined,
        subagentBreadcrumb: [],
        error: undefined,
      };
      open.mockReset();
      openSubagent.mockReset();
      listeners.clear();
    },
  };
});

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  getRendererPluginRuntime: () => ({
    context: { get: (key: string) => key === "sessions" ? rendererMocks.sessions : undefined },
    events: rendererMocks.events,
  }),
}));

function spawnMsg(
  id: string,
  title: string,
  status: "in_progress" | "completed" | "failed",
): ChatMessage {
  return {
    id: "msg-" + id,
    role: "assistant",
    complete: true,
    parts: [
      {
        kind: "tool_call",
        toolCall: {
          toolCallId: id,
          title,
          kind: "spawn_subagent",
          status,
          content: [],
        },
      },
    ],
  };
}

describe("SubagentPanel", () => {
  beforeEach(() => {
    rendererMocks.reset();
    useSubagentStore.setState({ bySession: {} });
    useSessionStore.setState({ sessionId: null });
  });

  it("无 subagent 时不渲染", () => {
    const { container } = render(<SubagentPanel messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("从 spawn_subagent transcript 派生并展示", () => {
    render(<SubagentPanel messages={[spawnMsg("t1", "Spawn subagent: coder", "completed")]} />);
    expect(screen.getByText("子代理")).toBeInTheDocument();
    expect(screen.getByText("coder")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("汇总统计(总数/运行中/完成)", () => {
    render(
      <SubagentPanel
        messages={[
          spawnMsg("t1", "Spawn subagent: a", "completed"),
          spawnMsg("t2", "Spawn subagent: b", "in_progress"),
        ]}
      />,
    );
    expect(screen.getByText(/2 个/)).toBeInTheDocument();
    expect(screen.getByText(/运行中 1/)).toBeInTheDocument();
    expect(screen.getByText(/完成 1/)).toBeInTheDocument();
  });

  it("live store 事件渲染实时进度(轮次/工具/时长)", () => {
    const evt: SubagentLiveEvent = {
      sessionId: "s1",
      phase: "progress",
      subagentId: "sa1",
      childSessionId: "sa1",
      description: "搜索代码库",
      subagentType: "explore",
      status: "running",
      durationMs: 5300,
      turnCount: 3,
      toolCallCount: 7,
      tokensUsed: 12500,
      contextUsagePct: 42,
      toolsUsed: ["read_file", "grep", "run_terminal_command"],
    };
    useSubagentStore.getState().applyEvent(evt);
    useSessionStore.setState({ sessionId: "s1" });

    render(<SubagentPanel messages={[]} />);
    expect(screen.getByText("搜索代码库")).toBeInTheDocument();
    expect(screen.getByText(/3 轮/)).toBeInTheDocument();
    expect(screen.getByText(/7 工具/)).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("live + transcript 合并去重(live 优先)", () => {
    // Same subagent in both live and transcript — live wins.
    useSubagentStore.getState().applyEvent({
      sessionId: "s1",
      phase: "spawned",
      subagentId: "dup1",
      description: "实时子代理",
      status: "running",
    });
    useSessionStore.setState({ sessionId: "s1" });

    render(
      <SubagentPanel
        messages={[
          spawnMsg("dup1", "Spawn subagent: dup1", "in_progress"),
          spawnMsg("t2", "Spawn subagent: other", "completed"),
        ]}
      />,
    );
    // Should show 2 total: live "实时子代理" + transcript "other"
    expect(screen.getByText(/2 个/)).toBeInTheDocument();
    expect(screen.getByText("实时子代理")).toBeInTheDocument();
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  it("失败统计显示", () => {
    render(<SubagentPanel messages={[spawnMsg("t1", "Spawn subagent: x", "failed")]} />);
    expect(screen.getByText(/失败 1/)).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("展示 Harness catalog 并打开子会话", () => {
    rendererMocks.setSnapshot({
      items: [{ sessionId: "parent-1", title: "主任务", cwd: "" }],
      byId: { "parent-1": { sessionId: "parent-1", title: "主任务", cwd: "" }, "child-1": { sessionId: "child-1", title: "代码搜索", cwd: "", parentSessionId: "parent-1", origin: "subagent", subagentMode: "continuable" } },
      current: "parent-1",
      state: "idle",
      phase: "ready",
      subagentsByParent: { "parent-1": { parentAvailable: true, entries: [{ kind: "child", id: "child-1", activity: "inactive", hasChildren: true, mode: "continuable", label: "代码搜索" }] } },
      jobsBySession: {},
      currentAddress: undefined,
      subagentBreadcrumb: [],
      error: undefined,
    });

    const onOpenSession = vi.fn();
    render(<SubagentPanel messages={[]} onOpenSession={onOpenSession} />);
    expect(screen.getByText("代码搜索")).toBeInTheDocument();
    expect(screen.getByText("可继续")).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByRole("button", { name: "代码搜索" })));
    expect(rendererMocks.sessions.openSubagent).toHaveBeenCalledWith({
      parentSessionId: "parent-1",
      childSessionId: "child-1",
      mode: "continuable",
    }, { loadConversation: false });
    expect(onOpenSession).toHaveBeenCalledWith("child-1", "");
  });

  it("展示嵌套 breadcrumb 并支持返回祖先", () => {
    rendererMocks.setSnapshot({
      items: [
        { sessionId: "parent-1", title: "主任务", cwd: "" },
        { sessionId: "child-1", title: "分析代理", cwd: "", parentSessionId: "parent-1", origin: "subagent", subagentMode: "continuable" },
        { sessionId: "child-2", title: "实现代理", cwd: "", parentSessionId: "child-1", origin: "subagent", subagentMode: "one-shot" },
      ],
      byId: {
        "parent-1": { sessionId: "parent-1", title: "主任务", cwd: "" },
        "child-1": { sessionId: "child-1", title: "分析代理", cwd: "", parentSessionId: "parent-1", origin: "subagent", subagentMode: "continuable" },
        "child-2": { sessionId: "child-2", title: "实现代理", cwd: "", parentSessionId: "child-1", origin: "subagent", subagentMode: "one-shot" },
      },
      current: "child-2",
      state: "idle",
      phase: "ready",
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: { parentSessionId: "child-1", childSessionId: "child-2", mode: "one-shot" },
      subagentBreadcrumb: [
        { parentSessionId: "parent-1", childSessionId: "child-1", mode: "continuable" },
        { parentSessionId: "child-1", childSessionId: "child-2", mode: "one-shot" },
      ],
      error: undefined,
    });

    const onOpenSession = vi.fn();
    render(<SubagentPanel messages={[]} onOpenSession={onOpenSession} />);
    expect(screen.getByRole("navigation", { name: "子代理路径" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主会话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析代理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "实现代理" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "分析代理" }));
    expect(rendererMocks.sessions.openSubagent).toHaveBeenCalledWith({
      parentSessionId: "parent-1",
      childSessionId: "child-1",
      mode: "continuable",
    }, { loadConversation: false });
    expect(onOpenSession).toHaveBeenCalledWith("child-1", "");
  });

  it("切回普通会话时不展示旧的 addressed route", () => {
    rendererMocks.setSnapshot({
      items: [{ sessionId: "parent-1", title: "主任务", cwd: "" }, { sessionId: "child-1", title: "旧子代理", cwd: "" }],
      byId: {
        "parent-1": { sessionId: "parent-1", title: "主任务", cwd: "" },
        "child-1": { sessionId: "child-1", title: "旧子代理", cwd: "" },
      },
      current: "child-1",
      state: "idle",
      phase: "ready",
      subagentsByParent: { "parent-1": { parentAvailable: true, entries: [{ kind: "child", id: "child-2", activity: "inactive", hasChildren: false, mode: "one-shot", label: "新子代理" }] } },
      jobsBySession: {},
      currentAddress: { parentSessionId: "parent-1", childSessionId: "child-1", mode: "continuable" },
      subagentBreadcrumb: [{ parentSessionId: "parent-1", childSessionId: "child-1", mode: "continuable" }],
      error: undefined,
    });
    useSessionStore.setState({ sessionId: "parent-1" });

    render(<SubagentPanel messages={[]} />);
    expect(screen.queryByRole("navigation", { name: "子代理路径" })).toBeNull();
    expect(screen.getByText("新子代理")).toBeInTheDocument();
  });
});
