import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setToast, useToastStore } from "../toast-store";

describe("toast-store", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });
  afterEach(() => {
    useToastStore.getState().clear();
  });

  it("pushes a toast and returns its id", () => {
    const id = setToast("hello");
    expect(id).toMatch(/^t-/);
    expect(useToastStore.getState().queue).toHaveLength(1);
    expect(useToastStore.getState().queue[0].message).toBe("hello");
  });

  it("supports multiple simultaneous toasts", () => {
    setToast("first");
    setToast("second");
    setToast("third");
    expect(useToastStore.getState().queue.map((t) => t.message)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("dedupes by id when same id is reused (refresh)", () => {
    const id1 = setToast("first attempt", { id: "bridge-fail" });
    const id2 = setToast("second attempt", { id: "bridge-fail" });
    expect(id1).toBe(id2);
    expect(useToastStore.getState().queue).toHaveLength(1);
    expect(useToastStore.getState().queue[0].message).toBe("second attempt");
  });

  it("dismisses by id", () => {
    const id = setToast("dismiss me");
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().queue).toHaveLength(0);
  });

  it("caps queue length at 8 (FIFO eviction)", () => {
    for (let i = 0; i < 10; i++) {
      setToast(`msg-${i}`);
    }
    const queue = useToastStore.getState().queue;
    expect(queue).toHaveLength(8);
    // The first two (msg-0, msg-1) should have been evicted.
    expect(queue[0].message).toBe("msg-2");
    expect(queue[7].message).toBe("msg-9");
  });

  it("clamps ttlMs:0 to DEFAULT_TTL_MS unless id has 'p:' prefix (R7.3)", () => {
    // ttlMs:0 with non-persistent id should NOT actually persist.
    setToast("leaky", { ttlMs: 0, id: "leaky-id" });
    expect(useToastStore.getState().queue[0].ttlMs).toBe(5000);
    // ttlMs:0 with persistent id IS allowed.
    setToast("persistent", { ttlMs: 0, id: "p:important" });
    const entry = useToastStore.getState().queue.find((t) => t.id === "p:important");
    expect(entry?.ttlMs).toBe(0);
  });

  it("FIFO eviction skips persistent toasts (R7.3)", () => {
    // 1 persistent + 10 ephemeral → evict 10 down to 8 slots total (1 persistent + 7 ephemeral).
    setToast("persistent-1", { ttlMs: 0, id: "p:perm" });
    for (let i = 0; i < 10; i++) {
      setToast(`ephemeral-${i}`, { id: `e-${i}` });
    }
    const queue = useToastStore.getState().queue;
    // Persistent stays.
    expect(queue.find((t) => t.id === "p:perm")).toBeDefined();
    // Total capped at 8.
    expect(queue).toHaveLength(8);
    // Persistent NOT evicted; oldest ephemerals were.
    const ephemeralMessages = queue.filter((t) => t.id !== "p:perm").map((t) => t.message);
    expect(ephemeralMessages[0]).toBe("ephemeral-3");
  });

  it("preserves kind info", () => {
    setToast("warn", { kind: "warning" });
    setToast("err", { kind: "error" });
    expect(useToastStore.getState().queue[0].kind).toBe("warning");
    expect(useToastStore.getState().queue[1].kind).toBe("error");
  });

  it("stores an inline action button (R2.5 retry / 立即重连)", () => {
    let clicked = 0;
    const action = { label: "重试", hint: "↵", onClick: () => { clicked++; } };
    setToast("AI 引擎异常", { kind: "error", ttlMs: 0, id: "p:agent-died", action });
    const entry = useToastStore.getState().queue[0];
    expect(entry.action?.label).toBe("重试");
    expect(entry.action?.hint).toBe("↵");
    entry.action?.onClick();
    expect(clicked).toBe(1);
  });

  it("refresh preserves the action reference when same id is reused", () => {
    const first = { label: "A", onClick: () => {} };
    const second = { label: "B", onClick: () => {} };
    setToast("first", { id: "x", action: first });
    setToast("second", { id: "x", action: second });
    const entry = useToastStore.getState().queue[0];
    // dedupe updates message + timestamp; latest action wins.
    expect(entry.message).toBe("second");
    expect(entry.action?.label).toBe("B");
  });

  it("dedupes same message text with different auto ids within the window (storm guard)", () => {
    const id1 = setToast("bridge 初始化失败");
    expect(useToastStore.getState().queue[0].kind).toBe("info");
    const id2 = setToast("bridge 初始化失败", { kind: "error" });
    const id3 = setToast("bridge 初始化失败", { kind: "error" });
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    expect(useToastStore.getState().queue).toHaveLength(1);
    // latest kind wins on refresh.
    expect(useToastStore.getState().queue[0].kind).toBe("error");
  });

  it("allows the same message again after the dedupe window passes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      setToast("bridge 初始化失败");
      vi.setSystemTime(3100);
      setToast("bridge 初始化失败");
      expect(useToastStore.getState().queue).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still dedupes different messages pushed in the window (no false positive)", () => {
    setToast("alpha");
    setToast("beta");
    expect(useToastStore.getState().queue.map((t) => t.message)).toEqual(["alpha", "beta"]);
  });
});