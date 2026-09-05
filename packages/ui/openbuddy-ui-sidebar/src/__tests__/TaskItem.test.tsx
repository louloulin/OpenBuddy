import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskItem, TASK_PHASES, taskPhaseLabel } from "../TaskItem";

describe("TaskItem — 探索/规划/执行 phase tabs (phase 5)", () => {
  const task = {
    id: "t1",
    title: "优化 pi 集成",
    phase: "plan" as const,
    status: "active" as const,
  };

  it("renders the task title and all three phase tabs", () => {
    render(<TaskItem task={task} />);
    expect(screen.getByTestId("task-item-t1")).toBeInTheDocument();
    expect(screen.getByText("优化 pi 集成")).toBeInTheDocument();
    for (const phase of TASK_PHASES) {
      expect(screen.getByTestId(`task-item-phase-t1-${phase.id}`)).toBeInTheDocument();
    }
  });

  it("marks the active phase tab with aria-selected", () => {
    render(<TaskItem task={task} />);
    expect(screen.getByTestId("task-item-phase-t1-plan").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("task-item-phase-t1-explore").getAttribute("aria-selected")).toBeNull();
  });

  it("calls onSelect with the task id on title click", () => {
    const onSelect = vi.fn();
    render(<TaskItem task={task} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("task-item-title-t1"));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("calls onSetPhase with the task id and phase on tab click", () => {
    const onSetPhase = vi.fn();
    render(<TaskItem task={task} onSetPhase={onSetPhase} />);
    fireEvent.click(screen.getByTestId("task-item-phase-t1-execute"));
    expect(onSetPhase).toHaveBeenCalledWith("t1", "execute");
  });

  it("exposes phase labels in order 探索/规划/执行", () => {
    expect(TASK_PHASES.map((p) => p.label)).toEqual(["探索", "规划", "执行"]);
    expect(taskPhaseLabel("explore")).toBe("探索");
    expect(taskPhaseLabel("execute")).toBe("执行");
  });
});
