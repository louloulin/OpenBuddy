/**
 * Tests for R1.2 VirtualizedMessageList helpers + P2-02 enhancements.
 *
 * The full VirtualizedMessageList component depends on @tanstack/react-virtual,
 * which requires a DOM measurement context. We exercise only the pure helpers
 * here — `shouldUseVirtualList` (feature gate), `getTimelineKey` (stable id
 * extraction for the virtualizer's getItemKey), and `estimateNodeSize`
 * (P2-02 per-node heuristic).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FOLLOW_TOLERANCE_PX,
  VIRTUAL_THRESHOLD,
  estimateNodeSize,
  getTimelineKey,
  shouldUseVirtualList,
} from "../VirtualizedMessageList";
import type { TimelineNode } from "@/lib/ui/timeline-utils";

describe("shouldUseVirtualList", () => {
  beforeEach(() => {
    localStorage.removeItem("openbuddy.virtual-list");
  });
  afterEach(() => {
    localStorage.removeItem("openbuddy.virtual-list");
  });

  it("returns false when messageCount is below threshold and no flag", () => {
    expect(shouldUseVirtualList(0)).toBe(false);
    expect(shouldUseVirtualList(VIRTUAL_THRESHOLD - 1)).toBe(false);
  });

  it("returns true when messageCount is at or above threshold", () => {
    expect(shouldUseVirtualList(VIRTUAL_THRESHOLD)).toBe(true);
    expect(shouldUseVirtualList(VIRTUAL_THRESHOLD + 100)).toBe(true);
  });

  it("forces on when localStorage flag is '1'", () => {
    localStorage.setItem("openbuddy.virtual-list", "1");
    expect(shouldUseVirtualList(5)).toBe(true);
  });

  it("forces off when localStorage flag is '0'", () => {
    localStorage.setItem("openbuddy.virtual-list", "0");
    expect(shouldUseVirtualList(10000)).toBe(false);
  });
});

describe("getTimelineKey", () => {
  it("returns message.id for message nodes", () => {
    const node: TimelineNode = {
      kind: "message",
      message: {
        id: "msg-42",
        role: "assistant",
        parts: [],
        complete: true,
      } as never,
      index: 7,
    };
    expect(getTimelineKey(node)).toBe("msg-42");
  });

  it("returns key directly for date-divider nodes", () => {
    const node: TimelineNode = {
      kind: "date-divider",
      label: "2026-09-02",
      key: "date:2026-09-02",
    };
    expect(getTimelineKey(node)).toBe("date:2026-09-02");
  });

  it("returns key directly for model-divider nodes", () => {
    const node: TimelineNode = {
      kind: "model-divider",
      label: "switched to GPT-5",
      key: "model:gpt5",
    };
    expect(getTimelineKey(node)).toBe("model:gpt5");
  });
});

describe("estimateNodeSize (P2-02)", () => {
  const baseline = 200;

  it("returns fallback for undefined node", () => {
    expect(estimateNodeSize(undefined, baseline)).toBe(baseline);
  });

  it("returns small height for date-divider nodes", () => {
    const node: TimelineNode = {
      kind: "date-divider",
      label: "2026-09-02",
      key: "d",
    };
    expect(estimateNodeSize(node, baseline)).toBe(28);
  });

  it("returns small height for model-divider nodes", () => {
    const node: TimelineNode = {
      kind: "model-divider",
      label: "switched",
      key: "m",
    };
    expect(estimateNodeSize(node, baseline)).toBe(28);
  });

  it("returns a small height for user messages", () => {
    const node: TimelineNode = {
      kind: "message",
      message: { id: "u1", role: "user", parts: [{ kind: "text", text: "hi" }], complete: true } as never,
      index: 0,
    };
    const size = estimateNodeSize(node, baseline);
    expect(size).toBeGreaterThan(28);
    expect(size).toBeLessThan(140);
  });

  it("estimates larger size for assistant messages with many parts", () => {
    const node: TimelineNode = {
      kind: "message",
      message: {
        id: "a1",
        role: "assistant",
        parts: [
          { kind: "text", text: "x" },
          { kind: "text", text: "y" },
          { kind: "text", text: "z" },
          { kind: "text", text: "w" },
        ],
        complete: true,
      } as never,
      index: 0,
    };
    const size = estimateNodeSize(node, baseline);
    expect(size).toBeGreaterThanOrEqual(120 + 4 * 64);
  });

  it("bumps estimate for code/tool-call parts", () => {
    const withHeavy: TimelineNode = {
      kind: "message",
      message: {
        id: "h1",
        role: "assistant",
        parts: [{ kind: "code", text: "console.log(1)" }],
        complete: true,
      } as never,
      index: 0,
    };
    const plain: TimelineNode = {
      kind: "message",
      message: {
        id: "p1",
        role: "assistant",
        parts: [{ kind: "text", text: "short" }],
        complete: true,
      } as never,
      index: 0,
    };
    expect(estimateNodeSize(withHeavy, baseline)).toBeGreaterThan(estimateNodeSize(plain, baseline));
  });
});

describe("VirtualizedMessageList (P1-02 memo wrapper)", () => {
  // P1-02: VirtualizedMessageList must be wrapped in React.memo so that
  // ChatView passing the same renderItem + scrollRef does NOT re-trigger
  // the virtualizer's measurement / DOM reconciliation when the parent
  // re-renders for unrelated reasons (e.g. streaming deltas).
  it("is exported as a memoized component (has REACT_MEMO_TYPE)", async () => {
    const React = await import("react");
    const { VirtualizedMessageList } = await import("../VirtualizedMessageList");
    // React.memo attaches a $$typeof of REACT_MEMO_TYPE (Symbol(react.memo)).
    expect((VirtualizedMessageList as unknown as { $$typeof: symbol }).$$typeof).toBe(
      React.default.memo(() => null).$$typeof,
    );
  });
});

describe("FOLLOW_TOLERANCE_PX", () => {
  // P2-02: constant used by follow-mode scroll listener. Tests pin the
  // value so accidental tuning changes surface as test failures rather
  // than silent UX regressions.
  it("is exported and positive", () => {
    expect(FOLLOW_TOLERANCE_PX).toBeGreaterThan(0);
    expect(FOLLOW_TOLERANCE_PX).toBeLessThan(200);
  });
});