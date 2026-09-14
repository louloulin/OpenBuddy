import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindRendererEventEmitter,
  emitRendererEvent,
  registerLifecycleDefaultState,
} from "./lifecycle-public";

describe("renderer event replay records", () => {
  let unbind: (() => void) | undefined;

  afterEach(() => {
    unbind?.();
    unbind = undefined;
  });

  it("adds a global sequence and appends only replayable chat wire events", () => {
    const append = vi.fn();
    const state = {
      eventSequence: 40,
      sessionSequences: new Map<string, number>(),
      sessionEventLog: { append },
    };
    registerLifecycleDefaultState(state as never);
    const sink = vi.fn();
    unbind = bindRendererEventEmitter(sink);

    emitRendererEvent("pi://update", {
      sessionId: "session-1",
      type: "agent_message_chunk",
      content: [],
    });
    emitRendererEvent("pi://complete", {
      sessionId: "session-1",
      promptId: "",
      stopReason: "stop",
    });
    emitRendererEvent("pi://summary", { sessionId: "session-1", title: "ignored" });

    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map(([record]) => record.sequence)).toEqual([41, 42]);
    expect(append.mock.calls[0][0]).toMatchObject({
      type: "renderer/pi://update",
      sessionId: "session-1",
      sessionSequence: 1,
    });
    expect(append.mock.calls[1][0]).toMatchObject({
      type: "renderer/pi://complete",
      sessionId: "session-1",
      sessionSequence: 2,
    });
    expect(sink.mock.calls[0][1]).toMatchObject({ sequence: 41, sessionSequence: 1 });
    expect(state.eventSequence).toBe(42);
  });
});
