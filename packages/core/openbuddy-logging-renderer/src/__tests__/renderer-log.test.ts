import { describe, expect, it } from "vitest";
import {
  createRendererLogger,
  withContext,
  withTrace,
} from "../index.js";

describe("@openbuddy/logging-renderer", () => {
  it("createRendererLogger returns a usable logger", () => {
    const log = createRendererLogger({ devMode: false, name: "test" });
    expect(log.scope).toBe("test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("withContext returns a child whose context carries traceId", () => {
    const log = createRendererLogger({ devMode: false });
    const child = withContext(log, { traceId: "abc-123" });
    expect(child.context.traceId).toBe("abc-123");
  });

  it("withTrace is sugar for withContext with traceId", () => {
    const log = createRendererLogger({ devMode: false });
    const child = withTrace(log, "xyz-789");
    expect(child.context.traceId).toBe("xyz-789");
  });

  it("child context overrides parent without mutating parent", () => {
    const log = createRendererLogger({ devMode: false, name: "scope", baseContext: { scope: "parent" } });
    const child = withContext(log, { traceId: "abc" });
    expect(child.context.traceId).toBe("abc");
    expect(child.context.scope).toBe("parent");
    // Parent context should not be mutated.
    expect(log.context.traceId).toBeUndefined();
  });

  it("info/warn/error call sites accept override context", () => {
    const log = createRendererLogger({ devMode: false, name: "test" });
    expect(() => log.info("hello", { extra: 1 })).not.toThrow();
    expect(() => log.error("oops", { errorName: "Test" })).not.toThrow();
  });
});
