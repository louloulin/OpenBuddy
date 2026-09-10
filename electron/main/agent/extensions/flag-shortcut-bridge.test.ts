import { describe, expect, it } from "vitest";

/**
 * flag-shortcut-bridge.test.ts
 *
 * Phase M.1 of plan3.0.md — verify the 11th builtin ExtensionFactory wires
 * up the under-used Pi flag / shortcut surface and does not crash on
 * missing api surface.
 */

import {
  OPENBUDDY_ABORT_SHORTCUT,
  OPENBUDDY_DEBUG_FLAG,
  createFlagShortcutBridgeExtension,
  flagShortcutBridgeFactory,
} from "./flag-shortcut-bridge";

type RegisterFlagCall = {
  name: string;
  options: { description?: string; type: "boolean" | "string"; default?: boolean | string };
};
type RegisterShortcutCall = {
  shortcut: string;
  options: { description?: string; handler: (ctx: unknown) => Promise<void> | void };
};

function makeFakePi(overrides: Partial<{
  registerFlag: (name: string, options: RegisterFlagCall["options"]) => void;
  registerShortcut: (shortcut: string, options: RegisterShortcutCall["options"]) => void;
  getFlag: (name: string) => boolean | string | undefined;
}> = {}) {
  const flagCalls: RegisterFlagCall[] = [];
  const shortcutCalls: RegisterShortcutCall[] = [];
  const flagValues = new Map<string, boolean | string>();
  const api = {
    registerFlag: (name: string, options: RegisterFlagCall["options"]) => {
      flagCalls.push({ name, options });
      if ("default" in options && options.default !== undefined) flagValues.set(name, options.default);
    },
    registerShortcut: (shortcut: string, options: RegisterShortcutCall["options"]) => {
      shortcutCalls.push({ shortcut, options });
    },
    getFlag: (name: string) => flagValues.get(name),
    ...overrides,
  };
  return { api, flagCalls, shortcutCalls, flagValues };
}

describe("flag-shortcut-bridge", () => {
  it("is a callable factory (M.1 sanity)", () => {
    expect(typeof flagShortcutBridgeFactory).toBe("function");
    expect(typeof createFlagShortcutBridgeExtension()).toBe("function");
  });

  it("registers the openbuddy-debug boolean flag with default false", () => {
    const fake = makeFakePi();
    flagShortcutBridgeFactory(fake.api as never);

    const debug = fake.flagCalls.find((call) => call.name === OPENBUDDY_DEBUG_FLAG);
    expect(debug).toBeDefined();
    expect(debug?.options.type).toBe("boolean");
    expect(debug?.options.default).toBe(false);
    expect(typeof debug?.options.description).toBe("string");
  });

  it("registers the abort shortcut with a handler that prefers shutdown", () => {
    const fake = makeFakePi();
    flagShortcutBridgeFactory(fake.api as never);

    const abort = fake.shortcutCalls.find((call) => call.shortcut === OPENBUDDY_ABORT_SHORTCUT);
    expect(abort).toBeDefined();
    expect(typeof abort?.options.handler).toBe("function");

    // Busy ctx (isIdle() === false) → handler must NOT call shutdown.
    const shutdown = viFn();
    abort?.options.handler({ isIdle: () => false, shutdown });
    expect(shutdown.calls).toBe(0);

    // Idle ctx → handler must call shutdown once.
    abort?.options.handler({ isIdle: () => true, shutdown });
    expect(shutdown.calls).toBe(1);
  });

  it("falls back to abort() when shutdown() is unavailable", () => {
    const fake = makeFakePi();
    flagShortcutBridgeFactory(fake.api as never);

    const abort = fake.shortcutCalls.find((call) => call.shortcut === OPENBUDDY_ABORT_SHORTCUT);
    const abortFn = viFn();
    abort?.options.handler({ isIdle: () => true, abort: abortFn });
    expect(abortFn.calls).toBe(1);
  });

  it("no-ops when registerFlag is unavailable", () => {
    const fake = makeFakePi({ registerFlag: undefined });
    expect(() => flagShortcutBridgeFactory(fake.api as never)).not.toThrow();
    // Shortcut registration must still happen so the user-facing binding is
    // available regardless of which Pi d.ts surface is mounted.
    expect(fake.shortcutCalls.length).toBe(1);
  });

  it("no-ops when registerShortcut is unavailable", () => {
    const fake = makeFakePi({ registerShortcut: undefined });
    expect(() => flagShortcutBridgeFactory(fake.api as never)).not.toThrow();
    // Flag registration must still happen so CLI consumers can read the
    // default before any shortcut ever fires.
    expect(fake.flagCalls.length).toBe(1);
  });

  it("does not crash when given an api object without any surface", () => {
    expect(() => flagShortcutBridgeFactory({} as never)).not.toThrow();
  });
});

// Tiny inline test double — keeps the test file dependency-free without
// pulling vi.fn() into the handler-execution assertions above.
function viFn() {
  let calls = 0;
  const fn = (..._args: unknown[]) => {
    calls += 1;
  };
  Object.defineProperty(fn, "calls", {
    get() {
      return calls;
    },
  });
  return fn as ((...args: unknown[]) => void) & { readonly calls: number };
}
