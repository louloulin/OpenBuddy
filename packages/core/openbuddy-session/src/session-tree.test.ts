/**
 * session-tree.test.ts — Phase 4 (补底层 API): sessionTree projection.
 *
 * Verifies that `sessionTree(manager)` reuses pi's `SessionManager.getTree()`
 * and projects it into the UI-facing `{ id, parentId, branch, summary, createdAt }`
 * shape without re-implementing tree traversal.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { branchKindOf, entrySummary, sessionTree } from "./session-tree";

describe("sessionTree projection", () => {
  let dir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-session-tree-"));
    manager = SessionManager.create(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("projects a linear session into a single-rooted tree", () => {
    manager.appendMessage({ role: "user", content: "hello" });
    manager.appendMessage({ role: "assistant", content: "hi there" });

    const tree = sessionTree(manager);
    expect(tree).toHaveLength(1); // single root
    const root = tree[0]!;
    expect(root.parentId).toBeNull();
    expect(root.branch).toBe("message");
    expect(root.summary).toBe("hello");
    expect(root.createdAt).toBeTruthy();
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.summary).toBe("hi there");
  });

  it("projects a branch_summary entry with its summary text", () => {
    const first = manager.appendMessage({ role: "user", content: "question" });
    manager.branchWithSummary(first, "abandoned path summary", {});
    manager.appendMessage({ role: "assistant", content: "answer" });

    const tree = sessionTree(manager);
    const kinds = flatten(tree).map((n) => n.branch);
    expect(kinds).toContain("branch_summary");
    const summaryNode = flatten(tree).find((n) => n.branch === "branch_summary");
    expect(summaryNode?.summary).toBe("abandoned path summary");
  });

  it("projects a compaction entry with its summary", () => {
    manager.appendMessage({ role: "user", content: "a" });
    manager.appendCompaction("compacted context", "some-entry-id", 1000);
    manager.appendMessage({ role: "assistant", content: "b" });

    const tree = sessionTree(manager);
    const compaction = flatten(tree).find((n) => n.branch === "compaction");
    expect(compaction?.summary).toBe("compacted context");
  });

  it("truncates long message summaries to the cap", () => {
    const long = "x".repeat(500);
    manager.appendMessage({ role: "user", content: long });
    const tree = sessionTree(manager);
    expect(tree[0]!.summary!.length).toBeLessThan(500);
    expect(tree[0]!.summary!.endsWith("…")).toBe(true);
  });

  it("maps entry types to branch kinds", () => {
    expect(branchKindOf({ type: "message", id: "a", parentId: null, timestamp: "t", message: { role: "user", content: "x" } } as never)).toBe("message");
    expect(branchKindOf({ type: "compaction", id: "a", parentId: null, timestamp: "t", summary: "s", firstKeptEntryId: "x", tokensBefore: 1 } as never)).toBe("compaction");
    expect(branchKindOf({ type: "model_change", id: "a", parentId: null, timestamp: "t", provider: "p", modelId: "m" } as never)).toBe("model_change");
    expect(branchKindOf({ type: "unknown_type", id: "a", parentId: null, timestamp: "t" } as never)).toBe("other");
  });

  it("entrySummary extracts text from structured message content", () => {
    const summary = entrySummary({
      type: "message",
      id: "a",
      parentId: null,
      timestamp: "t",
      message: { role: "user", content: [{ type: "text", text: "structured text" }] },
    } as never);
    expect(summary).toBe("structured text");
  });
});

function flatten(nodes: ReturnType<typeof sessionTree>): Array<{ branch: string; summary?: string }> {
  const out: Array<{ branch: string; summary?: string }> = [];
  const walk = (list: Array<{ branch: string; summary?: string; children: unknown[] }>) => {
    for (const n of list) {
      out.push({ branch: n.branch, summary: n.summary });
      walk(n.children as never);
    }
  };
  walk(nodes as never);
  return out;
}
