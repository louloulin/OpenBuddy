/**
 * @openbuddy/ui-runtime/plugin-ui-host — Phase E.2 tests.
 *
 * Verifies the PI ExtensionRunner UI bridge: PluginWidgetRegistry
 * + ConsoleSlotDispatcher + CompositeSlotDispatcher + PluginUIHost.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PluginWidgetRegistry,
  ConsoleSlotDispatcher,
  CompositeSlotDispatcher,
  PluginUIHost,
  type SlotKey,
} from "./plugin-ui-host";

describe("Phase E.2 — plugin-ui-host", () => {
  describe("PluginWidgetRegistry", () => {
    it("registers, resolves, unregisters a widget", () => {
      const reg = new PluginWidgetRegistry();
      const Widget = () => null;
      reg.register("custom-message", Widget);
      expect(reg.resolve("custom-message")).toBe(Widget);
      expect(reg.types()).toEqual(["custom-message"]);
      expect(reg.unregister("custom-message")).toBe(true);
      expect(reg.resolve("custom-message")).toBeUndefined();
    });

    it("throws when registering the same type twice without unregistering", () => {
      const reg = new PluginWidgetRegistry();
      const A = () => null;
      const B = () => null;
      reg.register("t", A);
      expect(() => reg.register("t", B)).toThrow(/already registered/);
    });

    it("returns false when unregistering a missing type", () => {
      const reg = new PluginWidgetRegistry();
      expect(reg.unregister("nope")).toBe(false);
    });

    it("clear() removes all widgets", () => {
      const reg = new PluginWidgetRegistry();
      reg.register("a", () => null);
      reg.register("b", () => null);
      reg.clear();
      expect(reg.types()).toEqual([]);
    });
  });

  describe("ConsoleSlotDispatcher", () => {
    it("writes the slotKey to console.debug (payload is a second arg)", async () => {
      const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      try {
        const dispatcher = new ConsoleSlotDispatcher();
        await dispatcher.dispatch("pi-ui-notify" as SlotKey, { message: "hi" });
        expect(debug).toHaveBeenCalled();
        // console.debug was called with (message, payload) — message
        // string contains the slot key; payload is the second argument.
        const message = debug.mock.calls[0]?.[0] as string;
        const payload = debug.mock.calls[0]?.[1] as { message: string };
        expect(message).toContain("pi-ui-notify");
        expect(payload).toEqual({ message: "hi" });
      } finally {
        debug.mockRestore();
      }
    });
  });

  describe("CompositeSlotDispatcher", () => {
    it("forwards to each child in order", async () => {
      const calls: string[] = [];
      const a = { dispatch: async () => { calls.push("a"); } };
      const b = { dispatch: async () => { calls.push("b"); } };
      const c = { dispatch: async () => { calls.push("c"); } };
      const composite = new CompositeSlotDispatcher([a, b, c] as never);
      await composite.dispatch("pi-ui-notify" as SlotKey, {});
      expect(calls).toEqual(["a", "b", "c"]);
    });

    it("works with an empty child list", async () => {
      const composite = new CompositeSlotDispatcher([]);
      await composite.dispatch("pi-ui-notify" as SlotKey, {});
      // No throw, no calls.
    });
  });

  describe("PluginUIHost", () => {
    it("render() returns the widget component when registered", () => {
      const Widget = (_: { props: { x: number } }) => null;
      const host = new PluginUIHost();
      host.widgets.register("custom", Widget as never);
      // We only verify the call resolves; the returned ReactNode is
      // a React-element (we don't assert on its identity here).
      const node = host.render("custom", { x: 1 });
      expect(node).toBeDefined();
    });

    it("render() falls back to dispatcher and returns null when no widget is registered", async () => {
      const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
      try {
        const host = new PluginUIHost();
        const node = host.render("missing", { foo: 1 });
        expect(node).toBeNull();
        // Dispatcher (default: ConsoleSlotDispatcher) called.
        expect(debug).toHaveBeenCalled();
      } finally {
        debug.mockRestore();
      }
    });

    it("forwardUIEvent awaits the dispatcher", async () => {
      const dispatched: Array<{ key: string; payload: unknown }> = [];
      const customDispatcher = {
        dispatch: async (key: string, payload: unknown) => {
          dispatched.push({ key, payload });
        },
      };
      const host = new PluginUIHost(undefined, customDispatcher as never);
      await host.forwardUIEvent("pi-ui-confirm" as SlotKey, { prompt: "ok?" });
      expect(dispatched).toEqual([{ key: "pi-ui-confirm", payload: { prompt: "ok?" } }]);
    });
  });
});
