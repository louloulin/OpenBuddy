import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiActionPlanStrip } from "../components/AiActionPlanStrip";
import { phaseError, phaseLoading, phaseReady } from "../types";
import type { AiAction, AiActionPlan } from "../types";

const actions: AiAction[] = [
  { id: "a1", kind: "archive", threadId: "t1", confidence: 0.9, reason: "噪声" },
  { id: "a2", kind: "snooze", threadId: "t2", confidence: 0.6, reason: "低优先级", snoozeUntil: "2026-09-30" },
];

const plan: AiActionPlan = {
  id: "p1",
  prompt: "清理噪声",
  createdAt: new Date().toISOString(),
  phase: { status: "idle" },
};

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiActionPlanStrip", () => {
  it("renders nothing when idle and not loading", () => {
    const { container } = render(
      <AiActionPlanStrip
        plan={null}
        decisions={{}}
        planning={{ status: "idle" }}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={vi.fn()}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={vi.fn()}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows loading state when planning in flight", () => {
    render(
      <AiActionPlanStrip
        plan={null}
        decisions={{}}
        planning={phaseLoading()}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={vi.fn()}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={vi.fn()}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    expect(screen.getByText(/AI 正在分析/)).toBeTruthy();
  });

  it("shows error state", () => {
    render(
      <AiActionPlanStrip
        plan={plan}
        decisions={{}}
        planning={phaseError("AI 离线")}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={vi.fn()}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={vi.fn()}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    expect(screen.getByText("AI 分析失败")).toBeTruthy();
  });

  it("renders pending plan with action count", () => {
    render(
      <AiActionPlanStrip
        plan={plan}
        decisions={{ a1: "accepted", a2: "pending" }}
        planning={phaseReady(actions)}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={vi.fn()}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={vi.fn()}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    expect(screen.getByText(/AI 建议 2 个操作/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /一键执行 2/ })).toBeTruthy();
  });

  it("fires onAcceptPlan when 一键执行 button clicked", () => {
    const onAcceptPlan = vi.fn();
    render(
      <AiActionPlanStrip
        plan={plan}
        decisions={{ a1: "accepted", a2: "pending" }}
        planning={phaseReady(actions)}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={onAcceptPlan}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={vi.fn()}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /一键执行/ }));
    expect(onAcceptPlan).toHaveBeenCalled();
  });

  it("fires onBulkDecide(全驳)", () => {
    const onBulkDecide = vi.fn();
    render(
      <AiActionPlanStrip
        plan={plan}
        decisions={{ a1: "accepted", a2: "pending" }}
        planning={phaseReady(actions)}
        accepting={false}
        undoEntry={null}
        onAcceptPlan={vi.fn()}
        onCancelPlan={vi.fn()}
        onToggleDecision={vi.fn()}
        onBulkDecide={onBulkDecide}
        onUndo={vi.fn()}
        onDismissUndo={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "全驳" }));
    expect(onBulkDecide).toHaveBeenCalledWith("rejected");
  });
});
