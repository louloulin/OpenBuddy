import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Plan } from "@openbuddy/shared-types";

// vi.mock 工厂被提升,引用的变量必须用 vi.hoisted 声明。
const { mocks } = vi.hoisted(() => ({
  mocks: {
    capturedPlan: null as Plan | null,
    setPlan: (..._a: unknown[]) => {},
    togglePlanMode: (..._a: unknown[]) => {},
  },
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (sel: (s: unknown) => unknown) =>
    sel({
      plan: {
        entries: [
          { content: "步骤一", priority: "high", status: "completed" },
          { content: "步骤二", priority: "medium", status: "in_progress" },
          { content: "步骤三", priority: "low", status: "pending" },
        ],
      },
      planMode: false,
      setPlan: mocks.setPlan,
      setPlanMode: vi.fn(),
    }),
}));

vi.mock("@/lib/agent/pi-client", () => ({ togglePlanMode: mocks.togglePlanMode }));

import { PlanPanel } from "@openbuddy/ui-automation";

// 用真实 vi.fn 绑定到 mocks 上(在 import 之后)。
const setPlan = vi.fn((p: Plan | null) => {
  mocks.capturedPlan = p;
});
const togglePlanMode = vi.fn();
mocks.setPlan = setPlan as unknown as typeof mocks.setPlan;
mocks.togglePlanMode = togglePlanMode as unknown as typeof mocks.togglePlanMode;
const capturedPlan = () => mocks.capturedPlan;

describe("PlanPanel 编辑器(对齐 WorkBuddy plan-editor)", () => {
  beforeEach(() => {
    setPlan.mockClear();
    mocks.capturedPlan = null;
    togglePlanMode.mockClear();
  });

  it("渲染进度与列表", () => {
    render(<PlanPanel sessionId="s1" />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("步骤一")).toBeInTheDocument();
    expect(screen.getByText("步骤三")).toBeInTheDocument();
  });

  it("上移/下移按钮调用 setPlan(reorder)", () => {
    render(<PlanPanel sessionId="s1" />);
    const ups = screen.getAllByRole("button", { name: "上移" });
    const downs = screen.getAllByRole("button", { name: "下移" });
    // 第二条上移 → [二, 一, 三]
    fireEvent.click(ups[1]);
    expect(setPlan).toHaveBeenCalled();
    expect(capturedPlan()!.entries.map((e) => e.content)).toEqual([
      "步骤二",
      "步骤一",
      "步骤三",
    ]);
    // 第一条不能上移(disabled)。
    expect(ups[0]).toBeDisabled();
    // 最后一条不能下移(disabled)。
    expect(downs[2]).toBeDisabled();
  });

  it("点击状态标签循环状态", () => {
    render(<PlanPanel sessionId="s1" />);
    // 第三条状态「待处理」→ 点击 → in_progress
    const statuses = screen.getAllByText("待处理");
    fireEvent.click(statuses[0]);
    expect(capturedPlan()!.entries[2].status).toBe("in_progress");
  });

  it("新增步骤:输入 + Enter 追加 pending 步骤", () => {
    render(<PlanPanel sessionId="s1" />);
    const input = screen.getByPlaceholderText("新增一个步骤…");
    fireEvent.change(input, { target: { value: "步骤四" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(capturedPlan()!.entries).toHaveLength(4);
    expect(capturedPlan()!.entries[3]).toEqual({
      content: "步骤四",
      priority: "medium",
      status: "pending",
    });
  });

  it("新增步骤按钮 disabled 当输入为空", () => {
    render(<PlanPanel sessionId="s1" />);
    expect(screen.getByText("添加").closest("button")).toBeDisabled();
  });

  it("删除按钮调用 setPlan(remove)", () => {
    render(<PlanPanel sessionId="s1" />);
    const dels = screen.getAllByRole("button", { name: "删除此任务" });
    fireEvent.click(dels[0]);
    expect(capturedPlan()!.entries.map((e) => e.content)).toEqual([
      "步骤二",
      "步骤三",
    ]);
  });
});
