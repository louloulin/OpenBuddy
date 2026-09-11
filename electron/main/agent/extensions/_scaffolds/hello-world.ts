/**
 * hello-world — minimal OpenBuddy pi extension scaffold (G10 PR 1).
 *
 * Copy this file, rename it, change the tool name + schema, and you have
 * a working LLM-callable tool. No unsafe casts, no module loader
 * boilerplate, no extra plumbing — `ExtensionFactory` (pi native) plus
 * `@openbuddy/plugin-host/typed-tool` is the entire surface.
 *
 * What this file demonstrates (in order):
 *   1. The single import you actually need (`@openbuddy/plugin-host`)
 *   2. A TypeBox schema + inferred param type
 *   3. `defineTool` (identity helper from pi) with `validateParamsSafe`
 *      user-defined type guard so the body has zero `as` casts
 *   4. A `default export ExtensionFactory` that `pi.registerTool`s the
 *      tool into the live pi agent
 *
 * Total LOC: ~50. To add a second tool: copy the `defineTool` block and
 * change `name` / `parameters` / `execute`. That's it.
 *
 * Round 17 (G10 PR 1) companion: see `docs/G10_EXTENSION_SCAFFOLD_GUIDE.md`
 * for the full authoring guide, and `extensions/apply-patch.ts` for a
 * real-world 266-LOC example that uses the same pattern with two tools
 * (apply_patch + apply_command).
 */
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { defineTool, validateParamsSafe } from "@openbuddy/plugin-host";

// ─── Param schema (TypeBox) ────────────────────────────────────────
// `Type.Object({ ... })` produces a TSchema that pi accepts directly.
// `InferParams<typeof Schema>` would give us the TS-side type if we
// needed it elsewhere; here `validateParamsSafe` narrows `unknown` to
// the inferred shape inside the if-branch.

const HelloParamsSchema = Type.Object({
  who: Type.String({ description: "Whom to greet (e.g. 'world', 'OpenBuddy')" }),
  loud: Type.Optional(
    Type.Boolean({ description: "Upper-case the greeting" }),
  ),
});

export default function helloWorldExtension(): ExtensionFactory {
  return (pi) => {
    const api = pi;
    if (typeof api.registerTool !== "function") return;

    api.registerTool(defineTool({
      name: "hello",
      label: "Hello",
      description:
        "Returns a greeting for `who`. If `loud` is true, the greeting " +
        "is upper-cased. Use this to verify your extension is wired up " +
        "correctly (it should appear in the tool list of any pi agent " +
        "session that loads this extension).",
      parameters: HelloParamsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        // Round 16 pattern: `validateParamsSafe` is a real TS
        // user-defined type guard (`params is InferParams<S>`), so the
        // `if (!...) return fail(...)` line both validates at runtime
        // AND narrows `params` to `{ who: string; loud?: boolean }`.
        const fail = (msg: string) => ({
          content: [{ type: "text" as const, text: "hello failed: " + msg }],
          details: { error: msg },
        });
        if (!validateParamsSafe(HelloParamsSchema, params)) {
          return fail("invalid params: expected { who: string; loud?: boolean }");
        }
        // `params` is now statically typed — no `as` cast, no `?? ""`.
        const greet = (params.loud ? "HELLO" : "hello") + ", " + params.who;
        return {
          content: [{ type: "text" as const, text: greet }],
          details: { greeting: greet, who: params.who, loud: !!params.loud },
        };
      },
    }));
  };
}