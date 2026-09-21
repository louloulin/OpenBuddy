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
    abandonCallsArgs: [] as Array<unknown>,
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
  stateRef.abandonStreamingMessage = (reason: string, error?: { message: string; code?: string }) => {
    // Mirror the real implementation: if `streamingMessageId` is null and
    // there's no trailing incomplete assistant, the call is a no-op.
    const target =
      stateRef.messages.find((m: any) => m.id === stateRef.streamingMessageId) ??
      [...stateRef.messages].reverse().find((m: any) => m.role === "assistant" && !m.complete);
    if (!target) return;
    stateRef.abandonCalls.push(reason);
    stateRef.abandonCallsArgs.push(error);
    stateRef.messages = stateRef.messages.map((m: any) =>
      m.id === target.id
        ? {
            ...m,
            // R-err-provider-chat — when the caller passes a structured
            // error, the real store attaches `m.error` instead of writing
            // a placeholder text part. Mirror that here so the contract is
            // testable without spinning up the full Zustand store.
            ...(error ? { error } : {}),
            parts: error
              ? target.parts
              : [{ kind: "text", text: `（已中断：${reason}）` }],
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

  // R-err-provider-chat — every error / cancel path that knows *why* the
  // turn failed must forward the structured error so TurnErrorCard renders
  // (instead of the "（已中断：...）" placeholder). Pin each path that
  // regressed back to a blank bubble before this fix landed.
  it("forwards a structured error to abandonStreamingMessage (turn-error path)", () => {
    abandonInFlightStream({
      sessionId: "sess-1",
      reason: "turn-error: rate_limit",
      error: { message: "429 已达到 Token Plan 用量上限", code: "rate_limit_error" },
    });
    expect(stateRef.abandonCallsArgs).toEqual([
      { message: "429 已达到 Token Plan 用量上限", code: "rate_limit_error" },
    ]);
    // Bubble keeps its empty parts and gains the structured error metadata
    // so MessageItem renders a TurnErrorCard instead of a placeholder line.
    expect(stateRef.messages[0].parts).toHaveLength(0);
    expect(stateRef.messages[0].error).toEqual({
      message: "429 已达到 Token Plan 用量上限",
      code: "rate_limit_error",
    });
  });

  it("forwards a structured error to abandonStreamingMessage (agent-died path)", () => {
    abandonInFlightStream({
      sessionId: "sess-1",
      reason: "agent-died: pipe closed",
      error: { message: "AI 引擎异常退出：pipe closed", code: "provider_error" },
    });
    expect(stateRef.abandonCallsArgs).toEqual([
      { message: "AI 引擎异常退出：pipe closed", code: "provider_error" },
    ]);
    expect(stateRef.messages[0].error?.code).toBe("provider_error");
  });

  it("forwards a structured error to abandonStreamingMessage (streaming watchdog path)", () => {
    abandonInFlightStream({
      sessionId: "sess-1",
      reason: "流式 60s 看门狗",
      error: {
        message: "AI 引擎长时间无响应,已自动结束当前轮次。",
        code: "network_error",
      },
    });
    expect(stateRef.abandonCallsArgs).toEqual([
      {
        message: "AI 引擎长时间无响应,已自动结束当前轮次。",
        code: "network_error",
      },
    ]);
    expect(stateRef.messages[0].error?.code).toBe("network_error");
  });

  it("forwards undefined for cancel (user-initiated, not an error)", () => {
    abandonInFlightStream({
      sessionId: "sess-1",
      reason: "用户取消",
      status: "completed",
    });
    expect(stateRef.abandonCallsArgs).toEqual([undefined]);
    // No error metadata → keep the legacy placeholder text behaviour so
    // existing user-cancel UX (a polite "（已中断：用户取消）" sentence)
    // doesn't regress into a TurnErrorCard.
    expect(stateRef.messages[0].error).toBeUndefined();
  });
});