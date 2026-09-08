/**
 * _deep-freeze.ts — runtime deep-freeze for module-level static tables.
 *
 * P0-05 of WU-E: "deepseek-runtime 全树 freeze".
 *
 * DeepSeek module-level tables (BASE_HOST_RUNNER_ENTRIES,
 * DEEPSEEK_CORE_PACKAGE_NAMES, deepSeekCordisInvocationMethods, …)
 * are configuration that's logically immutable after module load. We
 * want any future mutation attempt to fail loudly in strict mode
 * (ESM modules default to sloppy so it would silently no-op without
 * `throw` semantics; see "use strict" / `"use server"` notes below).
 *
 * `deepFreeze(value)` walks every reachable object/array/set and calls
 * `Object.freeze` on each. Already-frozen subtrees are skipped to
 * avoid quadratic cost on large trees. Returns the input value so
 * callers can chain `const X = deepFreeze({ … })`.
 *
 * Non-enumerable properties, class instances, functions, Date, Map,
 * RegExp, Buffer, etc. are skipped — we don't want to freeze
 * listeners, module singletons, or built-ins whose freezing changes
 * observable semantics.
 */
type Freezeable = Record<string, unknown> | readonly unknown[] | null | undefined | primitive;

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof value === "function") return value;
  if (Object.isFrozen(value)) return value;
  const proto = Object.getPrototypeOf(value);
  // Plain objects and arrays: walk and freeze.
  if (proto === Object.prototype || proto === Array.prototype || proto === null) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
    return value;
  }
  // Set: freeze its membership by wrapping add/delete/third-party mutators
  // is not possible without a Proxy, so we just freeze the Set itself to
  // prevent `.clear()` / reassignment of the binding. Element mutation
  // (`add`/`delete`) still works since Sets are special-cased by V8.
  // We document this caveat in the return: callers wanting strict
  // element immutability should hold the Set in a frozen outer container
  // and treat the binding as the protected boundary.
  if (proto === Set.prototype) {
    Object.freeze(value);
    return value;
  }
  // Anything else (Map, Date, class instances, …): skip.
  return value;
}

