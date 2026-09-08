import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../session-store";

/**
 * Phase 4 perf smoke: pushing/popping the optimistic bubble stays O(1),
 * and 1000 toggles of `setStreaming` complete in well under a second —
 * guarding against any future regression that accidentally re-introduces
 * expensive selectors on the streaming flag.
 *
 * P0-06: also asserts the streaming delta reducer mutates exactly one
 * message reference (findIndex + slice) instead of O(n) map — the
 * unchanged messages must keep their original reference so React.memo
 * can skip re-rendering them.
 */

const resetStore = () =>
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
  });

describe("session-store perf smoke", () => {
  beforeEach(resetStore);

  it("1000 pushOptimisticUser / setStreaming toggles finish quickly", () => {
    useSessionStore.getState().setSession("perf");
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      useSessionStore.getState().pushOptimisticUser(`msg-${i}`);
      useSessionStore.getState().setStreaming(i % 2 === 0);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // Final state should reflect the last toggle.
    expect(useSessionStore.getState().streaming).toBe(false);
    expect(useSessionStore.getState().optimisticBubble).not.toBeNull();
  });

  it("pushOptimisticUser is referentially stable per bubble id", () => {
    useSessionStore.getState().setSession("perf");
    useSessionStore.getState().pushOptimisticUser("first");
    const before = useSessionStore.getState().optimisticBubble;
    // Reading (no-op) doesn't change the bubble reference.
    void useSessionStore.getState().optimisticBubble;
    expect(useSessionStore.getState().optimisticBubble).toBe(before);
  });

  // P0-06: streaming delta must mutate only the targeted message — siblings
  // keep their original reference so React.memo can skip them.
  it("appendStreamingDelta only mutates the streaming message reference", async () => {
    useSessionStore.setState({
      sessionId: "s-perf",
      streaming: true,
      streamingMessageId: "m2",
      messages: [
        { id: "m1", role: "user" as const, parts: [{ kind: "text" as const, text: "hi" }], complete: true },
        { id: "m2", role: "assistant" as const, parts: [{ kind: "text" as const, text: "" }], complete: false },
        { id: "m3", role: "user" as const, parts: [{ kind: "text" as const, text: "second" }], complete: true },
      ],
    });

    const before = useSessionStore.getState().messages;
    const m1Before = before[0];
    const m3Before = before[2];

    useSessionStore.getState().appendStreamingDelta("hello");
    // rAF flush — appendStreamingDelta coalesces to one setState per frame.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const after = useSessionStore.getState().messages;
    expect(after.length).toBe(3);
    // Untouched messages keep reference equality.
    expect(after[0]).toBe(m1Before);
    expect(after[2]).toBe(m3Before);
    // Targeted message has new reference but same id.
    expect(after[1].id).toBe("m2");
    expect(after[1]).not.toBe(before[1]);
    // Last text part got concatenated.
    const lastPart = after[1].parts[after[1].parts.length - 1];
    expect(lastPart.kind).toBe("text");
    if (lastPart.kind === "text") expect(lastPart.text).toBe("hello");
  });

  // P0-06: when streamingMessageId isn't in the list (e.g. mid-cleanup),
  // the delta reducer must be a no-op — no spurious state churn.
  it("appendStreamingDelta is a no-op when streamingMessageId is unknown", async () => {
    useSessionStore.setState({
      sessionId: "s-perf",
      streaming: true,
      streamingMessageId: "m-ghost",
      messages: [
        { id: "m1", role: "user" as const, parts: [{ kind: "text" as const, text: "hi" }], complete: true },
      ],
    });
    const before = useSessionStore.getState().messages;
    const beforeRef = before[0];

    useSessionStore.getState().appendStreamingDelta("dropped");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const after = useSessionStore.getState().messages;
    expect(after).toBe(before);
    expect(after[0]).toBe(beforeRef);
  });

  // P0-06/hardening: when many text deltas land on the same kind, the hot
  // path should NOT re-allocate the parts array. Mutating the last part in
  // place keeps the allocation count constant per frame regardless of how
  // many deltas land (sustained text streaming). The message wrapper
  // object still gets a new reference so subscribers fire, but the inner
  // `parts` array stays the same.
  it("same-kind text deltas reuse the parts array reference (O(1) hot path)", async () => {
    useSessionStore.setState({
      sessionId: "s-hotpath",
      streaming: true,
      streamingMessageId: "m1",
      messages: [
        { id: "m1", role: "assistant" as const, parts: [{ kind: "text" as const, text: "" }], complete: false },
      ],
    });

    // First delta: cold start (last part has empty text, but kind matches).
    useSessionStore.getState().appendStreamingDelta("hello ");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    const afterFirst = useSessionStore.getState().messages;
    const partsAfterFirst = afterFirst[0].parts;
    const messageAfterFirst = afterFirst[0];

    // Subsequent deltas: same kind → parts array must stay referentially stable.
    useSessionStore.getState().appendStreamingDelta("world ");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    useSessionStore.getState().appendStreamingDelta("again");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const after = useSessionStore.getState().messages;
    // Hot path optimization: parts array is NOT re-allocated when merging
    // into the tail. The message wrapper IS (so subscribers fire), but the
    // inner parts reference is stable across same-kind deltas.
    expect(after[0].parts).toBe(partsAfterFirst);
    expect(after[0]).not.toBe(messageAfterFirst);
    // Content was actually appended to the same part instance.
    const lastPart = after[0].parts[after[0].parts.length - 1];
    expect(lastPart.kind).toBe("text");
    if (lastPart.kind === "text") {
      expect(lastPart.text).toBe("hello world again");
    }
  });

  // P0-06/hardening: when the kind switches (text → thought), a new part
  // is appended. The parts array IS re-allocated (concatenation) but the
  // previous parts keep their references so React.memo on the older
  // MessageItem siblings doesn't re-render.
  it("kind switch appends a new part while keeping earlier parts stable", async () => {
    useSessionStore.setState({
      sessionId: "s-switch",
      streaming: true,
      streamingMessageId: "m1",
      messages: [
        { id: "m1", role: "assistant" as const, parts: [{ kind: "text" as const, text: "answer" }], complete: false },
      ],
    });

    const before = useSessionStore.getState().messages;
    const textPartBefore = before[0].parts[0];

    // Switch to thought kind: must open a new part, not merge into text.
    useSessionStore.getState().appendStreamingDelta("reasoning here", "thought");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const after = useSessionStore.getState().messages;
    expect(after[0].parts.length).toBe(2);
    // Earlier parts keep their identity so memo'd message siblings don't churn.
    expect(after[0].parts[0]).toBe(textPartBefore);
    expect(after[0].parts[1].kind).toBe("thought");
    if (after[0].parts[1].kind === "thought") {
      expect(after[0].parts[1].text).toBe("reasoning here");
    }
  });

  // P0-06/hardening: 200-message long-session delta smoke. Confirms the
  // same-kind hot path doesn't blow up on real-shaped input — the
  // existing perf test covers throughput, this one covers correctness on
  // a realistic transcript size.
  it("hot path handles 200 sibling messages without losing references", async () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      parts: [{ kind: "text" as const, text: `seed ${i}` }],
      complete: i % 2 === 1,
    }));
    // Last message is the one being streamed. Matches the real product shape
    // (the user just hit send; the assistant is mid-stream of a turn).
    const streamingMessageId = messages[messages.length - 1].id;
    useSessionStore.setState({
      sessionId: "s-long",
      streaming: true,
      streamingMessageId,
      messages,
    });

    // Track every sibling reference so we can confirm none moved.
    const beforeSiblings = useSessionStore
      .getState()
      .messages.map((m) => ({ id: m.id, msg: m }));

    useSessionStore.getState().appendStreamingDelta("delta chunk");
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    const after = useSessionStore.getState().messages;
    for (const { id, msg } of beforeSiblings) {
      if (id === streamingMessageId) continue;
      const afterIdx = after.findIndex((m) => m.id === id);
      expect(afterIdx).toBeGreaterThanOrEqual(0);
      // Sibling messages must keep their reference so React.memo skips them.
      expect(after[afterIdx]).toBe(msg);
    }
    // The targeted message's last text part got the delta appended.
    const target = after.find((m) => m.id === streamingMessageId);
    expect(target).toBeDefined();
    const last = target!.parts[target!.parts.length - 1];
    if (last.kind === "text") {
      expect(last.text).toBe("seed 199delta chunk");
    } else {
      throw new Error("expected text part at tail");
    }
  });
});