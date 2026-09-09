import { describe, expect, it } from "vitest";
import { EventEnvelopeBridge, isCurrentEventGeneration } from "./event-bridge";

describe("EventEnvelopeBridge", () => {
  it("assigns monotonic sequence and stable generation", () => {
    const bridge = new EventEnvelopeBridge({ generation: 4, now: () => "2026-09-09T16:00:00.000Z", id: () => "fixed" });
    expect(bridge.emit("agent/start", { ok: true }, { sessionId: "s1" })).toMatchObject({ sequence: 0, generation: 4, sessionId: "s1" });
    expect(bridge.emit("agent/end", null)).toMatchObject({ sequence: 1, generation: 4 });
    bridge.setGeneration(5);
    const next = bridge.emit("agent/start", {});
    expect(next).toMatchObject({ sequence: 2, generation: 5 });
    expect(isCurrentEventGeneration(next, 5)).toBe(true);
    expect(isCurrentEventGeneration(next, 4)).toBe(false);
  });
});
