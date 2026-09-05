/**
 * @openbuddy/ui-slots/client — runtime bridge to renderer-host SlotCore.
 *
 * Most ui-* packages should NOT import this module; they should call
 * `ctx.slots.register(...)` directly through their apply() function. This
 * file is exposed only for packages that need to wrap or extend the slot
 * core (e.g. ui-runtime's auto-discovery, ui-hmr's hot-reload handling).
 */
import type { SlotCoreLike, UiRuntimeContext } from "./index";

export type { SlotCoreLike, UiRuntimeContext };

/** True if the context exposes a SlotCore-like slots service. */
export function hasSlotCore(ctx: { slots?: unknown }): ctx is UiRuntimeContext & { slots: SlotCoreLike } {
  return !!ctx.slots && typeof (ctx.slots as SlotCoreLike).register === "function";
}
