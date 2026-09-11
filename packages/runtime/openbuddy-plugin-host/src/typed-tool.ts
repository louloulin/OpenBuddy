/**
 * @openbuddy/plugin-host — pi-native typed tool facade (G1 PR 1).
 *
 * Wraps pi's `defineTool` + `ToolDefinition` so extension authors can
 * register LLM-callable tools with end-to-end type safety (no
 * `(params as { ... })` casts) without taking on a hard dependency
 * on `@earendil-works/pi-coding-agent` or on `@sinclair/typebox`.
 *
 * The facadditive pattern mirrors G11 (plugin-sdk) / G6 (ui-theme) /
 * G9 (resource-pi): this file adds new capability; existing
 * `extensions/apply-patch.ts` (228 LOC) is intentionally untouched.
 * A future G1 PR 2 will rewrite `apply_patch` / `apply_command`
 * to use this facade directly.
 *
 * Spec note (Round 13 audit): the G1 spec assumed `apply-patch.ts`
 * was using a non-pi custom tool registration and that switching to
 * a "pi tool-factory" would replace ~150 LOC. Reality: `apply-patch.ts`
 * already uses pi's `ExtensionFactory` + `api.registerTool` (228 LOC);
 * pi's `defineTool` is a typed-identity helper, not a registration
 * helper. The actual simplification is replacing the manual
 * `(params as { ... })` casts with `defineTool<TParams>({ ... })`,
 * which removes ~30 LOC of unsafe casts without touching runtime.
 */
import {
  defineTool as piDefineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema, Static } from "typebox";
import { Check, Errors } from "typebox/value";

/** Re-export pi's typed identity helper so callers do not need pi directly. */
export const defineTool = piDefineTool;

/** Re-export pi's tool definition shape. */
export type { ToolDefinition };

/** Re-export typebox primitives so callers can build JSON schemas without
 *  pulling typebox into their own dependency closure. */
export type { TSchema, Static };

/**
 * Convenience helper — wrap a TypeBox `TSchema` into the `parameters`
 * field of a `ToolDefinition`. Pi accepts the schema as-is, but using
 * `Static<TSchema>` to derive the `TParams` type keeps the tool's
 * `execute` callback end-to-end typed without a cast.
 *
 * Usage:
 * ```ts
 * const myTool = defineTool({
 *   name: "echo",
 *   label: "Echo",
 *   description: "Echoes the input",
 *   parameters: objectParams(Type.Object({
 *     text: Type.String({ description: "Text to echo" }),
 *   })),
 *   execute: async (_id, params, _signal, _onUpdate, _ctx) => {
 *     // params is typed as { text: string } here, no cast needed.
 *     return { content: [{ type: "text", text: params.text }] };
 *   },
 * });
 * ```
 */
export function objectParams<T extends TSchema>(schema: T): T {
  // Pi expects the JSON-schema object directly; typebox's Type.Object
  // returns a `TSchema` that is structurally compatible. This helper
  // exists only to make the call-site read like a schema declaration.
  return schema;
}

/**
 * Convenience type — infer the parameter shape from a TypeBox schema so
 * extension authors do not have to repeat the shape. Mirrors pi's
 * `defineTool<TParams>(...)` parameter inference.
 *
 * Usage:
 * ```ts
 * const MySchema = Type.Object({ count: Type.Number() });
 * type MyParams = InferParams<typeof MySchema>; // { count: number }
 * ```
 */
export type InferParams<S extends TSchema> = Static<S>;

/**
 * Runtime guard — TypeBox `Value.Check` for tool params. Returns `null`
 * on success or a human-readable error message on failure. This is the
 * runtime companion to the compile-time safety that `defineTool<TSchema>`
 * provides: LLMs can send anything, so the tool body still needs to
 * defend against malformed params before dereferencing fields.
 *
 * Usage:
 * ```ts
 * execute: async (_id, params) => {
 *   const err = validateParams(MySchema, params);
 *   if (err) return fail(err);
 *   // params is now safe to dereference as { count: number }
 *   return { content: [{ type: "text", text: String(params.count) }] };
 * }
 * ```
 */
export function validateParams<S extends TSchema>(
  schema: S,
  params: unknown,
): string | null {
  if (Check(schema, params)) return null;
  const errors = [...Errors(schema, params)];
  if (errors.length === 0) return "params did not match schema";
  return (
    "invalid params: " +
    errors
      .map((e) => `${e.instancePath || "/"}: ${e.message}`)
      .join("; ")
  );
}
