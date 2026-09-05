import { describe, expect, it } from "vitest";
import {
  currentTraceContext,
  currentTraceId,
  deriveTraceContext,
  mintTraceContext,
  parseTraceparent,
  withChildSpan,
  withTrace,
} from "./trace";

describe("W3C traceparent helpers", () => {
  it("parses a well-formed traceparent header", () => {
    const value = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const context = parseTraceparent(value);
    expect(context).toMatchObject({
      version: "00",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      flags: "01",
      sampled: true,
      remote: true,
    });
    expect(context?.raw).toBe(value);
  });

  it("rejects malformed or all-zero traceparent headers", () => {
    expect(parseTraceparent("not a real header")).toBeNull();
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeNull();
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01")).toBeNull();
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-zz")).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(["", ""])).toBeNull();
  });

  it("mints a fresh trace context when no header is supplied", () => {
    const a = mintTraceContext();
    const b = mintTraceContext();
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.sampled).toBe(false);
  });

  it("derives a context from headers when present, otherwise mints one", () => {
    const fromHeader = deriveTraceContext({ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" }, true);
    expect(fromHeader.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(fromHeader.sampled).toBe(true);
    const fromMissing = deriveTraceContext({}, true);
    expect(fromMissing.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(fromMissing.sampled).toBe(true);
  });

  it("preserves trace context across AsyncLocalStorage boundaries", () => {
    const context = mintTraceContext(true);
    let captured: string | undefined;
    withTrace(context, async () => {
      captured = currentTraceId();
      await Promise.resolve();
      expect(currentTraceContext()).toMatchObject({ traceId: context.traceId });
    });
    expect(captured).toBe(context.traceId);
    expect(currentTraceId()).toBeUndefined();
  });

  it("creates child spans under the same trace", () => {
    const context = mintTraceContext();
    const child = withChildSpan(context, undefined, true);
    expect(child.traceId).toBe(context.traceId);
    expect(child.spanId).not.toBe(context.spanId);
    expect(child.sampled).toBe(true);
  });
});
