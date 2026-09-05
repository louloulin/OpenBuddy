import { describe, expect, it, vi } from "vitest";
import { createMainLogger, ensureTrace, withContext } from "../index.js";

describe("@openbuddy/logging-main", () => {
  it("createMainLogger respects explicit level", () => {
    const log = createMainLogger({ filePath: "", level: "warn", serviceName: "test" });
    expect(log.level).toBe("warn");
  });

  it("createMainLogger reads OPENBUDDY_LOG_LEVEL env", () => {
    process.env.OPENBUDDY_LOG_LEVEL = "debug";
    try {
      const log = createMainLogger({ filePath: "" });
      expect(log.level).toBe("debug");
    } finally {
      delete process.env.OPENBUDDY_LOG_LEVEL;
    }
  });

  it("withContext creates a child that carries traceId and sessionId", () => {
    const log = createMainLogger({ filePath: "", level: "debug", serviceName: "test" });
    const child = withContext(log, { traceId: "trace-1", sessionId: "sess-1" });
    // pino's `child()` returns a new logger instance, so the spy must be
    // installed on the child — spying on the parent would never see the
    // call because parent.info and child.info are distinct functions.
    const spy = vi.spyOn(child, "info");
    child.info({ msg: "agent.prompt.received", textLength: 42 }, "agent.prompt.received");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    expect(call).toBeDefined();
    // pino stores child bindings (traceId / sessionId) on the child itself,
    // not on the first argument of .info(). Verify via child.bindings() that
    // the context propagated, and via the call args that the message body
    // arrived unchanged.
    const bindings = child.bindings();
    expect(bindings.traceId).toBe("trace-1");
    expect(bindings.sessionId).toBe("sess-1");
    const payload = call![0] as { msg?: string; textLength?: number };
    expect(payload.msg).toBe("agent.prompt.received");
    expect(payload.textLength).toBe(42);
  });

  it("ensureTrace fills missing traceId", () => {
    const ctx1 = ensureTrace({});
    expect(typeof ctx1.traceId).toBe("string");
    expect(ctx1.traceId.length).toBeGreaterThan(0);
    const ctx2 = ensureTrace({ traceId: "fixed" });
    expect(ctx2.traceId).toBe("fixed");
  });
});
