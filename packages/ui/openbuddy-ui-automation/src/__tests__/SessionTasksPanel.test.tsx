/**
 * SessionTasksPanel — 阶段 1.3「任务三态」的组件测试。
 *
 * 关键用例全部围绕"按钮必须真的调用后端"展开:这个面板存在的意义就是把
 * 2026-10-11 之前那组 `async () => null` 空桩变成可验证的写路径。每个断言
 * 都能被 mutation 杀死 —— 把 handler 改回返回 null 的空桩,这里的写入断言
 * 会立刻失败。
 */
import { describe, test, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionTasksPanel } from "../SessionTasksPanel";

const mocks = vi.hoisted(() => ({
  tasksListForSession: vi.fn(),
  tasksAddForSession: vi.fn(),
  tasksUpdateForSession: vi.fn(),
  tasksDeleteForSession: vi.fn(),
  tasksClearCompleted: vi.fn(),
}));

vi.mock("@/lib/agent/pi-client", () => mocks);

// 词表合并:面板文案走 useT("tasks.*"),这里把真实词表灌进 locale 单例,
// 同时验证词典里的 key 确实能在运行时解析(缺 key 会渲染成 key 原文)。
beforeAll(async () => {
  const [{ getOrCreateLocaleService }, zhCN, enUS] = await Promise.all([
    import("@openbuddy/ui-locale/client"),
    import("../../../../../src/locales/zh-CN.json"),
    import("../../../../../src/locales/en-US.json"),
  ]);
  const locale = getOrCreateLocaleService();
  locale.merge("zh-CN", zhCN.default as Record<string, unknown>);
  locale.merge("en-US", enUS.default as Record<string, unknown>);
});

const TASK = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "t1",
  content: "跟进报价",
  status: "pending",
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
  order: 0,
  ...overrides,
});

describe("SessionTasksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tasksListForSession.mockResolvedValue([]);
    mocks.tasksAddForSession.mockResolvedValue({ id: "new-1" });
    mocks.tasksUpdateForSession.mockResolvedValue({ id: "t1" });
    mocks.tasksDeleteForSession.mockResolvedValue(undefined);
    mocks.tasksClearCompleted.mockResolvedValue(undefined);
  });

  test("renders tri-state tasks from the backend", async () => {
    mocks.tasksListForSession.mockResolvedValue([
      TASK({ id: "t1", status: "pending" }),
      TASK({ id: "t2", content: "发合同", status: "in_progress" }),
      TASK({ id: "t3", content: "签收", status: "completed" }),
    ]);
    render(<SessionTasksPanel sessionId="session-1" />);
    expect(await screen.findByText("跟进报价")).toBeInTheDocument();
    expect(screen.getByText("发合同")).toBeInTheDocument();
    expect(screen.getByText("签收")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    // 三态芯片都出现
    expect(screen.getAllByTitle(/状态：.+，点击切换/).length).toBe(3);
  });

  test("add writes through tasks:add and reloads", async () => {
    mocks.tasksListForSession.mockResolvedValue([]);
    render(<SessionTasksPanel sessionId="session-1" />);
    fireEvent.change(await screen.findByPlaceholderText("新增一个任务…"), {
      target: { value: "准备投标材料" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => {
      expect(mocks.tasksAddForSession).toHaveBeenCalledWith("session-1", "准备投标材料");
    });
    // 写后端之后必须刷新列表,否则"看起来加了"但界面不变
    await waitFor(() => {
      expect(mocks.tasksListForSession).toHaveBeenCalledTimes(2);
    });
  });

  test("clicking the status chip cycles pending → in_progress on the backend", async () => {
    mocks.tasksListForSession.mockResolvedValue([TASK({ id: "t1", status: "pending" })]);
    render(<SessionTasksPanel sessionId="session-1" />);
    const chip = await screen.findByLabelText(/任务「跟进报价」状态：待处理/);
    fireEvent.click(chip);
    await waitFor(() => {
      expect(mocks.tasksUpdateForSession).toHaveBeenCalledWith("session-1", "t1", {
        status: "in_progress",
      });
    });
  });

  test("completed tasks cycle back to pending", async () => {
    mocks.tasksListForSession.mockResolvedValue([TASK({ id: "t3", status: "completed" })]);
    render(<SessionTasksPanel sessionId="session-1" />);
    fireEvent.click(await screen.findByLabelText(/状态：已完成/));
    await waitFor(() => {
      expect(mocks.tasksUpdateForSession).toHaveBeenCalledWith("session-1", "t3", {
        status: "pending",
      });
    });
  });

  test("delete writes through tasks:delete", async () => {
    mocks.tasksListForSession.mockResolvedValue([TASK({ id: "t1" })]);
    render(<SessionTasksPanel sessionId="session-1" />);
    fireEvent.click(await screen.findByLabelText(/删除任务「跟进报价」/));
    await waitFor(() => {
      expect(mocks.tasksDeleteForSession).toHaveBeenCalledWith("session-1", "t1");
    });
  });

  test("clear-completed only appears with completed tasks and calls the backend", async () => {
    mocks.tasksListForSession.mockResolvedValue([TASK({ id: "t3", status: "completed" })]);
    render(<SessionTasksPanel sessionId="session-1" />);
    const clear = await screen.findByRole("button", { name: "清除已完成" });
    fireEvent.click(clear);
    await waitFor(() => {
      expect(mocks.tasksClearCompleted).toHaveBeenCalledWith("session-1");
    });
  });

  test("clear-completed is hidden when nothing is completed", async () => {
    mocks.tasksListForSession.mockResolvedValue([TASK({ id: "t1", status: "pending" })]);
    render(<SessionTasksPanel sessionId="session-1" />);
    await screen.findByText("跟进报价");
    expect(screen.queryByRole("button", { name: "清除已完成" })).toBeNull();
  });

  test("without a session the panel shows the empty state and never hits the backend", () => {
    render(<SessionTasksPanel />);
    expect(screen.getByText("当前没有打开的会话")).toBeInTheDocument();
    expect(mocks.tasksListForSession).not.toHaveBeenCalled();
  });
});
