/**
 * `!!js` expression evaluator — the deepseek-harness plugin manifest embeds
 * JavaScript expressions inside YAML config values via a custom `!!js` tag
 * that deserializes to `{ __jsExpr: '<source>' }`. At apply time those values
 * are evaluated against a scope object provided by the loader.
 *
 * Example (deepseek-style `cordis.patch.yml`):
 *
 *   - id: session-persistence-jsonl
 *     config:
 *       root: !!js dshHomePath('sessions')
 *
 * This module is intentionally tiny — the same `new Function('ctx', ...)` shape
 * the deepseek harness uses — so the parsed values are byte-compatible with
 * its `interpolate()` and `isJsExpr()` helpers.
 */

/** A serialized JavaScript expression carried by the `!!js` YAML tag. */
export interface JsExpr {
  readonly __jsExpr: string;
}

/** Type guard: returns true when the value is a `{ __jsExpr }` payload. */
export function isJsExpr(value: unknown): value is JsExpr {
  return !!value && typeof value === "object" && "__jsExpr" in (value as object)
    && typeof (value as JsExpr).__jsExpr === "string";
}

/**
 * Evaluate `expr` against `ctx` using `with(ctx)` — same shape as
 * `@cordisjs/plugin-loader`'s `evaluate`. Callers control the scope so this
 * is no less safe than the deepseek source we are mirroring.
 */
export const evaluate: (ctx: Record<string, unknown>, expr: string) => unknown =
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("ctx", "expr", "with (ctx) { return eval(expr) }") as (
    ctx: Record<string, unknown>,
    expr: string,
  ) => unknown;

/**
 * Recursively replace `JsExpr` nodes inside an arbitrary structure with the
 * evaluated result. Non-expression values pass through untouched. Arrays and
 * objects are walked in place; the input is not mutated (a shallow clone is
 * produced for objects and arrays).
 */
export function interpolate(
  ctx: Record<string, unknown>,
  value: unknown,
): unknown {
  if (isJsExpr(value)) return evaluate(ctx, value.__jsExpr);
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => interpolate(ctx, entry));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = interpolate(ctx, entry);
  }
  return out;
}
