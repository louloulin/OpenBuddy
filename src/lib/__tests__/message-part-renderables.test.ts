// @vitest-environment node
/**
 * Plan5 B.9 — parallel tool-call grouping.
 *
 * `ToolGroupSummary` shipped with its own component tests, but was never
 * actually rendered in the app: `MessagePartRegistry` dispatched parts 1:1
 * with no clustering step, so three parallel tool calls still produced three
 * stacked cards and `[data-testid="tool-group-summary"]` never existed in the
 * real DOM. The live-Electron probe caught it; these tests pin the logic so it
 * cannot regress silently again.
 */
import { describe, expect, it } from "vitest";
import type { MessagePart, ToolCallView } from "@/stores/session-store";
import {
  buildPartRenderables,
  clusterToolCalls,
  DEFAULT_PARALLEL_WINDOW_MS,
} from "../ui/message-part-renderables";

function toolCall(id: string, startedAt?: number): ToolCallView {
  return {
    toolCallId: id,
    title: id,
    kind: "bash",
    status: "completed",
    content: [],
    ...(typeof startedAt === "number" ? { startedAt } : {}),
  };
}

const toolPart = (id: string, startedAt?: number): MessagePart => ({
  kind: "tool_call",
  toolCall: toolCall(id, startedAt),
});

describe("clusterToolCalls", () => {
  it("a lone tool call is a single cluster", () => {
    const clusters = clusterToolCalls([toolPart("a", 1_000)]);
    expect(clusters).toEqual([
      { kind: "single", toolCallId: "a", toolCall: expect.objectContaining({ toolCallId: "a" }) },
    ]);
  });

  it("calls inside the window collapse into one parallel cluster", () => {
    const clusters = clusterToolCalls([
      toolPart("a", 1_000),
      toolPart("b", 1_050),
      toolPart("c", 1_100),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind).toBe("parallel");
    if (clusters[0].kind === "parallel") {
      expect(clusters[0].toolCallIds).toEqual(["a", "b", "c"]);
    }
  });

  it("calls outside the window stay serial", () => {
    const clusters = clusterToolCalls([toolPart("a", 1_000), toolPart("b", 60_000)]);
    expect(clusters.map((c) => c.kind)).toEqual(["single", "single"]);
  });

  it("respects a custom window", () => {
    const parts = [toolPart("a", 1_000), toolPart("b", 1_100)];
    expect(clusterToolCalls(parts, 50)[0].kind).toBe("single");
    expect(clusterToolCalls(parts, DEFAULT_PARALLEL_WINDOW_MS)[0].kind).toBe("parallel");
  });

  it("does NOT claim parallel when startedAt is missing (legacy transcripts)", () => {
    // Regression: `startedAt ?? 0` made every untimestamped call look
    // simultaneous, rendering a bogus "3 个工具并行" summary.
    const clusters = clusterToolCalls([toolPart("a"), toolPart("b"), toolPart("c")]);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.kind === "single")).toBe(true);
  });

  it("an untimestamped call also breaks an existing parallel window", () => {
    const clusters = clusterToolCalls([toolPart("a", 1_000), toolPart("b", 1_010), toolPart("c")]);
    expect(clusters.map((c) => c.kind)).toEqual(["parallel", "single"]);
  });

  it("a non-tool part splits the window", () => {
    const parts: MessagePart[] = [
      toolPart("a", 1_000),
      toolPart("b", 1_010),
      { kind: "text", text: "step done" },
      toolPart("c", 1_020),
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters.map((c) => c.kind)).toEqual(["parallel", "single"]);
  });
});

describe("buildPartRenderables", () => {
  it("serial tool calls render 1:1 (no visual change for the common case)", () => {
    const parts: MessagePart[] = [toolPart("a", 1_000), toolPart("b", 60_000)];
    const items = buildPartRenderables(parts);
    expect(items.map((i) => i.type)).toEqual(["part", "part"]);
  });

  it("a parallel group collapses to ONE render item", () => {
    const parts: MessagePart[] = [toolPart("a", 1_000), toolPart("b", 1_020), toolPart("c", 1_040)];
    const items = buildPartRenderables(parts);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("cluster");
    if (items[0].type === "cluster") {
      expect(items[0].cluster.toolCallIds).toEqual(["a", "b", "c"]);
    }
  });

  it("never emits a clustered tool call twice", () => {
    const parts: MessagePart[] = [
      { kind: "text", text: "working" },
      toolPart("a", 1_000),
      toolPart("b", 1_010),
      { kind: "text", text: "done" },
    ];
    const items = buildPartRenderables(parts);
    expect(items.map((i) => i.type)).toEqual(["part", "cluster", "part"]);
    const emittedIds = items.flatMap((i) =>
      i.type === "cluster" ? i.cluster.toolCallIds : i.part.kind === "tool_call" ? [i.part.toolCall.toolCallId] : [],
    );
    expect(emittedIds).toEqual([...new Set(emittedIds)]);
  });

  it("preserves order of non-tool parts around clusters", () => {
    const parts: MessagePart[] = [
      { kind: "text", text: "first" },
      toolPart("a", 1_000),
      toolPart("b", 1_010),
      { kind: "thought", text: "thinking" },
      { kind: "text", text: "last" },
    ];
    const items = buildPartRenderables(parts);
    expect(items.map((i) => i.type)).toEqual(["part", "cluster", "part", "part"]);
  });

  it("empty input yields no render items", () => {
    expect(buildPartRenderables([])).toEqual([]);
  });
});
