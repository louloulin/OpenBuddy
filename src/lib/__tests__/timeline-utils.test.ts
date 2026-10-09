import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  dayLabel,
  isModelSwitch,
  countModelSwitches,
  groupParallelToolCalls,
  clusterToolCalls,
  countParallelClusters,
  type TimelineMessage,
} from "../ui/timeline-utils";
import type { ChatMessage, MessagePart, ToolCallView } from "@/stores/session-store";

function toolCall(id: string, startedAt: number, status: ToolCallView["status"] = "in_progress"): ToolCallView {
  return {
    toolCallId: id,
    title: id,
    kind: "bash",
    status,
    content: [],
    startedAt,
  };
}

function m(id: string, extra: Partial<TimelineMessage> = {}): TimelineMessage {
  return { id, role: "assistant", parts: [], complete: true, ...extra };
}

describe("dayLabel", () => {
  it("ISO 字符串归一为 YYYY-MM-DD", () => {
    expect(dayLabel("2026-07-30T10:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("毫秒时间戳", () => {
    expect(dayLabel(Date.UTC(2026, 6, 30))).toMatch(/^\d{4}-07-30$/);
  });
  it("无效返回 null", () => {
    expect(dayLabel("not-a-date")).toBeNull();
    expect(dayLabel(NaN)).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("无元数据时只输出 message 节点", () => {
    const nodes = buildTimeline([m("a"), m("b")]);
    expect(nodes.every((n) => n.kind === "message")).toBe(true);
    expect(nodes).toHaveLength(2);
  });

  it("跨天插入日期分隔", () => {
    const nodes = buildTimeline([
      m("a", { createdAt: "2026-07-29T10:00:00Z" }),
      m("b", { createdAt: "2026-07-30T10:00:00Z" }),
    ]);
    expect(nodes.filter((n) => n.kind === "date-divider")).toHaveLength(2);
    expect(nodes.filter((n) => n.kind === "message")).toHaveLength(2);
  });

  it("同天不重复插入日期分隔", () => {
    // 用同一天的本地正午两次,避免跨时区把日期判到不同天。
    const noon1 = new Date(2026, 6, 30, 12, 0, 0).toISOString();
    const noon2 = new Date(2026, 6, 30, 14, 0, 0).toISOString();
    const nodes = buildTimeline([
      m("a", { createdAt: noon1 }),
      m("b", { createdAt: noon2 }),
    ]);
    expect(nodes.filter((n) => n.kind === "date-divider")).toHaveLength(1);
  });

  it("模型变化插入模型分隔", () => {
    const nodes = buildTimeline([
      m("a", { modelId: "gpt-4" }),
      m("b", { modelId: "claude" }),
    ]);
    const dividers = nodes.filter((n) => n.kind === "model-divider");
    expect(dividers).toHaveLength(2);
    expect((dividers[1] as { label: string }).label).toContain("claude");
  });

  it("模型相同不重复分隔", () => {
    const nodes = buildTimeline([
      m("a", { modelId: "gpt-4" }),
      m("b", { modelId: "gpt-4" }),
    ]);
    expect(nodes.filter((n) => n.kind === "model-divider")).toHaveLength(1);
  });

  it("message 节点带 index", () => {
    const nodes = buildTimeline([m("a"), m("b"), m("c")]);
    const idxs = nodes
      .filter((n): n is Extract<typeof n, { kind: "message" }> => n.kind === "message")
      .map((n) => n.index);
    expect(idxs).toEqual([0, 1, 2]);
  });

  it("空消息列表返回空数组", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it("日期 + 模型混合正确交错", () => {
    const nodes = buildTimeline([
      m("a", { createdAt: "2026-07-29T10:00:00Z", modelId: "x" }),
      m("b", { createdAt: "2026-07-30T10:00:00Z", modelId: "y" }),
    ]);
    // a: date + model + msg ; b: date + model + msg
    expect(nodes.map((n) => n.kind)).toEqual([
      "date-divider",
      "model-divider",
      "message",
      "date-divider",
      "model-divider",
      "message",
    ]);
  });
});

describe("isModelSwitch", () => {
  it("两侧都有 modelId 且不同 → true", () => {
    expect(isModelSwitch(m("a", { modelId: "x" }), m("b", { modelId: "y" }))).toBe(true);
  });
  it("相同 modelId → false", () => {
    expect(isModelSwitch(m("a", { modelId: "x" }), m("b", { modelId: "x" }))).toBe(false);
  });
  it("任一无 modelId → false", () => {
    expect(isModelSwitch(m("a", { modelId: "x" }), m("b"))).toBe(false);
    expect(isModelSwitch(m("a"), m("b", { modelId: "y" }))).toBe(false);
  });
});

describe("countModelSwitches", () => {
  it("统计切换次数", () => {
    expect(
      countModelSwitches([
        m("a", { modelId: "x" }),
        m("b", { modelId: "y" }),
        m("c", { modelId: "y" }),
        m("d", { modelId: "z" }),
      ]),
    ).toBe(2);
  });
  it("无 modelId 返回 0", () => {
    expect(countModelSwitches([m("a"), m("b")])).toBe(0);
  });
  it("单一 modelId 返回 0", () => {
    expect(countModelSwitches([m("a", { modelId: "x" }), m("b", { modelId: "x" })])).toBe(0);
  });
});

describe("groupParallelToolCalls (Plan5 B.9)", () => {
  it("single tool_call → single cluster", () => {
    const parts: MessagePart[] = [
      { kind: "tool_call", toolCall: toolCall("a", 1000) },
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters).toEqual([{ kind: "single", toolCallId: "a", toolCall: expect.objectContaining({ toolCallId: "a" }) }]);
  });

  it("two tool_calls within window → parallel cluster", () => {
    const parts: MessagePart[] = [
      { kind: "tool_call", toolCall: toolCall("a", 1000) },
      { kind: "tool_call", toolCall: toolCall("b", 1050) },
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters.length).toBe(1);
    expect(clusters[0].kind).toBe("parallel");
    if (clusters[0].kind === "parallel") {
      expect(clusters[0].toolCallIds).toEqual(["a", "b"]);
    }
  });

  it("two tool_calls outside window → two single clusters", () => {
    const parts: MessagePart[] = [
      { kind: "tool_call", toolCall: toolCall("a", 1000) },
      { kind: "tool_call", toolCall: toolCall("b", 10000) },
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters.length).toBe(2);
    expect(clusters[0].kind).toBe("single");
    expect(clusters[1].kind).toBe("single");
  });

  it("three parallel + one serial", () => {
    const parts: MessagePart[] = [
      { kind: "tool_call", toolCall: toolCall("a", 1000) },
      { kind: "tool_call", toolCall: toolCall("b", 1010) },
      { kind: "tool_call", toolCall: toolCall("c", 1020) },
      { kind: "tool_call", toolCall: toolCall("d", 20000) },
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters.length).toBe(2);
    expect(clusters[0].kind).toBe("parallel");
    if (clusters[0].kind === "parallel") {
      expect(clusters[0].toolCallIds).toEqual(["a", "b", "c"]);
    }
    expect(clusters[1].kind).toBe("single");
  });

  it("non-tool_call parts reset the buffer", () => {
    const parts: MessagePart[] = [
      { kind: "tool_call", toolCall: toolCall("a", 1000) },
      { kind: "tool_call", toolCall: toolCall("b", 1010) },
      { kind: "text", text: "..." },
      { kind: "tool_call", toolCall: toolCall("c", 1020) },
    ];
    const clusters = clusterToolCalls(parts);
    expect(clusters.length).toBe(2);
    expect(clusters[0].kind).toBe("parallel");
    expect(clusters[1].kind).toBe("single");
  });

  it("groupParallelToolCalls flattens across messages, skips user msgs", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", parts: [], complete: true },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "tool_call", toolCall: toolCall("a", 1000) },
          { kind: "tool_call", toolCall: toolCall("b", 1010) },
        ],
        complete: true,
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ kind: "tool_call", toolCall: toolCall("c", 2000) }],
        complete: true,
      },
    ];
    const clusters = groupParallelToolCalls(messages);
    expect(clusters.length).toBe(2);
    expect(countParallelClusters(clusters)).toBe(1);
  });
});
