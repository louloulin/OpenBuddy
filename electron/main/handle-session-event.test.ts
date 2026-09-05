/**
 * handle-session-event.test.ts — guard for the streaming-delta emit pipeline.
 *
 * Phase R2.6 regression test. The renderer needs to see `pi://update` for
 * every `message_update` AssistantMessageEvent so the AI response renders
 * live in the chat panel. Before this fix, `handle-session-event.ts` only
 * emitted `pi://update` from `loadSession` replay (a code path that runs
 * once at session restore, not during live streaming). The result was a
 * blank chat panel during the model turn — the user would see only the
 * final `pi://complete` flush, often without any text.
 *
 * These tests pin the wire shape we emit, so any future refactor that
 * drops the emit or renames a field will fail this guard immediately.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSessionEventSubscriber,
  handleSessionEvent,
  type HandleSessionEventDeps,
} from "./agent/host-modules/bootstrap/handle-session-event";

type RendererEvent = { channel: string; payload: unknown };

function makeDeps(): { deps: HandleSessionEventDeps; events: RendererEvent[]; pluginEvents: Array<{ channel: string; payload: unknown }> } {
  const events: RendererEvent[] = [];
  const pluginEvents: Array<{ channel: string; payload: unknown }> = [];
  const deps: HandleSessionEventDeps = {
    state: {
      queueMirror: null,
      eventHandlers: new Set(),
      jobsRegistry: new Map(),
      runningTasks: new Map(),
    },
    context: { emit: () => undefined },
    publicQueueItems: () => [],
    captureFileSnapshot: async () => undefined,
    emitPluginEvent: ((channel: string, payload: unknown) => {
      pluginEvents.push({ channel, payload });
      return { sequence: 0, sessionSequence: 0, eventVersion: 1, timestamp: 0 };
    }) as HandleSessionEventDeps["emitPluginEvent"],
    emitRendererEvent: (channel, payload) => {
      events.push({ channel, payload });
    },
    emitPiSessionEvent: () => undefined,
    eventNamespace: (raw: string) => `session/${raw}`,
    canonicalEventNamespace: () => null,
  };
  return { deps, events, pluginEvents };
}

const fakeSession = { sessionId: "01a06cd9-test" } as unknown as Parameters<typeof handleSessionEvent>[1];

/**
 * Fresh session identity per test.
 *
 * Turn completion is deduped per session (`turnCompletedSessions` in
 * `handle-session-event.ts` — a WeakSet keyed by the session object), so tests
 * that assert completion behaviour must not share one `fakeSession`: the first
 * test to emit a complete would suppress the next test's. The streaming-delta
 * tests above are stateless and can keep sharing `fakeSession`.
 */
let sessionCounter = 0;
function makeSession(): Parameters<typeof handleSessionEvent>[1] {
  sessionCounter += 1;
  return { sessionId: `01a06cd9-test-${sessionCounter}` } as unknown as Parameters<typeof handleSessionEvent>[1];
}

