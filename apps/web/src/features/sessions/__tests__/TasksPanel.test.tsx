import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TasksPanel, formatElapsed } from "../TasksPanel";
import type { RunningTask } from "@openbuddy/protocol/dto";

const { tasksList, taskKill } = vi.hoisted(() => ({ tasksList: vi.fn(), taskKill: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ tasksList, taskKill }));

const task = (patch: Partial<RunningTask> = {}): RunningTask => ({
  id: "s1",
  sessionId: "s1",
  title: "季度报告",
  description: "任务",
  kind: "task",
  status: "running",
  startedAt: Date.now() - 65_000,
  pending: 0,
  ...patch,
});

beforeEach(() => {
  tasksList.mockReset();
  taskKill.mockReset();
});

describe("运行中面板 (pii W4.5)", () => {
  it("shows nothing while no turn is running", async () => {
    tasksList.mockResolvedValue([]);
    const { container } = render(<TasksPanel />);
    await waitFor(() => expect(tasksList).toHaveBeenCalled());
    expect(container.querySelector(".tasks-panel")).toBeNull();
  });

  it("lists automation / subagent rows with elapsed time and pending approvals", async () => {
    tasksList.mockResolvedValue([
      task({ id: "a1", kind: "automation", description: "每日销售摘要", startedAt: Date.now() - 125_000, pending: 1 }),
      task({ id: "c1", kind: "subagent", description: "调研子代理", parentId: "p1", startedAt: Date.now() - 5_000 }),
    ]);
    render(<TasksPanel />);
    await waitFor(() => expect(screen.getByText("每日销售摘要")).toBeInTheDocument());
    expect(screen.getByText("自动化")).toBeInTheDocument();
    expect(screen.getByText("子代理")).toBeInTheDocument();
    expect(screen.getByText(/待确认 1/)).toBeInTheDocument();
    expect(screen.getByText(/2 分 /)).toBeInTheDocument();
    expect(screen.getByLabelText("停止 每日销售摘要")).toBeInTheDocument();
  });

  it("stops a task through task_kill and refreshes the list", async () => {
    tasksList.mockResolvedValueOnce([task({ description: "慢慢跑的回合" })]).mockResolvedValue([]);
    taskKill.mockResolvedValue(undefined);
    const toast = vi.fn();
    render(<TasksPanel onToast={toast} />);
    await waitFor(() => expect(screen.getByText("慢慢跑的回合")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("停止 慢慢跑的回合"));
    await waitFor(() => expect(taskKill).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已停止「慢慢跑的回合」"));
    await waitFor(() => expect(screen.queryByText("慢慢跑的回合")).toBeNull());
  });

  it("formats elapsed time", () => {
    const now = 10_000_000;
    expect(formatElapsed(undefined, now)).toBe("");
    expect(formatElapsed(now - 12_000, now)).toBe("12 秒");
    expect(formatElapsed(now - 125_000, now)).toBe("2 分 5 秒");
    expect(formatElapsed(now - (3700_000), now)).toBe("1 小时 1 分");
  });
});
