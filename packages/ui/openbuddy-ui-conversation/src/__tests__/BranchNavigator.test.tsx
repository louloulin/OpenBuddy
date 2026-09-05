import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BranchNavigator, branchLabel } from "../BranchNavigator";

describe("BranchNavigator — session fork tree (phase 5)", () => {
  const tree = [
    {
      id: "root",
      parentId: null,
      branch: "message",
      summary: "初始问题",
      createdAt: "2026-01-01T00:00:00.000Z",
      children: [
        {
          id: "branch1",
          parentId: "root",
          branch: "branch_summary",
          summary: "被放弃的分支",
          createdAt: "2026-01-01T00:00:01.000Z",
          children: [],
        },
        {
          id: "main",
          parentId: "root",
          branch: "message",
          summary: "主线回答",
          createdAt: "2026-01-01T00:00:02.000Z",
          children: [
            {
              id: "compact1",
              parentId: "main",
              branch: "compaction",
              summary: "上下文压缩",
              createdAt: "2026-01-01T00:00:03.000Z",
              children: [],
            },
          ],
        },
      ],
    },
  ];

  it("renders the tree with all nodes", () => {
    render(<BranchNavigator tree={tree} />);
    expect(screen.getByTestId("branch-navigator")).toBeInTheDocument();
    for (const id of ["root", "branch1", "main", "compact1"]) {
      expect(screen.getByTestId(`branch-node-${id}`)).toBeInTheDocument();
    }
  });

  it("renders nothing for an empty tree", () => {
    const { container } = render(<BranchNavigator tree={[]} />);
    expect(container.querySelector(".branch-navigator")).toBeNull();
  });

  it("marks the active node with aria-selected", () => {
    render(<BranchNavigator tree={tree} activeId="main" />);
    const activeItem = screen.getByTestId("branch-node-main").closest('[role="treeitem"]');
    const inactiveItem = screen.getByTestId("branch-node-root").closest('[role="treeitem"]');
    expect(activeItem?.getAttribute("aria-selected")).toBe("true");
    expect(inactiveItem?.getAttribute("aria-selected")).toBeNull();
  });

  it("calls onSelect with the node id on click", () => {
    const onSelect = vi.fn();
    render(<BranchNavigator tree={tree} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("branch-node-compact1"));
    expect(onSelect).toHaveBeenCalledWith("compact1");
  });

  it("indents child nodes deeper than parents", () => {
    render(<BranchNavigator tree={tree} />);
    const root = screen.getByTestId("branch-node-root");
    const child = screen.getByTestId("branch-node-branch1");
    const rootPad = Number(root.style.paddingLeft.replace("px", ""));
    const childPad = Number(child.style.paddingLeft.replace("px", ""));
    expect(childPad).toBeGreaterThan(rootPad);
  });

  it("maps branch kinds to labels", () => {
    expect(branchLabel("message").label).toBe("消息");
    expect(branchLabel("compaction").label).toBe("压缩");
    expect(branchLabel("branch_summary").label).toBe("分支");
    expect(branchLabel("unknown").label).toBe("unknown");
  });
});
