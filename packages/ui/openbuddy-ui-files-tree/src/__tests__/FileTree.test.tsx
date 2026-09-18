import { describe, expect, it, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FileTree } from "../components/FileTree";
import type { TreeNode } from "../lib/tree-utils";

afterEach(() => cleanup());

const SMALL: TreeNode[] = [
  {
    id: "src",
    name: "src",
    path: "/src",
    kind: "dir",
    children: [
      { id: "src/a.ts", name: "a.ts", path: "/src/a.ts", kind: "file" },
      { id: "src/b.ts", name: "b.ts", path: "/src/b.ts", kind: "file" },
    ],
  },
  { id: "readme.md", name: "readme.md", path: "/readme.md", kind: "file" },
];

describe("@openbuddy/ui-files-tree/FileTree", () => {
  it("renders all root rows", () => {
    render(<FileTree nodes={SMALL} />);
    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.getByText("readme.md")).toBeTruthy();
    // Children hidden until expanded.
    expect(screen.queryByText("a.ts")).toBeNull();
  });

  it("expands a folder when the chevron is clicked", () => {
    render(<FileTree nodes={SMALL} />);
    const row = screen.getByText("src").closest("[data-node-id]")!;
    const chevron = within(row as HTMLElement).getByText("▸");
    act(() => {
      fireEvent.click(chevron);
    });
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
  });

  it("calls onOpen on double-click of a file", () => {
    const onOpen = vi.fn();
    render(<FileTree nodes={SMALL} onOpen={onOpen} />);
    act(() => {
      fireEvent.doubleClick(screen.getByText("readme.md"));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("readme.md");
  });

  it("reports selection changes on click", () => {
    const onSelectionChange = vi.fn();
    render(<FileTree nodes={SMALL} onSelectionChange={onSelectionChange} />);
    act(() => {
      fireEvent.click(screen.getByText("readme.md"));
    });
    const last = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...last]).toEqual(["readme.md"]);
  });

  it("toggles selection with Cmd/Ctrl+click", () => {
    const onSelectionChange = vi.fn();
    render(<FileTree nodes={SMALL} onSelectionChange={onSelectionChange} />);
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    act(() => {
      fireEvent.click(screen.getByText("readme.md"), { metaKey: true });
    });
    const last = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...last].sort()).toEqual(["readme.md", "src"]);
  });

  it("fires onSelect after every row click (single-click-to-open hosts)", () => {
    const onSelect = vi.fn();
    render(<FileTree nodes={SMALL} onSelect={onSelect} />);
    act(() => {
      fireEvent.click(screen.getByText("readme.md"));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("readme.md");
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[1][0].id).toBe("src");
  });

  it("Shift+click selects the range from the previous click", () => {
    // 回归:handleRowClick 曾经先写 anchorRef.current 再拿它做 range 起点,
    // 起点永远等于终点,框选退化成单选。
    const onSelectionChange = vi.fn();
    render(<FileTree nodes={SMALL} onSelectionChange={onSelectionChange} />);
    act(() => {
      fireEvent.click(screen.getByText("src"));
    });
    act(() => {
      fireEvent.click(screen.getByText("readme.md"), { shiftKey: true });
    });
    const last = onSelectionChange.mock.calls.at(-1)![0] as Set<string>;
    expect([...last].sort()).toEqual(["readme.md", "src"]);
  });

  it("dragEnabled=false removes the draggable affordance", () => {
    render(<FileTree nodes={SMALL} dragEnabled={false} />);
    const srcRow = screen.getByText("src").closest("[data-node-id]") as HTMLElement;
    expect(srcRow.getAttribute("draggable")).toBe("false");
  });

  it("only renders a window of rows for a huge tree (virtualization)", () => {
    const big: TreeNode[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}.txt`,
      path: `/f${i}.txt`,
      kind: "file" as const,
    }));
    render(<FileTree nodes={big} height={300} />);
    // 300px viewport / 28px rows ≈ 11 + overscan*2 = at most 30 rows mounted.
    const rows = document.querySelectorAll("[data-node-id]");
    expect(rows.length).toBeLessThan(40);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no nodes", () => {
    render(<FileTree nodes={[]} emptyLabel="空空如也" />);
    expect(screen.getByText("空空如也")).toBeTruthy();
  });

  it("does not fire onMove when dropping a folder onto a file", () => {
    const onMove = vi.fn();
    render(<FileTree nodes={SMALL} onMove={onMove} />);
    const srcRow = screen.getByText("src").closest("[data-node-id]")!;
    const fileRow = screen.getByText("readme.md").closest("[data-node-id]")!;
    act(() => {
      fireEvent.dragStart(srcRow);
      fireEvent.dragOver(fileRow);
      fireEvent.drop(fileRow);
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("fires onMove when dropping a folder onto another folder", () => {
    const nested: TreeNode[] = [
      {
        id: "a",
        name: "a",
        path: "/a",
        kind: "dir",
        children: [],
      },
      {
        id: "b",
        name: "b",
        path: "/b",
        kind: "dir",
        children: [],
      },
    ];
    const onMove = vi.fn();
    render(<FileTree nodes={nested} onMove={onMove} />);
    const aRow = screen.getByText("a").closest("[data-node-id]")!;
    const bRow = screen.getByText("b").closest("[data-node-id]")!;
    act(() => {
      fireEvent.dragStart(aRow);
      fireEvent.dragOver(bRow);
      fireEvent.drop(bRow);
    });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].id).toBe("a");
    expect(onMove.mock.calls[0][1].id).toBe("b");
  });
});
