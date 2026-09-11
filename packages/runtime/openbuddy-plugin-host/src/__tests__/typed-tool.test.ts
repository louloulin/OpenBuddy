/**
 * @openbuddy/plugin-host — tests for the pi typed-tool facade (G1 PR 1).
 *
 * Verifies that:
 *  - `defineTool` is the same identity helper pi exports
 *  - `ToolDefinition` and `TSchema` flow through unchanged
 *  - `objectParams(schema)` returns the schema unchanged (passthrough)
 *  - `InferParams<typeof X>` produces the expected TypeBox-derived type
 *
 * We do not exercise pi's `registerTool` runtime in these tests because
 * that requires a live agent session; the value of this PR is the
 * *type-level* guarantee, which the compile already enforces.
 */
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  defineTool,
  objectParams,
  validateParams,
  type ToolDefinition,
  type InferParams,
} from "../typed-tool";

describe("@openbuddy/plugin-host/typed-tool — pi facade", () => {
  it("defineTool is the same identity helper pi exports", () => {
    // defineTool is typed as `(tool) => tool & AnyToolDefinition` — a
    // no-op at runtime. Verify the identity by passing a literal in
    // and observing it comes back structurally equivalent.
    const out = defineTool({
      name: "echo",
      label: "Echo",
      description: "Echoes its input",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: params.text }],
        details: { echoed: params.text },
      }),
    });
    expect(out.name).toBe("echo");
    expect(typeof out.execute).toBe("function");
  });

  it("objectParams returns the schema unchanged", () => {
    const schema = Type.Object({ count: Type.Number() });
    const out = objectParams(schema);
    // identity check — pi uses the same schema reference at registration
    expect(out).toBe(schema);
  });

  it("InferParams derives the expected TypeBox shape", () => {
    // Compile-time guarantee: `params.text` is typed as `string`.
    const schema = Type.Object({
      text: Type.String({ description: "text to echo" }),
    });
    type Params = InferParams<typeof schema>;
    const sample: Params = { text: "hello" };
    expect(sample.text).toBe("hello");

    // A second schema with optional + boolean to verify union narrowing.
    const mixed = Type.Object({
      name: Type.String(),
      verbose: Type.Optional(Type.Boolean()),
    });
    type MixedParams = InferParams<typeof mixed>;
    const a: MixedParams = { name: "x" };
    const b: MixedParams = { name: "x", verbose: true };
    expect(a.name).toBe("x");
    expect(b.verbose).toBe(true);
  });

  it("ToolDefinition<TParams> propagates the schema into execute params", () => {
    // Compile-time check: this assignment must compile without a cast.
    const schema = Type.Object({ value: Type.Number() });
    const def: ToolDefinition<typeof schema> = {
      name: "compute",
      label: "Compute",
      description: "Echoes the numeric value",
      parameters: schema,
      execute: async (_id, params) => {
        // params is inferred as { value: number } — no cast needed.
        const doubled: number = params.value * 2;
        return {
          content: [{ type: "text" as const, text: String(doubled) }],
          details: { doubled },
        };
      },
    };
    expect(def.name).toBe("compute");
  });

  it("validateParams returns null on matching params", () => {
    const schema = Type.Object({ name: Type.String(), count: Type.Number() });
    expect(validateParams(schema, { name: "x", count: 3 })).toBeNull();
  });

  it("validateParams returns error on type mismatch", () => {
    const schema = Type.Object({ name: Type.String(), count: Type.Number() });
    const err = validateParams(schema, { name: "x", count: "not a number" });
    expect(err).not.toBeNull();
    expect(err).toMatch(/invalid params/);
  });
});