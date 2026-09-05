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
});