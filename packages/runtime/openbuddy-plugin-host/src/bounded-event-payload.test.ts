import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_PAYLOAD_MAX_BYTES, boundEventPayload } from "./bounded-event-payload";

describe("boundEventPayload", () => {
  it("detaches payloads and preserves small JSON values", () => {
    const source = { nested: { value: "ok" } };
    const result = boundEventPayload(source);

    expect(result).toMatchObject({ truncated: false });
    expect(result.value).toEqual(source);
    expect(result.value).not.toBe(source);
    expect((result.value as { nested: object }).nested).not.toBe(source.nested);
  });

  it("truncates large strings within the configured byte budget", () => {
    const result = boundEventPayload({ text: "😀".repeat(100) }, { maxBytes: 64 });
    const serialized = JSON.stringify(result.value);

    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(64);
    expect(serialized).toContain("[truncated]");
  });

  it("handles cycles, bigint and binary values without throwing", () => {
    const cyclic: Record<string, unknown> = { bigint: 12n, binary: new Uint8Array([1, 2, 3]) };
    cyclic.self = cyclic;

    const result = boundEventPayload(cyclic, { maxBytes: 256 });

    expect(result.truncated).toBe(true);
    expect(() => JSON.stringify(result.value)).not.toThrow();
    expect(result.bytes).toBeLessThanOrEqual(256);
  });

  it("rejects invalid limits and uses the documented default", () => {
    expect(boundEventPayload("small").bytes).toBeLessThan(DEFAULT_EVENT_PAYLOAD_MAX_BYTES);
    expect(() => boundEventPayload("x", { maxBytes: 0 })).toThrow(/limit/);
    expect(() => boundEventPayload("x", { maxDepth: 0 })).toThrow(/limit/);
  });
});
