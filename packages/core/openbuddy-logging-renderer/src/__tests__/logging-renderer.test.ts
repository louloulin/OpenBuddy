import { describe, expect, it } from "vitest";
import { createRendererLogger, withTrace, generateTrace } from "../index";

describe("@openbuddy/logging-renderer", () => {
  it("propagates traceId to nested children", () => {
    const logger = createRendererLogger({ name: "test", baseContext: { scope: "renderer:app" } });
    const traced = withTrace(logger, "trace-xyz");
    expect(traced.context.traceId).toBe("trace-xyz");
    expect(traced.context.scope).toBe("renderer:app");
  });

  it("child logger merges context without losing parent fields", () => {
    const logger = createRendererLogger({ name: "test", baseContext: { scope: "renderer:app", sessionId: "abc" } });
    const child = logger.child({ traceId: "trace-1", sessionId: "xyz" });
    expect(child.context.scope).toBe("renderer:app");
    expect(child.context.sessionId).toBe("xyz");
    expect(child.context.traceId).toBe("trace-1");
  });

  it("generateTrace produces a UUID-shaped string", () => {
    expect(generateTrace()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("every level method is callable without throwing", () => {
    const logger = createRendererLogger({ name: "test" });
    expect(() => logger.debug("d")).not.toThrow();
    expect(() => logger.info("i")).not.toThrow();
    expect(() => logger.warn("w")).not.toThrow();
    expect(() => logger.error("e")).not.toThrow();
    expect(() => logger.fatal("f")).not.toThrow();
    expect(() => logger.debug("d", { traceId: "t" })).not.toThrow();
    expect(() => logger.info("i", { scope: "renderer:app" })).not.toThrow();
    expect(() => logger.error("e", { code: "boom" })).not.toThrow();
  });
});
