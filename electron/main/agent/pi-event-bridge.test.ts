import { describe, expect, it, vi } from "vitest";
import { emitContextEvent, emitPiSessionEvent, PiSessionEventBridge } from "./pi-event-bridge";

describe("Pi Cordis event bridge", () => {
  it("preserves DeepSeek session/event's two-argument shape", () => {
    const emit = vi.fn();
    const session = { sessionId: "session-1" };
    const event = { type: "turn_start", turn: 1 };

    emitPiSessionEvent({ emit }, session, event);

    expect(emit).toHaveBeenNthCalledWith(1, "session/event", session, event);
    expect(emit).toHaveBeenNthCalledWith(2, "pi/turn_start", event);
  });

  it("isolates a throwing Cordis listener and reports the event", () => {
    const onError = vi.fn();
    const emit = vi.fn(() => { throw new Error("listener failed"); });

    expect(() => emitContextEvent({ emit }, "session/event", [], undefined, onError)).not.toThrow();
    expect(onError).toHaveBeenCalledWith("session/event", expect.any(Error));
  });

  it("does nothing when the context is not available during teardown", () => {
    expect(() => emitContextEvent(undefined, "pi/dispose", [])).not.toThrow();
  });
});

describe("PiSessionEventBridge plugin/extension event indexing (phase 4)", () => {
  it("indexes plugin lifecycle events and replays them via snapshot", () => {
    const bridge = new PiSessionEventBridge();
    bridge.append({
      eventVersion: 1,
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "plugin/loaded",
      payload: { id: "pi-goal-list-loop-audit", name: "goal loop audit" },
    });
    bridge.append({
      eventVersion: 1,
      sequence: 2,
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "plugin/failed",
      payload: { id: "broken-plugin", error: "boom" },
    });

    const snapshot = bridge.snapshot();
    expect(snapshot.map((e) => e.type)).toEqual(["plugin/loaded", "plugin/failed"]);
    expect(snapshot[0]!.payload).toEqual({ id: "pi-goal-list-loop-audit", name: "goal loop audit" });
    expect(bridge.lastSequence()).toBe(2);
  });

  it("drops stale-generation events after a reload", () => {
    const bridge = new PiSessionEventBridge();
    const oldGeneration = bridge.generation();
    bridge.append({
      eventVersion: 1,
      generation: oldGeneration,
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "plugin/old",
      payload: {},
    });
    expect(bridge.advanceGeneration()).toBe(1);
    bridge.append({
      eventVersion: 1,
      generation: oldGeneration,
      sequence: 2,
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "plugin/stale",
      payload: {},
    });
    bridge.append({
      eventVersion: 1,
      generation: bridge.generation(),
      sequence: 3,
      timestamp: "2026-01-01T00:00:02.000Z",
      type: "plugin/current",
      payload: {},
    });
    expect(bridge.snapshot().map((event) => event.type)).toEqual(["plugin/current"]);
  });
  it("indexes session-scoped events and filters by sessionId", () => {
    const bridge = new PiSessionEventBridge();
    bridge.appendFromSession({ type: "session/start", sessionId: "s1" });
    bridge.appendFromSession({ type: "session/start", sessionId: "s2" });

    const s1 = bridge.snapshot({ sessionId: "s1" });
    expect(s1).toHaveLength(1);
    expect(s1[0]!.sessionId).toBe("s1");
    expect(bridge.snapshot()).toHaveLength(2);
  });

  it("coalesces reconstructable Pi tool progress until snapshot delivery", () => {
    const bridge = new PiSessionEventBridge();
    bridge.appendFromSession({ type: "tool_execution_update", sessionId: "s1", partialResult: "first" });
    bridge.appendFromSession({ type: "tool_execution_update", sessionId: "s1", partialResult: "latest" });
    expect(bridge.snapshot({ sessionId: "s1" }).map((entry) => (entry.payload as { partialResult?: string }).partialResult)).toEqual(["latest"]);
  });
  it("bounded ring buffer drops oldest entries beyond maxEntries", () => {
    const bridge = new PiSessionEventBridge({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      bridge.appendFromSession({ type: "agent/start", sessionId: `s${i}` });
    }
    const snapshot = bridge.snapshot();
    expect(snapshot).toHaveLength(3);
    expect(snapshot[0]!.sessionId).toBe("s2");
    expect(snapshot[2]!.sessionId).toBe("s4");
  });

  it("snapshot supports sinceSequence and limit queries", () => {
    const bridge = new PiSessionEventBridge();
    for (let i = 0; i < 5; i++) bridge.appendFromSession({ type: "agent/start" });
    const after = bridge.snapshot({ sinceSequence: 2, limit: 2 });
    expect(after.map((e) => e.sequence)).toEqual([4, 5]);
  });

  it("describeCursor reports earliest/latest sequence and current generation", () => {
    const bridge = new PiSessionEventBridge({ maxEntries: 4 });
    for (let i = 0; i < 6; i++) bridge.appendFromSession({ type: "agent/start", sessionId: "s1" });
    const cursor = bridge.describeCursor({ sessionId: "s1" });
    expect(cursor.earliestSequence).toBe(3);
    expect(cursor.latestSequence).toBe(6);
    expect(cursor.available).toBe(4);
    expect(cursor.generation).toBe(0);
  });

  it("describeCursor returns zero values when the bridge is empty", () => {
    const bridge = new PiSessionEventBridge();
    expect(bridge.describeCursor({ sessionId: "missing" })).toEqual({
      earliestSequence: 0,
      latestSequence: 0,
      generation: 0,
      available: 0,
    });
  });

  it("describeCursor scopes earliest/latest to the requested session", () => {
    const bridge = new PiSessionEventBridge();
    bridge.appendFromSession({ type: "agent/start", sessionId: "s1" });
    bridge.appendFromSession({ type: "agent/start", sessionId: "s2" });
    bridge.appendFromSession({ type: "agent/start", sessionId: "s1" });
    const s1 = bridge.describeCursor({ sessionId: "s1" });
    expect(s1.earliestSequence).toBe(1);
    expect(s1.latestSequence).toBe(3);
    expect(s1.available).toBe(2);
  });
});
