import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Plan } from "@openbuddy/protocol/dto";
import type { PlanItem } from "@openbuddy/protocol/plan";
import { PlanEditor, PlanPanel } from "../PlanPanel";
import { usePlanStore } from "../state/plan-store";

const items: PlanItem[] = [
  { id: 1, text: "收集数据", status: "done", note: "24 行" },
  { id: 2, text: "清洗数据", status: "in_progress" },
  { id: 3, text: "写报告", status: "pending" },
];
const setPlan = (sessionId: string, next: PlanItem[]) => act(() => usePlanStore.getState().apply({ sessionId, items: next }));

describe("PlanPanel (agent://plan, pii W3.2)", () => {
  beforeEach(() => usePlanStore.setState({ plans: {} }));

  it("renders nothing without a plan, and only the action bar for a plain-text plan in 想一想", () => {
    const { container, rerender } = render(<PlanPanel sessionId="s1" />);
    expect(container).toBeEmptyDOMElement();
    const execute = vi.fn();
    rerender(<PlanPanel sessionId="s1" ready onExecute={execute} />);
    fireEvent.click(screen.getByRole("button", { name: "按此计划执行" }));
    expect(execute).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "任务计划" })).toBeNull();
  });

  it("shows the session's steps with status and progress, and collapses to the current step", () => {
    setPlan("other", [{ id: 1, text: "别的任务", status: "pending" }]);
    setPlan("s1", items);
    render(<PlanPanel sessionId="s1" running />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "计划进度" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("第 1 步 已完成：收集数据")).toBeInTheDocument();
    expect(screen.getByText("24 行")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 步 进行中：清洗数据")).toBeInTheDocument();
    expect(screen.queryByText("别的任务")).toBeNull();
    // No editing while a turn runs.
    expect(screen.queryByRole("button", { name: "编辑步骤" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /收起任务计划/ }));
    expect(screen.queryByText("写报告")).toBeNull();
    expect(screen.getByText("正在：清洗数据")).toBeInTheDocument();
  });

  it("follows plan updates and folds itself once every step is done", () => {
    setPlan("s1", items);
    render(<PlanPanel sessionId="s1" />);
    setPlan("s1", items.map((i) => ({ ...i, status: "done" as const })));
    expect(screen.getByText("计划已完成")).toBeInTheDocument();
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.queryByText("写报告")).toBeNull();
  });

  it("修改计划… puts the numbered plan into the composer and hides the bar", () => {
    setPlan("s1", items.map((i) => ({ ...i, status: "pending" as const, note: undefined })));
    const modify = vi.fn();
    const dismiss = vi.fn();
    render(<PlanPanel sessionId="s1" ready onModify={modify} onDismiss={dismiss} />);
    expect(screen.getByText(/计划共 3 步/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改计划…" }));
    expect(dismiss).toHaveBeenCalled();
    expect(modify.mock.calls[0][0]).toContain("1. 收集数据\n2. 清洗数据\n3. 写报告");
  });

  it("编辑步骤 opens the step editor on a draft and sends the edited plan to the composer", () => {
    setPlan("s1", items);
    const modify = vi.fn();
    render(<PlanPanel sessionId="s1" onModify={modify} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑步骤" }));
    fireEvent.click(screen.getAllByRole("button", { name: "删除此任务" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "放入输入框" }));
    expect(modify.mock.calls[0][0]).toContain("1. 清洗数据\n2. 写报告");
    expect(modify.mock.calls[0][0]).toContain("ob_todo");
    // Back to the live plan, which the editor never changed.
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });
});

const plan: Plan = {
  entries: [
    { content: "步骤一", priority: "high", status: "completed" },
    { content: "步骤二", priority: "medium", status: "in_progress" },
    { content: "步骤三", priority: "low", status: "pending" },
  ],
};

describe("PlanEditor 编辑器(对齐 WorkBuddy plan-editor)", () => {
  const submit = vi.fn();
  const editor = () => render(<PlanEditor initial={plan} onCancel={vi.fn()} onSubmit={submit} />);
  const submitted = () => { fireEvent.click(screen.getByRole("button", { name: "放入输入框" })); return submit.mock.calls.at(-1)![0] as Plan; };
  beforeEach(() => submit.mockClear());

  it("渲染步骤数与列表", () => {
    editor();
    expect(screen.getByText("3 步")).toBeInTheDocument();
    expect(screen.getByText("步骤一")).toBeInTheDocument();
    expect(screen.getByText("步骤三")).toBeInTheDocument();
  });

  it("上移/下移按钮重排草稿", () => {
    editor();
    const ups = screen.getAllByRole("button", { name: "上移" });
    const downs = screen.getAllByRole("button", { name: "下移" });
    fireEvent.click(ups[1]);
    expect(ups[0]).toBeDisabled();
    expect(downs[2]).toBeDisabled();
    expect(submitted().entries.map((e) => e.content)).toEqual(["步骤二", "步骤一", "步骤三"]);
  });

  it("点击状态标签循环状态", () => {
    editor();
    fireEvent.click(screen.getAllByText("待处理")[0]);
    expect(submitted().entries[2].status).toBe("in_progress");
  });

  it("新增步骤:输入 + Enter 追加 pending 步骤", () => {
    editor();
    const input = screen.getByPlaceholderText("新增一个步骤…");
    fireEvent.change(input, { target: { value: "步骤四" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submitted().entries[3]).toEqual({ content: "步骤四", priority: "medium", status: "pending" });
  });

  it("新增步骤按钮 disabled 当输入为空", () => {
    editor();
    expect(screen.getByText("添加").closest("button")).toBeDisabled();
  });

  it("删除按钮从草稿移除步骤", () => {
    editor();
    fireEvent.click(screen.getAllByRole("button", { name: "删除此任务" })[0]);
    expect(submitted().entries.map((e) => e.content)).toEqual(["步骤二", "步骤三"]);
  });
});
