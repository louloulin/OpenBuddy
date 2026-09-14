import { describe, expect, it, vi } from "vitest";
import {
  createTruncationAccumulator,
  type TruncationPluginEvent,
} from "./truncation-accumulator";

function makeEvent(type: string, payload: unknown, timestamp: string): TruncationPluginEvent {
  return { type, payload, timestamp };
}

describe("truncation-accumulator (plan4.4 §C — renderer subscription)", () => {
  it("ignores events whose type is not session/input-truncated", () => {
    const accumulator = createTruncationAccumulator();
    accumulator.handle(
      makeEvent("session/info_changed", { some: "other payload" }, "2026-09-13T00:00:00.000Z"),
    );
    accumulator.handle(
      makeEvent("tool/start", { toolName: "edit" }, "2026-09-13T00:00:01.000Z"),
    );
    expect(accumulator.snapshot()).toEqual([]);
    expect(accumulator.summary().events).toBe(0);
  });

  it("captures valid truncation events into the log", () => {
    const accumulator = createTruncationAccumulator();
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    const events = accumulator.snapshot();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sessionId: "s1", dropped: 5, totalChars: 30_000 });
  });

  it("drops malformed payloads (defensive)", () => {
    const accumulator = createTruncationAccumulator();
    accumulator.handle(makeEvent("session/input-truncated", null, "2026-09-13T00:00:00.000Z"));
    accumulator.handle(makeEvent("session/input-truncated", {}, "2026-09-13T00:00:00.000Z"));
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: -1, totalChars: 0, budget: { maxChars: 1, keepFirst: 0, keepLast: 0 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    expect(accumulator.snapshot()).toEqual([]);
  });

  it("summary aggregates events correctly", () => {
    const accumulator = createTruncationAccumulator();
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s2", dropped: 8, totalChars: 40_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:01.000Z",
      ),
    );
    const summary = accumulator.summary();
    expect(summary.events).toBe(2);
    expect(summary.dropped).toBe(13);
    expect(summary.totalChars).toBe(70_000);
    expect(summary.affectedSessions).toBe(2);
  });

  it("clear() resets the log", () => {
    const accumulator = createTruncationAccumulator();
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    expect(accumulator.snapshot()).toHaveLength(1);
    accumulator.clear();
    expect(accumulator.snapshot()).toEqual([]);
    expect(accumulator.summary().events).toBe(0);
  });

  it("subscribe returns an unlisten function that detaches the handler", () => {
    const handler = vi.fn();
    const accumulator = createTruncationAccumulator();
    const unlisten = accumulator.subscribe(handler);
    expect(typeof unlisten).toBe("function");
    handler.mockClear();
    unlisten();
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    // The handler should NOT have been called because we already unsubscribed.
    expect(handler).not.toHaveBeenCalled();
    // But the accumulator still keeps its own log.
    expect(accumulator.snapshot()).toHaveLength(1);
  });

  it("subscribe forwards parsed events to the listener in arrival order", () => {
    const handler = vi.fn();
    const accumulator = createTruncationAccumulator();
    accumulator.subscribe(handler);
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:00.000Z",
      ),
    );
    accumulator.handle(
      makeEvent(
        "session/input-truncated",
        { sessionId: "s2", dropped: 8, totalChars: 40_000, budget: { maxChars: 24_000, keepFirst: 4, keepLast: 4 } },
        "2026-09-13T00:00:01.000Z",
      ),
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0].sessionId).toBe("s1");
    expect(handler.mock.calls[1][0].sessionId).toBe("s2");
  });

  it("does not forward malformed events to subscribers", () => {
    const handler = vi.fn();
    const accumulator = createTruncationAccumulator();
    accumulator.subscribe(handler);
    accumulator.handle(makeEvent("session/input-truncated", null, "2026-09-13T00:00:00.000Z"));
    accumulator.handle(makeEvent("session/input-truncated", {}, "2026-09-13T00:00:00.000Z"));
    expect(handler).not.toHaveBeenCalled();
  });
});