import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkflowCanvas, workflowStepLabel } from "../WorkflowCanvas";

describe("WorkflowCanvas — visual workflow editor (phase 5)", () => {
  const steps = [
    { id: "s1", title: "每日触发", kind: "trigger" as const },
    { id: "s2", title: "读取邮件", kind: "action" as const },
    { id: "s3", title: "生成简报", kind: "output" as const },
  ];

  it("renders nothing when there are no steps", () => {
    const { container } = render(<WorkflowCanvas steps={[]} />);
    expect(container.querySelector(".workflow-canvas")).toBeNull();
  });

  it("renders all steps with kind labels", () => {
    render(<WorkflowCanvas steps={steps} />);
    expect(screen.getByTestId("workflow-canvas")).toBeInTheDocument();
    for (const s of steps) {
      expect(screen.getByTestId(`workflow-node-${s.id}`)).toBeInTheDocument();
    }
    expect(screen.getByText("触发")).toBeInTheDocument();
    expect(screen.getByText("动作")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();
  });

  it("marks the active node", () => {
    render(<WorkflowCanvas steps={steps} activeId="s2" />);
    expect(screen.getByTestId("workflow-node-s2").className).toContain("--active");
    expect(screen.getByTestId("workflow-node-s1").className).not.toContain("--active");
  });

  it("calls onSelect with the step id on node click", () => {
    const onSelect = vi.fn();
    render(<WorkflowCanvas steps={steps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("workflow-node-s2").querySelector("button")!);
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("calls onMove with direction and disables boundary moves", () => {
    const onMove = vi.fn();
    render(<WorkflowCanvas steps={steps} onMove={onMove} />);
    // First step: up disabled, down enabled.
    expect(screen.getByTestId("workflow-move-up-s1").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("workflow-move-down-s1").hasAttribute("disabled")).toBe(false);
    // Last step: down disabled.
    expect(screen.getByTestId("workflow-move-down-s3").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTestId("workflow-move-down-s1"));
    expect(onMove).toHaveBeenCalledWith("s1", "down");
    fireEvent.click(screen.getByTestId("workflow-move-up-s2"));
    expect(onMove).toHaveBeenCalledWith("s2", "up");
  });

  it("maps step kinds to labels", () => {
    expect(workflowStepLabel("trigger")).toBe("触发");
    expect(workflowStepLabel("action")).toBe("动作");
    expect(workflowStepLabel("condition")).toBe("条件");
    expect(workflowStepLabel("output")).toBe("输出");
  });
});
