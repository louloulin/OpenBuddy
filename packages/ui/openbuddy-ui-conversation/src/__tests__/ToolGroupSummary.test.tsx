/**
 * ToolGroupSummary.test.tsx — Plan5 B.9
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ToolGroupSummary } from "../parts/ToolGroupSummary";
import type { ToolCallView } from "@openbuddy/ui-state/session-store";

function tc(id: string, status: ToolCallView["status"] = "in_progress"): ToolCallView {
  return {
    toolCallId: id,
    title: id,
    kind: "bash",
    status,
    content: [],
    startedAt: 1000,
  };
}

describe("ToolGroupSummary", () => {
  const cluster = {
    kind: "parallel" as const,
    toolCallIds: ["a", "b", "c"],
    toolCalls: [tc("a"), tc("b"), tc("c")],
  };

  it("renders the summary header with tool count", () => {
    const { container } = render(<ToolGroupSummary cluster={cluster} />);
    const summary = container.querySelector('[data-testid="tool-group-summary"]');
    expect(summary).toBeTruthy();
    expect(summary?.getAttribute("data-tool-count")).toBe("3");
    expect(container.textContent).toContain("3 个工具并行");
  });

  it("starts collapsed by default", () => {
    const { container } = render(<ToolGroupSummary cluster={cluster} />);
    expect(container.querySelector(".tool-group-summary__list")).toBeNull();
  });

  it("expands on header click", () => {
    const { container } = render(<ToolGroupSummary cluster={cluster} />);
    fireEvent.click(container.querySelector(".tool-group-summary__header")!);
    const list = container.querySelector(".tool-group-summary__list");
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll(".toolcall").length).toBe(3);
  });

  it("collapses on second header click", () => {
    const { container } = render(<ToolGroupSummary cluster={cluster} />);
    const header = container.querySelector(".tool-group-summary__header")!;
    fireEvent.click(header);
    fireEvent.click(header);
    expect(container.querySelector(".tool-group-summary__list")).toBeNull();
  });

  it("marks done when all tool calls are completed", () => {
    const doneCluster = {
      kind: "parallel" as const,
      toolCallIds: ["a", "b"],
      toolCalls: [tc("a", "completed"), tc("b", "completed")],
    };
    const { container } = render(<ToolGroupSummary cluster={doneCluster} />);
    expect(container.querySelector(".tool-group-summary--done")).toBeTruthy();
  });

  it("shows progress X/Y in the header", () => {
    const partial = {
      kind: "parallel" as const,
      toolCallIds: ["a", "b", "c", "d"],
      toolCalls: [
        tc("a", "completed"),
        tc("b", "completed"),
        tc("c", "in_progress"),
        tc("d", "in_progress"),
      ],
    };
    const { container } = render(<ToolGroupSummary cluster={partial} />);
    expect(container.textContent).toContain("2/4");
  });

  it("truncates long tool list with +N suffix", () => {
    const many = {
      kind: "parallel" as const,
      toolCallIds: ["a", "b", "c", "d", "e"],
      toolCalls: [tc("a"), tc("b"), tc("c"), tc("d"), tc("e")],
    };
    const { container } = render(<ToolGroupSummary cluster={many} />);
    expect(container.textContent).toContain("+2");
  });
});
