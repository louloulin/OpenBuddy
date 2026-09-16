import { describe, expect, it } from "vitest";
import {
  flattenTree,
  findNode,
  collectSubtreeIds,
  ancestorsOf,
  rangeSelect,
  canDrop,
  sortNodes,
  sortTree,
  moveNode,
  type TreeNode,
} from "../lib/tree-utils";

const TREE: TreeNode[] = [
  {
    id: "src",
    name: "src",
    path: "/src",
    kind: "dir",
    children: [
      { id: "src/a.ts", name: "a.ts", path: "/src/a.ts", kind: "file" },
      {
        id: "src/sub",
        name: "sub",
        path: "/src/sub",
        kind: "dir",
        children: [
          { id: "src/sub/b.ts", name: "b.ts", path: "/src/sub/b.ts", kind: "file" },
        ],
      },
    ],
  },
  {
    id: "docs",
    name: "docs",
    path: "/docs",
    kind: "dir",
    children: [
      { id: "docs/readme.md", name: "readme.md", path: "/docs/readme.md", kind: "file" },
    ],
  },
  { id: "root.txt", name: "root.txt", path: "/root.txt", kind: "file" },
];

describe("flattenTree", () => {
  it("returns only roots when nothing is expanded", () => {
    const flat = flattenTree(TREE, new Set());
    expect(flat.map((f) => f.node.id)).toEqual(["src", "docs", "root.txt"]);
    expect(flat.map((f) => f.depth)).toEqual([0, 0, 0]);
  });

  it("descends into expanded directories with correct depth", () => {
    const flat = flattenTree(TREE, new Set(["src"]));
    expect(flat.map((f) => f.node.id)).toEqual([
      "src",
      "src/a.ts",
      "src/sub",
      "docs",
      "root.txt",
    ]);
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 1, 0, 0]);
  });

  it("handles nested expansions", () => {
    const flat = flattenTree(TREE, new Set(["src", "src/sub"]));
    expect(flat.map((f) => f.node.id)).toEqual([
      "src",
      "src/a.ts",
      "src/sub",
      "src/sub/b.ts",
      "docs",
      "root.txt",
    ]);
  });

  it("ignores expanded ids that belong to files", () => {
    const flat = flattenTree(TREE, new Set(["root.txt"]));
    expect(flat.map((f) => f.node.id)).toEqual(["src", "docs", "root.txt"]);
  });
});

describe("findNode / collectSubtreeIds / ancestorsOf", () => {
  it("finds nested nodes", () => {
    expect(findNode(TREE, "src/sub/b.ts")?.name).toBe("b.ts");
    expect(findNode(TREE, "nope")).toBeNull();
  });

  it("collects the subtree including the root", () => {
    const ids = collectSubtreeIds(findNode(TREE, "src")!);
    expect([...ids].sort()).toEqual(
      ["src", "src/a.ts", "src/sub", "src/sub/b.ts"].sort(),
    );
  });

  it("returns the ancestor chain root → parent", () => {
    const chain = ancestorsOf(TREE, "src/sub/b.ts");
    expect(chain.map((n) => n.id)).toEqual(["src", "src/sub"]);
  });

  it("returns an empty chain for roots", () => {
    expect(ancestorsOf(TREE, "src")).toEqual([]);
  });
});

describe("rangeSelect", () => {
  it("selects a contiguous range of visible rows", () => {
    const flat = flattenTree(TREE, new Set(["src"]));
    const ids = rangeSelect(flat, "src/a.ts", "docs");
    expect([...ids]).toEqual(["src/a.ts", "src/sub", "docs"]);
  });

  it("works when the arguments are reversed", () => {
    const flat = flattenTree(TREE, new Set());
    const ids = rangeSelect(flat, "root.txt", "src");
    expect([...ids]).toEqual(["src", "docs", "root.txt"]);
  });
});

describe("canDrop", () => {
  it("allows dropping a folder onto an unrelated folder", () => {
    expect(canDrop(TREE, "docs", "src")).toBe(true);
  });

  it("rejects dropping a folder into itself or a descendant", () => {
    expect(canDrop(TREE, "src", "src")).toBe(false);
    expect(canDrop(TREE, "src", "src/sub")).toBe(false);
  });

  it("rejects dropping files in v1", () => {
    expect(canDrop(TREE, "root.txt", "src")).toBe(false);
  });

  it("rejects dropping onto a file", () => {
    expect(canDrop(TREE, "docs", "root.txt")).toBe(false);
  });
});

describe("sortNodes / sortTree", () => {
  it("puts directories first then sorts by name", () => {
    const input: TreeNode[] = [
      { id: "b.md", name: "b.md", path: "/b.md", kind: "file" },
      { id: "z", name: "z", path: "/z", kind: "dir" },
      { id: "a.md", name: "a.md", path: "/a.md", kind: "file" },
      { id: "m", name: "m", path: "/m", kind: "dir" },
    ];
    expect(sortNodes(input).map((n) => n.id)).toEqual([
      "m",
      "z",
      "a.md",
      "b.md",
    ]);
  });

  it("sorts recursively", () => {
    const input: TreeNode[] = [
      {
        id: "d",
        name: "d",
        path: "/d",
        kind: "dir",
        children: [
          { id: "d/z.ts", name: "z.ts", path: "/d/z.ts", kind: "file" },
          { id: "d/a.ts", name: "a.ts", path: "/d/a.ts", kind: "file" },
        ],
      },
    ];
    expect(sortTree(input)[0].children!.map((c) => c.id)).toEqual([
      "d/a.ts",
      "d/z.ts",
    ]);
  });
});

describe("moveNode", () => {
  it("moves a folder under another folder, sorted", () => {
    const next = moveNode(TREE, "docs", "src");
    const src = findNode(next, "src")!;
    // Children are re-sorted: directories first (docs, src/sub) then files.
    expect(src.children!.map((c) => c.id)).toEqual([
      "docs",
      "src/sub",
      "src/a.ts",
    ]);
    // The original location is gone.
    expect(findNode(next, "docs")!.id).toBe("docs");
    expect(next.map((n) => n.id)).toEqual(["src", "root.txt"]);
  });

  it("is a no-op when the move is invalid", () => {
    expect(moveNode(TREE, "src", "src/sub")).toEqual(TREE);
    expect(moveNode(TREE, "root.txt", "src")).toEqual(TREE);
  });

  it("does not mutate the input tree", () => {
    const snapshot = JSON.stringify(TREE);
    moveNode(TREE, "docs", "src");
    expect(JSON.stringify(TREE)).toBe(snapshot);
  });
});
