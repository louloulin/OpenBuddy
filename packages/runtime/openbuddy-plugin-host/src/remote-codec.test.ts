import { describe, expect, it } from "vitest";
import { parseRemoteCodec, serializeRemoteCodec, validateRemoteCodec } from "./remote-codec";

describe("Remote codec", () => {
  it("validates nested object and union schemas", () => {
    const codec = validateRemoteCodec({
      mode: "strict",
      typeSymbol: "fixture/Request",
      schema: {
        type: "object",
        properties: {
          id: { schema: { type: "string" } },
          mode: { schema: { type: "union", anyOf: [{ type: "literal", value: "fast" }, { type: "literal", value: "safe" }] } },
          tags: { optional: true, schema: { type: "array", items: { type: "string" } } },
        },
      },
    });
    expect(parseRemoteCodec(codec, { id: "a", mode: "fast" })).toEqual({ id: "a", mode: "fast" });
    expect(() => parseRemoteCodec(codec, { id: "a", mode: "unsafe" })).toThrow("mode");
    expect(() => parseRemoteCodec(codec, { id: "a", mode: "fast", extra: true })).toThrow("unexpected property");
  });

  it("supports explicit additional properties and source-json fallback", () => {
    const strict = validateRemoteCodec({
      mode: "strict",
      typeSymbol: "fixture/Map",
      schema: { type: "object", additionalProperties: true, properties: {} },
    });
    expect(parseRemoteCodec(strict, { value: 1 })).toEqual({ value: 1 });
    const legacy = validateRemoteCodec({ mode: "src-json" });
    const value = { arbitrary: [1, 2, 3] };
    expect(parseRemoteCodec(legacy, value)).toBe(value);
  });

  it("rejects malformed codec declarations", () => {
    expect(() => validateRemoteCodec({ mode: "strict", typeSymbol: "fixture/Bad", schema: { type: "unsupported" } })).toThrow("unsupported");
    expect(() => validateRemoteCodec({ mode: "strict", typeSymbol: "fixture/Bad", schema: { type: "union", anyOf: [] } })).toThrow("anyOf");
  });

  it("serializes generated Zod v4 codecs without sending runtime schema objects", async () => {
    const { z } = await import("../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js");
    const codec = serializeRemoteCodec({
      mode: "strict",
      typeSymbol: "@fixture/remote/types#Request",
      schema: z.object({
        title: z.string(),
        count: z.number().int().optional(),
        tags: z.array(z.string()).readonly(),
        readonlyTitle: z.string().readonly(),
        state: z.enum(["draft", "ready"]),
      }),
    });
    expect(codec).toEqual({
      mode: "strict",
      typeSymbol: "@fixture/remote/types#Request",
      schema: {
        type: "object",
        properties: {
          title: { schema: { type: "string" } },
          count: { schema: { type: "integer" }, optional: true },
          tags: { schema: { type: "array", items: { type: "string" } } },
          readonlyTitle: { schema: { type: "string" } },
          state: { schema: { type: "union", anyOf: [{ type: "literal", value: "draft" }, { type: "literal", value: "ready" }] } },
        },
      },
    });
    expect(parseRemoteCodec(codec, { title: "x", tags: ["a"], readonlyTitle: "r", state: "ready" })).toEqual({ title: "x", tags: ["a"], readonlyTitle: "r", state: "ready" });
    expect(() => parseRemoteCodec(codec, { title: "x", count: 1.5, tags: [], state: "ready" })).toThrow("count");
  });

  it("rejects generated runtime schemas that cannot preserve wire semantics", async () => {
    const { z } = await import("../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js");
    expect(() => serializeRemoteCodec({ mode: "strict", typeSymbol: "fixture/Date", schema: z.date() })).toThrow("unsupported Zod type date");
  });

  it("expands lazy schemas and bounds recursive lazy schemas", async () => {
    const { z } = await import("../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js");
    const lazy = z.lazy(() => z.object({ value: z.string() }));
    expect(serializeRemoteCodec({ mode: "strict", typeSymbol: "fixture/Lazy", schema: z.array(lazy) })).toMatchObject({
      schema: { type: "array", items: { type: "object", properties: { value: { schema: { type: "string" } } } } },
    });
    const recursive: any = z.lazy(() => z.object({ next: z.optional(recursive) }));
    const codec = serializeRemoteCodec({ mode: "strict", typeSymbol: "fixture/Recursive", schema: recursive });
    expect(codec).toMatchObject({ schema: { type: "object", properties: { next: { optional: true, schema: { type: "unknown" } } } } });
  });
});