describe("handleSessionEvent — streaming deltas", () => {
  it("emits pi://update with agent_message_chunk on text_delta", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, fakeSession, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" },
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("pi://update");
    // Phase R3.0 — content shape now uses `text_delta` (was `text`) so the
    // renderer can disambiguate deltas from start/end markers. The legacy
    // `{ type: "text" }` shape is still accepted by the coalescer's fallback
    // path for backward compatibility.
    expect(events[0].payload).toMatchObject({
      sessionId: "01a06cd9-test",
      type: "agent_message_chunk",
      content: [{ type: "text_delta", text: "hello" }],
    });
  });

  it("emits pi://update with agent_thought_chunk on thinking_delta", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, fakeSession, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "thinking..." },
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("pi://update");
    expect((events[0].payload as { type: string }).type).toBe("agent_thought_chunk");
    // Phase R3.0 — content shape uses `thinking_delta` (was `text`).
    expect(events[0].payload).toMatchObject({
      content: [{ type: "thinking_delta", text: "thinking..." }],
    });
  });

  it("emits pi://update with mapped tool_call on toolcall_end", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, fakeSession, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 1,
        toolCall: { type: "toolCall", id: "tc-1", name: "read", arguments: { path: "/tmp/a" } },
      },
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("pi://update");
    expect(events[0].payload).toEqual({
      sessionId: "01a06cd9-test",
      type: "tool_call",
      toolCallId: "tc-1",
      title: "read",
      kind: "read",
      status: "in_progress",
      content: [],
      rawInput: { path: "/tmp/a" },
    });
  });

  it("skips toolcall_end without a toolCall id (defensive)", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, fakeSession, {
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { name: "read" } },
    } as never);
    expect(events).toHaveLength(0);
  });

  // Phase R3.0 (pi-web-alignment) — verify every AssistantMessageEvent variant
  // that should now produce a pi://update emits one. The previous "no emit"
  // test was the regression guard; we now actively emit so the renderer can
  // drive block-level streaming duration, tool-call lifecycle, and error
  // surfacing.
  describe("Phase R3.0 — full AssistantMessageEvent surface", () => {
    it("emits text_start with block id", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: { type: "text_start", contentIndex: 0, id: "blk-1" },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].channel).toBe("pi://update");
      expect(events[0].payload).toMatchObject({
        type: "agent_message_chunk",
        content: [{ type: "text_start", id: "blk-1", contentIndex: 0 }],
      });
    });

    it("emits text_end with finalized content", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: { type: "text_end", contentIndex: 0, id: "blk-1", content: "hello world" },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "agent_message_chunk",
        content: [{ type: "text_end", content: "hello world", id: "blk-1", contentIndex: 0 }],
      });
    });

    it("emits thinking_start with block id", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_start", contentIndex: 1, id: "think-1" },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "agent_thought_chunk",
        content: [{ type: "thinking_start", id: "think-1", contentIndex: 1 }],
      });
    });

    it("emits thinking_end with deferred flag for lazy-loading", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end", contentIndex: 1, id: "think-1", content: "...", deferred: true },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "agent_thought_chunk",
        content: [{ type: "thinking_end", content: "...", id: "think-1", contentIndex: 1, deferred: true }],
      });
    });

    it("emits toolcall_start at the beginning of a tool-call block", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 2,
          toolCall: { type: "toolCall", id: "tc-2", name: "bash" },
        },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "tool_call",
        toolCallId: "tc-2",
        title: "bash",
        kind: "bash",
        status: "in_progress",
      });
    });

    it("emits toolcall_delta as tool_call_update with partial args", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 2,
          toolCall: { type: "toolCall", id: "tc-2", name: "bash", arguments: { cmd: "ls " } },
        },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "tool_call_update",
        toolCallId: "tc-2",
        update: { partial: true, partialResult: { cmd: "ls " } },
      });
    });

    it("emits done with extracted usage", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: {
          type: "done",
          reason: "stop",
          message: { usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
        },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "usage_update",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        reason: "stop",
      });
    });

    it("emits error with provider errorMessage + routes through turn/error", () => {
      const { deps, events, pluginEvents } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: {
          type: "error",
          reason: "error",
          errorMessage: "rate limit exceeded",
        },
      } as never);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "usage_update",
        usage: {},
        errorMessage: "rate limit exceeded",
        reason: "error",
      });
      const turnError = pluginEvents.find((e) => e.channel === "turn/error");
      expect(turnError).toBeTruthy();
      expect(turnError?.payload).toMatchObject({ kind: "error", detail: "rate limit exceeded" });
    });

    it("does not emit for lifecycle-only `start` variant", () => {
      const { deps, events } = makeDeps();
      handleSessionEvent(deps, fakeSession, {
        type: "message_update",
        assistantMessageEvent: { type: "start" },
      } as never);
      expect(events).toHaveLength(0);
    });
  });
});

