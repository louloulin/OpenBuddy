/**
 * @openbuddy/ui-runtime/plugin-ui-host — Phase E.2 tests.
 *
 * Verifies the PI ExtensionRunner UI bridge: PluginWidgetRegistry
 * + ConsoleSlotDispatcher + CompositeSlotDispatcher + PluginUIHost.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { Component, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import {
  PluginWidgetRegistry,
  ConsoleSlotDispatcher,
  CompositeSlotDispatcher,
  PluginUIHost,
  type SlotKey,
} from "./plugin-ui-host";

describe("Phase E.2 — plugin-ui-host", () => {
  // `act()` is a no-op unless the environment opts in, which makes the
  // render assertions below pass for the wrong reason.
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

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

    it("render() actually mounts the widget with the props it was given", () => {
      // `render()` returns an unrendered React element, so the widget body has
      // NOT run yet — asserting on the returned node alone (as the test above
      // does) would pass even if the widget were never invoked at all. Render
      // it for real and assert the widget saw the props.
      const Widget = ({ props }: { props: { label: string } }) =>
        createElement("span", null, props.label);
      const host = new PluginUIHost();
      host.widgets.register("custom", Widget as never);

      const node = host.render("custom", { label: "hello-from-widget" });

      const container = document.createElement("div");
      act(() => {
        createRoot(container).render(createElement(Fragment, null, node));
      });
      expect(container.textContent).toBe("hello-from-widget");
    });

    it("render() mounts a class-component widget, not just a function one", () => {
      // `PluginWidget` is `ComponentType`, i.e. `ComponentClass | FunctionComponent`.
      // Calling the union as a function type-checks for neither and would throw
      // at runtime for the class form, so `render()` must route both through
      // `createElement`.
      class ClassWidget extends Component<{ props: { label: string } }> {
        override render() {
          return createElement("span", null, this.props.props.label);
        }
      }
      const host = new PluginUIHost();
      host.widgets.register("custom", ClassWidget as never);

      const node = host.render("custom", { label: "from-class" });

      const container = document.createElement("div");
      act(() => {
        createRoot(container).render(createElement(Fragment, null, node));
      });
      expect(container.textContent).toBe("from-class");
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
