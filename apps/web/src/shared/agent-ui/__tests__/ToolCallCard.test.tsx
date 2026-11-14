import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCallView } from "@/features/chat/state/session-store";

const base: ToolCallView = {
  toolCallId: "tc1",
  title: "edit",
  kind: "edit",
  status: "completed",
  content: [],
  rawInput: { path: "/work/proj/src/hello.txt" },
  details: { patch: "@@ -1,2 +1,2 @@\n-old line\n+new line\n context" },
  durationMs: 1500,
};

describe("ToolCallCard", () => {
  it("renders one row: plain label, workspace-relative path, diff stats and time; opens detail on click", () => {
    const onOpen = vi.fn();
    render(<ToolCallCard tc={base} cwd="/work/proj" onOpen={onOpen} />);
    expect(screen.getByText("编辑文件")).toBeInTheDocument();
    expect(screen.getByText("src/hello.txt")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByText("2s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it("summarises a command by its first line", () => {
    render(<ToolCallCard tc={{ ...base, kind: "bash", title: "bash", details: undefined, rawInput: { command: "npm test\necho done" } }} />);
    expect(screen.getByText("执行命令")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("names MCP tools by server and tool, and falls back to the first string argument", () => {
    render(<ToolCallCard tc={{ ...base, kind: "mcp__github__create_issue", title: "mcp__github__create_issue", details: undefined, rawInput: { title: "Bug: crash" } }} />);
    expect(screen.getByText("github · create_issue")).toBeInTheDocument();
    expect(screen.getByText("Bug: crash")).toBeInTheDocument();
  });

  it("shows a spinner and the last output line while running, and a failure mark when failed", () => {
    const { rerender, container } = render(
      <ToolCallCard tc={{ ...base, kind: "bash", status: "in_progress", details: undefined, rawInput: { command: "make" }, content: [{ type: "text", text: "step 1\nstep 2" }] }} />,
    );
    expect(container.querySelector(".toolrow__spinner")).not.toBeNull();
    expect(screen.getByText("step 2")).toBeInTheDocument();
    rerender(<ToolCallCard tc={{ ...base, kind: "bash", status: "failed", details: undefined, rawInput: { command: "make" } }} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(/失败/);
  });
});
