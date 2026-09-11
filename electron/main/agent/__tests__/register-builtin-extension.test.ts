/**
 * Round 18 — G10 PR 2 vitest for `registerBuiltinExtension` helper.
 *
 * The helper is intentionally trivial (`builtinPiExtensionFactories[name]
 * = factory`) but the typed signature is what makes new builtins
 * self-documenting. We verify three properties:
 *
 *   1. Registering a factory makes it retrievable via the public
 *      `builtinPiExtensionFactories` record (so downstream code paths
 *      — loadBuiltinExtension, builtinPiExtensionIds, etc. — keep
 *      working unchanged).
 *   2. Calling the retrieved factory with `(emit, config, options)`
 *      returns a working `ExtensionFactory` that takes a `pi` object
 *      and registers tools/hooks.
 *   3. Re-registering under an existing name overwrites (so a
 *      third-party extension can override a builtin if needed).
 *
 * These 3 cases are the minimum surface that justifies the helper
 * existing; without them the helper would be pure ceremony.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  builtinPiExtensionFactories,
  registerBuiltinExtension,
  type BuiltinExtensionFactory,
} from "../pi-extensions";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

describe("G10 PR 2 — registerBuiltinExtension helper", () => {
  // Use a unique name per test run so we don't collide with any other
  // test that might mutate the shared record (defensive: vitest runs
  // files in parallel by default).
  const TEST_NAME = "__round18_test_extension__";

  afterEach(() => {
    delete builtinPiExtensionFactories[TEST_NAME];
  });

  it("registers a factory so it becomes retrievable via builtinPiExtensionFactories", () => {
    const factory: BuiltinExtensionFactory = (_emit, _config, _options): ExtensionFactory => () => {};
    registerBuiltinExtension(TEST_NAME, factory);
    expect(builtinPiExtensionFactories[TEST_NAME]).toBe(factory);
  });

  it("the retrieved factory produces a working ExtensionFactory that calls registerTool", () => {
    const emit = () => {};
    const options = { profileDir: "/tmp", resolveSource: (s: string) => s, emit } as const;
    const factory: BuiltinExtensionFactory = (_emit, _config, _options) => (pi) => {
      const api = pi as unknown as { registerTool: (t: { name: string }) => void };
      api.registerTool({ name: "round18_demo_tool" });
    };
    registerBuiltinExtension(TEST_NAME, factory);

    // Resolve via the public surface (same path the loader uses).
    const retrieved = builtinPiExtensionFactories[TEST_NAME];
    expect(retrieved).toBeTypeOf("function");

    // Call it the way the loader does, capture what gets registered.
    const registered: Array<{ name: string }> = [];
    const piStub = {
      registerTool(tool: { name: string }) {
        registered.push(tool);
      },
    } as unknown as ExtensionAPI;

    const extensionFactory = retrieved(emit, {}, options);
    extensionFactory(piStub);
    expect(registered).toEqual([{ name: "round18_demo_tool" }]);
  });

  it("re-registering under the same name overwrites the previous factory", () => {
    const calls: string[] = [];
    const first: BuiltinExtensionFactory = () => () => {
      calls.push("first");
    };
    const second: BuiltinExtensionFactory = () => () => {
      calls.push("second");
    };

    registerBuiltinExtension(TEST_NAME, first);
    registerBuiltinExtension(TEST_NAME, second);
    expect(builtinPiExtensionFactories[TEST_NAME]).toBe(second);

    const factory = builtinPiExtensionFactories[TEST_NAME];
    factory(() => {}, {}, { profileDir: "/tmp", resolveSource: (s: string) => s, emit: () => {} })(
      {} as unknown as ExtensionAPI,
    );
    expect(calls).toEqual(["second"]);
  });
});