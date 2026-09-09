/**
 * @openbuddy/ui-runtime/plugin-ui-host — PI ExtensionRunner UI bridge.
 *
 * Phase E.2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v3 §E.2):
 *   Bridges the OpenBuddy SlotMap (renderer-host) with PI
 *   ExtensionRunner's UI events so plugin-host widgets can
 *   react to:
 *     - MessageRenderer / EntryRenderer (custom message types)
 *     - ToolRenderResultOptions (custom tool result rendering)
 *
 * Why a separate module (vs adding to conversation-assembler.ts):
 *   - conversation-assembler.ts is the core OpenBuddy message
 *     pipeline (521 LOC) — adding PI ExtensionRunner coupling
 *     would balloon it past the 1k LOC milestone.
 *   - plugin-ui-host.ts is a clean adapter that knows about the
 *     5 PiExtensionUISlotKey types (from @openbuddy/ui-slots) and
 *     routes PI UI events into the SlotMap.
 *   - It can be mocked independently of the message pipeline for
 *     plugin-host integration tests.
 *
 * Architecture:
 *   - Exposes a `registerPluginWidget(type, component)` helper that
 *     maps a PI message/custom-renderer type to a React component
 *     that OpenBuddy slots can host.
 *   - Holds a registry of `MessageRenderer` / `EntryRenderer` /
 *     `ToolRenderResultOptions` per-type, dispatched via the
 *     SlotMap.
 *   - Future work: hook the renderer event-bus to call into
 *     `dispatchToSlot(slotKey, event)` so PI widgets trigger
 *     OpenBuddy-side reactions (toasts, confirm dialogs, etc.).
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/ and nothing from index.ts
 *   (this is a leaf module inside the ui-runtime package).
 */

import type { ComponentType, ReactNode } from "react";
import type { SlotMap } from "@openbuddy/ui-slots";

/**
 * A widget that a plugin registers to render a specific message or
 * custom-renderer type. The component receives the same `props` that
 * PI would pass to its `MessageRenderer` / `EntryRenderer` /
 * `ToolRenderResultOptions`, so plugin authors can re-use their
 * existing widget code without translation.
 */
export type PluginWidget<P = Record<string, unknown>> = ComponentType<{ props: P }>;

/**
 * The registry maps a renderer type to its widget component. We use a
 * `Map` (not an object literal) so plugins can register / unregister
 * dynamically at runtime (e.g. on plugin enable / disable).
 */
export class PluginWidgetRegistry {
  private readonly widgets = new Map<string, PluginWidget>();

  /** Register a widget for a renderer type. Throws if a widget is
   *  already registered for the same type — call `unregister` first. */
  register<P>(type: string, component: PluginWidget<P>): void {
    if (this.widgets.has(type)) {
      throw new Error(`plugin-ui-host: widget already registered for type "${type}"`);
    }
    this.widgets.set(type, component as PluginWidget);
  }

  /** Remove a widget. Returns true if removed, false if no widget
   *  was registered for the given type. */
  unregister(type: string): boolean {
    return this.widgets.delete(type);
  }

  /** Look up the widget for a renderer type. Returns undefined if no
   *  widget is registered. */
  resolve<P = Record<string, unknown>>(type: string): PluginWidget<P> | undefined {
    return this.widgets.get(type) as PluginWidget<P> | undefined;
  }

  /** List all registered renderer types. */
  types(): readonly string[] {
    return [...this.widgets.keys()];
  }

  /** Clear all registered widgets. Used by plugin-host disable. */
  clear(): void {
    this.widgets.clear();
  }
}

/**
 * Route a PI UI event to the right SlotMap slot. Phase E.1 added the
 * five slot keys (`pi-ui-notify` / `pi-ui-select` / etc.); this
 * dispatcher is the bridge between PI's UI events and those slots.
 *
 * Renderer-host calls `dispatchToSlot(slotKey, event)` from
 * conversation-assembler whenever a PI ExtensionRunner fires one
 * of the corresponding UI hooks. The slot owner (declared via
 * `declare module "@openbuddy/ui-slots"`) decides how to render the
 * event (toast, modal, status-bar update, etc.).
 */
export type SlotKey = keyof SlotMap | PiExtensionUISlotKeyFallback;

export type PiExtensionUISlotKeyFallback =
  | "pi-ui-notify"
  | "pi-ui-select"
  | "pi-ui-confirm"
  | "pi-ui-set-status"
  | "pi-ui-set-working-indicator";

/**
 * Pluggable dispatcher interface. Render-host gets the dispatcher
 * via dependency injection so tests can swap in a stub that captures
 * dispatched events without rendering anything.
 */
export interface SlotDispatcher {
  dispatch(slotKey: SlotKey, payload: Record<string, unknown>): Promise<void>;
}

/**
 * The default dispatcher writes the dispatched event to a console
 * sink so dev mode shows PI UI events in the renderer console.
 * Production should swap this for a real renderer that forwards
 * events to SlotProvider's render tree.
 */
export class ConsoleSlotDispatcher implements SlotDispatcher {
  async dispatch(slotKey: SlotKey, payload: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line no-console
    console.debug(`[plugin-ui-host] dispatch to slot "${slotKey}":`, payload);
  }
}

/**
 * Composite dispatcher: tries each child in order until one returns.
 * Useful for production where events flow through both a render
 * sink AND a metrics collector.
 */
export class CompositeSlotDispatcher implements SlotDispatcher {
  constructor(private readonly children: readonly SlotDispatcher[]) {}

  async dispatch(slotKey: SlotKey, payload: Record<string, unknown>): Promise<void> {
    for (const child of this.children) {
      await child.dispatch(slotKey, payload);
    }
  }
}

/**
 * Plugin UI host: bundles a widget registry + a slot dispatcher +
 * a render helper. Plugin-host constructs one per session.
 */
export class PluginUIHost {
  constructor(
    public readonly widgets: PluginWidgetRegistry = new PluginWidgetRegistry(),
    public readonly dispatcher: SlotDispatcher = new ConsoleSlotDispatcher(),
  ) {}

  /** Render a renderer-type + props pair by dispatching to the
   *  registered widget (or falling back to the dispatcher). Returns
   *  null if no widget is registered and the dispatcher declines. */
  render<P = Record<string, unknown>>(type: string, props: P): ReactNode {
    const Widget = this.widgets.resolve<P>(type);
    if (!Widget) {
      // Fire-and-forget: we await the dispatcher in the host loop
      // so consumers can compose async sinks (e.g. metrics flush).
      void this.dispatcher.dispatch(type, props as Record<string, unknown>);
      return null;
    }
    return Widget({ props });
  }

  /** Forward a PI UI event to the slot system. Used by
   *  conversation-assembler whenever PI fires
   *  `notify` / `select` / `confirm` / `setStatus` /
   *  `setWorkingIndicator`. */
  async forwardUIEvent(slotKey: SlotKey, payload: Record<string, unknown>): Promise<void> {
    await this.dispatcher.dispatch(slotKey, payload);
  }
}
