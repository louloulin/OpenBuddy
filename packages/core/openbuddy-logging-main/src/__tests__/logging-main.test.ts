import { describe, expect, it } from "vitest";
import pino from "pino";
import { withContext } from "../index";

function createSink() {
  const target: Array<Record<string, unknown>> = [];
  const sink = pino({ level: "info", base: { service: "test" } }, { write: (line) => target.push(JSON.parse(line)) });
  return { sink, target };
}

describe("@openbuddy/logging-main", () => {
  it("withContext propagates scope, traceId, sessionId via child logger", () => {
    const { sink, target } = createSink();
    const traced = withContext(sink, { scope: "agent-host", traceId: "trace-123", sessionId: "session-abc" });
    traced.info("prompt received");
    const entry = target[0];
    expect(entry).toBeDefined();
    expect(entry?.msg).toBe("prompt received");
    expect(entry?.scope).toBe("agent-host");
    expect(entry?.traceId).toBe("trace-123");
    expect(entry?.sessionId).toBe("session-abc");
  });

  it("withContext filters undefined values from the child bindings", () => {
    const { sink, target } = createSink();
    const traced = withContext(sink, { scope: "agent-host", traceId: undefined, sessionId: undefined });
    traced.info("ok");
    const entry = target[0];
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("traceId");
    expect(entry).not.toHaveProperty("sessionId");
    expect(entry?.scope).toBe("agent-host");
  });

  it("child logger can attach textLength via structured payload", () => {
    const { sink, target } = createSink();
    const traced = withContext(sink, { scope: "agent-host", traceId: "t-1", sessionId: "s-1" });
    traced.info({ textLength: 42, msg: "prompt received" });
    const entry = target[0];
    expect(entry?.textLength).toBe(42);
    expect(entry?.traceId).toBe("t-1");
  });
});
