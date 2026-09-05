/**
 * abandon-stream.test.ts — guards the single shared cleanup helper that
 * every error / cancel path routes through. The "半天没返回" root cause
 * analysis showed that 5 different handlers each called only a SUBSET of
 * the required state resets; this test pins the contract so a refactor
 * can't silently regress any of them.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => stateRef,
    setState: (updater: (s: typeof stateRef) => typeof stateRef) => {
      stateRef = updater(stateRef);
    },
    subscribe: () => () => undefined,
  },
}));
vi.mock("@/stores/sessions-store", () => ({
  useSessionsStore: {
    getState: () => sessionsStateRef,
    setState: (updater: (s: typeof sessionsStateRef) => typeof sessionsStateRef) => {
      sessionsStateRef = updater(sessionsStateRef);
    },
    subscribe: () => () => undefined,
  },
}));

// NOTE: import after mocks so they apply.
import { abandonInFlightStream } from "../abandon-stream";

let stateRef: any;
let sessionsStateRef: any;

beforeEach(() => {
  stateRef = {
    sessionId: "sess-1",
    streaming: true,
    messages: [
      { id: "m1", role: "assistant", parts: [], complete: false },
    ],
    streamingMessageId: "m1",
    optimisticBubble: null,
    error: null,
    planMode: false,
    plan: null,
    abandonCalls: [],
    setStreamingCalls: [],
    finishCalls: 0,
  };
  sessionsStateRef = {
    upsertCalls: [] as Array<{ sessionId: string; status: string }>,
    upsert: (entry: { sessionId: string; status: string }) => {
      sessionsStateRef.upsertCalls.push(entry);
      return entry;
    },
  };
  // Attach mutable spy helpers.
  stateRef.abandonStreamingMessage = (reason: string) => {
    // Mirror the real implementation: if `streamingMessageId` is null and
    // there's no trailing incomplete assistant, the call is a no-op.
    const target =
      stateRef.messages.find((m: any) => m.id === stateRef.streamingMessageId) ??
      [...stateRef.messages].reverse().find((m: any) => m.role === "assistant" && !m.complete);
    if (!target) return;
    stateRef.abandonCalls.push(reason);
    stateRef.messages = stateRef.messages.map((m: any) =>
      m.id === target.id
        ? {
            ...m,
            parts: [{ kind: "text", text: `（已中断：${reason}）` }],
            complete: true,
          }
        : m,
    );
    stateRef.streamingMessageId = null;
  };
  stateRef.setStreaming = (s: boolean) => {
    stateRef.setStreamingCalls.push(s);
    stateRef.streaming = s;
  };
  stateRef.finishStreamingMessage = () => {
    stateRef.finishCalls += 1;
  };
});

describe("abandonInFlightStream", () => {
  it("abandons the bubble, clears streaming flag, and marks session failed by default", () => {
    abandonInFlightStream({ sessionId: "sess-1", reason: "turn-error: error" });
    expect(stateRef.abandonCalls).toEqual(["turn-error: error"]);
    expect(stateRef.setStreamingCalls).toEqual([false]);
    expect(sessionsStateRef.upsertCalls).toEqual([
      { sessionId: "sess-1", status: "failed" },
    ]);
    expect(stateRef.messages[0].complete).toBe(true);
  });

  it("honours status=completed (user cancel path)", () => {
    abandonInFlightStream({
      sessionId: "sess-1",
      reason: "用户取消",
      status: "completed",
    });
    expect(sessionsStateRef.upsertCalls).toEqual([
      { sessionId: "sess-1", status: "completed" },
    ]);
  });

  it("is a no-op on the in-memory state when focus has moved to a different session", () => {
    stateRef.sessionId = "sess-2"; // focus has moved
    abandonInFlightStream({ sessionId: "sess-1", reason: "watchdog" });
    // abandon/setStreaming should NOT fire on the focused session's state.
    expect(stateRef.abandonCalls).toEqual([]);
    expect(stateRef.setStreamingCalls).toEqual([]);
    // …but sessionsStore still gets the failed status upsert so the
    // sidebar reflects the abort.
    expect(sessionsStateRef.upsertCalls).toEqual([
      { sessionId: "sess-1", status: "failed" },
    ]);
  });

  it("is safe to call twice (idempotent)", () => {
    abandonInFlightStream({ sessionId: "sess-1", reason: "first" });
    abandonInFlightStream({ sessionId: "sess-1", reason: "second" });
    expect(stateRef.abandonCalls).toEqual(["first"]);
    // streamingMessageId is null after the first call → second call is no-op
    expect(stateRef.abandonCalls.filter((c: string) => c === "second")).toHaveLength(0);
  });
});