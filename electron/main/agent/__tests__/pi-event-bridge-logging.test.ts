import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitContextEvent, emitPiSessionEvent } from "../pi-event-bridge";

const { debug, error, createMainLogger, withContext } = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  createMainLogger: vi.fn(),
  withContext: vi.fn((logger: unknown, context: unknown) => Object.assign({}, logger, { context })),
}));

vi.mock("@openbuddy/logging-main", () => ({
  createMainLogger,
  withContext,
}));

describe("Pi event bridge logging", () => {
  beforeEach(() => {
    debug.mockClear();
    error.mockClear();
    withContext.mockClear();
    createMainLogger.mockReset();
    createMainLogger.mockReturnValue({ debug, error });
  });

  it("propagates traceId into emitted payloads and successful logs", () => {
    const emit = vi.fn();
    const event = { type: "turn_start", turn: 1 };

    emitPiSessionEvent({ emit }, { sessionId: "session-1" }, event, "trace-1");

    expect(emit).toHaveBeenNthCalledWith(1, "session/event", { sessionId: "session-1" }, { ...event, traceId: "trace-1" });
    expect(emit).toHaveBeenNthCalledWith(2, "pi/turn_start", { ...event, traceId: "trace-1" });
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ msg: "bridge.emit.ok", argCount: 2 }), "emitted session/event");
    expect(withContext).toHaveBeenCalledWith(expect.anything(), { scope: "pi-event-bridge", eventName: "session/event", traceId: "trace-1" });
  });

  it("logs failed bridge emissions without swallowing listener errors", () => {
    const onError = vi.fn();
    const emit = vi.fn(() => { throw new Error("listener failed"); });

    expect(() => emitContextEvent({ emit }, "session/event", [{}], "trace-1", onError)).not.toThrow();
    expect(emit).toHaveBeenCalledWith("session/event", { traceId: "trace-1" });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ msg: "bridge.emit.failed" }), "emit failed for session/event");
    expect(withContext).toHaveBeenCalledWith(expect.anything(), { scope: "pi-event-bridge", eventName: "session/event", traceId: "trace-1" });
    expect(onError).toHaveBeenCalledWith("session/event", expect.any(Error));
  });
});
