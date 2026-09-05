import { describe, expect, it, vi } from "vitest";
import { emitContextEvent, emitPiSessionEvent } from "./pi-event-bridge";

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