describe("handleSessionEvent — turn completion", () => {
  it("emits pi://complete on turn_end with stopReason from message", () => {
    const { deps, events } = makeDeps();
    const session = makeSession();
    handleSessionEvent(deps, session, {
      type: "turn_end",
      message: { stopReason: "toolUse" },
      toolResults: [],
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("pi://complete");
    expect(events[0].payload).toEqual({
      sessionId: session.sessionId,
      promptId: "",
      stopReason: "toolUse",
    });
  });

  it("emits pi://complete on agent_end as a safety net", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, makeSession(), { type: "agent_end", messages: [] } as never);
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("pi://complete");
    expect((events[0].payload as { stopReason: string }).stopReason).toBe("end_turn");
  });

  it("emits pi://complete on agent_settled with the final stopReason", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, makeSession(), { type: "agent_settled", message: { stopReason: "error" } } as never);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { stopReason: string }).stopReason).toBe("error");
  });

  it("falls back to end_turn when message is missing", () => {
    const { deps, events } = makeDeps();
    handleSessionEvent(deps, makeSession(), { type: "turn_end" } as never);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { stopReason: string }).stopReason).toBe("end_turn");
  });

  /**
   * The regression this dedupe exists for.
   *
   * Pi emits all three terminal events for a single prompt. Mapping each to
   * `pi://complete` gave the renderer four completes per turn (this bridge's
   * three plus a fourth that used to be emitted from `ipc/index.ts` on
   * `agent_end`). Every `onComplete` side effect is once-per-turn, so usage
   * accounting quadrupled, four duplicate desktop notifications fired, and the
   * message queue could release four queued prompts for one finished turn.
   *
   * Sequence below is the real one captured against MiniMax-M3.
   */
  it("emits exactly one pi://complete for a full agent_start → agent_settled run", () => {
    const { deps, events } = makeDeps();
    const session = makeSession();
    for (const event of [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "DIAG-OK" } },
      { type: "turn_end", message: { stopReason: "stop" } },
      { type: "agent_end", messages: [] },
      { type: "agent_settled", message: { stopReason: "end_turn" } },
    ]) {
      handleSessionEvent(deps, session, event as never);
    }
    const completes = events.filter((e) => e.channel === "pi://complete");
    expect(completes).toHaveLength(1);
    expect((completes[0].payload as { stopReason: string }).stopReason).toBe("stop");
  });

  it("emits one pi://complete per turn across a multi-turn tool-use run", () => {
    const { deps, events } = makeDeps();
    const session = makeSession();
    for (const event of [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "turn_end", message: { stopReason: "toolUse" } },
      // Tool round-trip, then the model takes a second turn.
      { type: "turn_start" },
      { type: "turn_end", message: { stopReason: "stop" } },
      { type: "agent_end", messages: [] },
      { type: "agent_settled", message: { stopReason: "end_turn" } },
    ]) {
      handleSessionEvent(deps, session, event as never);
    }
    const completes = events.filter((e) => e.channel === "pi://complete");
    expect(completes.map((e) => (e.payload as { stopReason: string }).stopReason)).toEqual([
      "toolUse",
      "stop",
    ]);
  });

  it("still emits a terminal complete when a run aborts without turn_end", () => {
    const { deps, events } = makeDeps();
    const session = makeSession();
    for (const event of [
      { type: "agent_start" },
      { type: "agent_end", messages: [] },
      { type: "agent_settled", message: { stopReason: "aborted" } },
    ]) {
      handleSessionEvent(deps, session, event as never);
    }
    const completes = events.filter((e) => e.channel === "pi://complete");
    expect(completes).toHaveLength(1);
    expect((completes[0].payload as { stopReason: string }).stopReason).toBe("end_turn");
  });
});

describe("buildSessionEventSubscriber", () => {
  it("is a stable wrapper that routes through handleSessionEvent", () => {
    const { deps, events } = makeDeps();
    const subscriber = buildSessionEventSubscriber(deps);
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } } as never, fakeSession);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { content: Array<{ text: string }> }).content[0].text).toBe("x");
  });
});
