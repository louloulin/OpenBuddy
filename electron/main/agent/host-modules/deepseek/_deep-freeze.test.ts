/**
 * _deep-freeze.test.ts — P0-05 deepFreeze utility tests.
 *
 * Validates that `deepFreeze` correctly freezes plain objects, arrays,
 * nested structures, and Sets while skipping class instances, functions,
 * and built-ins. Exercises the same patterns the deepseek module-level
 * tables use.
 */
import { describe, expect, it, vi } from "vitest";
import { deepFreeze } from "./_deep-freeze";

describe("P0-05 — deepFreeze", () => {
  it("freezes a flat object and rejects writes", () => {
    const obj = deepFreeze({ a: 1, b: 2 });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(() => {
      "use strict";
      (obj as Record<string, unknown>).a = 99;
    }).toThrow();
  });

  it("freezes nested objects (top-level + child)", () => {
    const nested = deepFreeze({ outer: { inner: { value: 1 } } });
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.outer)).toBe(true);
    expect(Object.isFrozen(nested.outer.inner)).toBe(true);
    expect(() => {
      "use strict";
      (nested.outer.inner as Record<string, unknown>).value = 99;
    }).toThrow();
  });

  it("freezes arrays and their elements", () => {
    const arr = deepFreeze([{ x: 1 }, { y: 2 }]);
    expect(Object.isFrozen(arr)).toBe(true);
    expect(Object.isFrozen(arr[0])).toBe(true);
    expect(Object.isFrozen(arr[1])).toBe(true);
    expect(() => {
      "use strict";
      (arr as unknown[]).push({ z: 3 });
    }).toThrow();
  });

  it("freezes Sets (the Set object itself, not necessarily elements)", () => {
    const set = new Set(["a", "b"]);
    deepFreeze(set);
    expect(Object.isFrozen(set)).toBe(true);
    // Set.prototype.clear / .add / .delete cannot be intercepted by
    // Object.freeze in V8 (the Set's internal [[SetData]] slot is not
    // user-visible). We document this caveat; callers wanting strict
    // element immutability should hold the Set in a frozen outer
    // container and treat the binding as the protected boundary.
    // For the deepseek tables, `DEEPSEEK_CORE_PACKAGE_NAMES` is wrapped
    // by `deepFreeze` only for property-freeze semantics — callers that
    // mutate element membership are not protected by this helper alone.
    expect(set.size).toBe(2);
  });

  it("returns the same reference it was given (chainable)", () => {
    const input = { a: 1 };
    const output = deepFreeze(input);
    expect(output).toBe(input);
  });

  it("is a no-op on already-frozen subtrees", () => {
    const inner = Object.freeze({ x: 1 });
    const outer = deepFreeze({ inner });
    expect(Object.isFrozen(outer)).toBe(true);
    expect(Object.isFrozen(outer.inner)).toBe(true);
  });

  it("skips class instances (does not freeze their methods)", () => {
    class Counter {
      count = 0;
      increment() {
        this.count += 1;
      }
    }
    const c = new Counter();
    deepFreeze(c);
    // The instance itself is not frozen — methods still work.
    c.increment();
    expect(c.count).toBe(1);
  });

  it("skips functions and primitives", () => {
    expect(() => deepFreeze(42 as unknown as object)).not.toThrow();
    expect(() => deepFreeze("hello" as unknown as object)).not.toThrow();
    expect(() => deepFreeze(null as unknown as object)).not.toThrow();
    expect(() => deepFreeze(undefined as unknown as object)).not.toThrow();
    const fn = () => undefined;
    expect(deepFreeze(fn)).toBe(fn);
    expect(Object.isFrozen(fn)).toBe(false);
  });

  it("deepseek module-level tables are frozen at import time", async () => {
    // Re-import after the module-level `deepFreeze(BASE_HOST_RUNNER_ENTRIES)`
    // call. This validates the integration, not just the helper.
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("./host-runner-entries");
    const entries = mod.baseHostRunnerEntries();
    expect(Object.isFrozen(entries)).toBe(true);
    for (const entry of entries) {
      // Every entry's `config` (when present) must also be frozen.
      if (entry.config !== undefined) {
        expect(Object.isFrozen(entry.config)).toBe(true);
      }
      if (entry.inject !== undefined) {
        expect(Object.isFrozen(entry.inject)).toBe(true);
      }
    }
  });
});
