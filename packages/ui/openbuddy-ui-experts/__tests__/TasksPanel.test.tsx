import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@openbuddy/ui-primitives/icons", () => ({
  TaskListIcon: () => <span data-testid="icon-task" />,
}));

vi.mock("@/stores/sessions-store", () => ({
  useSessionsStore: (selector: (state: { independent: unknown[] }) => unknown) =>
    selector({ independent: [] }),
}));

import { TasksPanel } from "../src/experts/TasksPanel";

beforeEach(() => {
  // Make relativeTime deterministic across runs.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
});

describe("TasksPanel — WorkBuddy v5.4.7 左侧任务栏", () => {
  it("空态显示「还没有任务」", () => {
    render(<TasksPanel title="任务" />);
    expect(screen.getByTestId("tasks-panel")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-empty")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-count")).toHaveTextContent("0");
  });

  it("渲染任务列表 + 时间戳 + 标题里的计数", () => {
    const sessions = [
      {
        sessionId: "s1",
        title: "整理季度报告",
        updatedAt: "2026-09-15T00:00:00Z", // ~2 天前(避开时区差异导致 day=1 → 昨天)
        cwd: "",
      },
      {
        sessionId: "s2",
        title: "市场分析",
        updatedAt: "2026-09-08T00:00:00Z", // ~9 天前 → 走 YYYY/M/D 绝对日期
        cwd: "",
      },
    ];
    render(<TasksPanel sessions={sessions} title="任务" />);
    expect(screen.getByTestId("tasks-count")).toHaveTextContent("2");
    expect(screen.getByTestId("tasks-item-s1")).toHaveTextContent("整理季度报告");
    // 1 天前
    expect(screen.getByTestId("tasks-item-s1").textContent).toMatch(/2\s*天前/);
    // 7 天以上:走绝对日期格式
    expect(screen.getByTestId("tasks-item-s2").textContent).toMatch(/2026\//);
  });

  it("点击任务调用 onSelectSession + 第二个参数传 cwd", () => {
    const sessions = [
      { sessionId: "s1", title: "Test", updatedAt: "2026-09-17T00:00:00Z", cwd: "/tmp/work" },
    ];
    const onSelectSession = vi.fn();
    render(<TasksPanel sessions={sessions} onSelectSession={onSelectSession} />);
    fireEvent.click(screen.getByTestId("tasks-item-s1"));
    expect(onSelectSession).toHaveBeenCalledWith("s1", "/tmp/work");
  });

  it("没有 onSelectSession 时退化为 onToast 提示", () => {
    const sessions = [
      { sessionId: "s1", title: "Fallback", updatedAt: "2026-09-17T00:00:00Z", cwd: "" },
    ];
    const onToast = vi.fn();
    render(<TasksPanel sessions={sessions} onToast={onToast} />);
    fireEvent.click(screen.getByTestId("tasks-item-s1"));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Fallback"));
  });

  it("超过 collapsedLimit 显示「查看更多 (N)」折叠按钮,点击展开", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `Task ${i}`,
      updatedAt: `2026-09-${String(17 - i).padStart(2, "0")}T00:00:00Z`,
      cwd: "",
    }));
    render(<TasksPanel sessions={sessions} collapsedLimit={8} />);
    expect(screen.getByTestId("tasks-show-more")).toHaveTextContent("查看更多 (4)");
    // 默认折叠时只显示前 8 条
    expect(screen.queryByTestId("tasks-item-s11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tasks-show-more"));
    expect(screen.getByTestId("tasks-item-s11")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-show-less")).toBeInTheDocument();
  });

  it("隐藏 archived 会话", () => {
    const sessions = [
      { sessionId: "live", title: "Live", updatedAt: "2026-09-17T00:00:00Z", cwd: "" },
      { sessionId: "arch", title: "Archived", updatedAt: "2026-09-17T00:00:00Z", cwd: "", archived: true },
    ];
    render(<TasksPanel sessions={sessions} />);
    expect(screen.getByTestId("tasks-item-live")).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-item-arch")).not.toBeInTheDocument();
  });
});
