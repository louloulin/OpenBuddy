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
 *
 * P0.3(2026-10-19):宿主 CSP 禁 unsafe-eval。这里**不能在模块顶层 new Function**
 * —— 打包器会把常量参数的 `new Function` 保留为模块级求值,模块一加载就触发
 * CSP 违规(白屏)。Reflect.construct 与 new Function 语义等价,但源码无
 * `new Function` 字面量,编译器无从常量折叠;构造延迟到首次调用。
 */
const EVAL_ARGS: readonly string[] = ["ctx", "expr", "with (ctx) { return eval(expr) }"];
let cachedEvaluate: ((ctx: Record<string, unknown>, expr: string) => unknown) | null = null;

export function evaluate(ctx: Record<string, unknown>, expr: string): unknown {
  if (!cachedEvaluate) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    cachedEvaluate = Reflect.construct(Function, [...EVAL_ARGS]) as (
      ctx: Record<string, unknown>,
      expr: string,
    ) => unknown;
  }
  return cachedEvaluate(ctx, expr);
}

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
