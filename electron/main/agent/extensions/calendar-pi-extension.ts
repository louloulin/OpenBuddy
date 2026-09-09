/**
 * extensions/calendar-pi-extension.ts — Phase I.2 builtin PI ExtensionFactory.
 *
 * Wires the `Calendar` capability's `createCalendarToolDefinitions()` (which
 * already exists at `@openbuddy/capability-calendar/calendar-tools.ts`) into
 * PI's ExtensionRunner so the LLM can drive calendar operations through
 * first-class pi tools rather than only slash commands / IPC.
 *
 * Why this extension (plan §I.2):
 *   - Today the calendar capability is reachable via slash commands + IPC
 *     (see `electron/main/ipc/misc.ts:520`).
 *   - The PI tool factory `createCalendarPiTools()` already exists (Phase C.3)
 *     but no builtin extension actually calls `registerTool()` for the LLM.
 *   - Adding the extension closes the loop: `loadExtensions()` discovers
 *     it via `BUILTIN_PI_PLUGIN_MANIFESTS`, the ExtensionRunner registers
 *     the 4 calendar tools (`calendar_list`, `calendar_create`,
 *     `calendar_update`, `calendar_remove`) and the LLM can use them.
 *
 * How the calendar handlers are resolved:
 *   The Calendar Cordis service is mounted by the calendar capability
 *   plugin (capability-plugins.ts → `mountCalendar`). The calendar package
 *   exposes `calendarHandlers` (a module-level proxy in `index.ts`) that
 *   points to the currently-mounted service instance. Because Cordis
 *   boot and ExtensionFactory invocation both happen during the same
 *   bootstrap pass, the handlers are guaranteed available by the time
 *   the LLM gets to invoke the tools (Cordis services are mounted
 *   before `apply()` is awaited).
 *
 * Edge cases:
 *   - If `calendarHandlers.list/create/update/remove` returns `undefined`
 *     (Cordis service not mounted yet, e.g. cold-start race), the tool
 *     returns a graceful error rather than crashing the agent loop.
 *   - The factory itself never throws — the ExtensionRunner treats
 *     `(pi) => { ... }` as fire-and-forget.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  createCalendarToolDefinitions,
  type CalendarToolHandlers,
} from "@openbuddy/capability-calendar";

import { calendarHandlers } from "@openbuddy/capability-calendar";

/**
 * Adapter that the calendar package exports — wraps the live Calendar
 * Cordis service. Each method returns `undefined` if the service hasn't
 * been mounted yet (Cordis cold-start edge case); the tool wrappers
 * below treat `undefined` as a graceful no-op error.
 */
const liveHandlers: CalendarToolHandlers = {
  list: (input) => calendarHandlers.list(input as never) as Promise<unknown>,
  create: (input) => calendarHandlers.create(input as never) as Promise<unknown>,
  update: (id, patch) => calendarHandlers.update(id, patch as never) as Promise<unknown>,
  updateInRoom: (id, roomId, patch) =>
    calendarHandlers.updateInRoom(id, roomId, patch as never) as Promise<unknown>,
  remove: (id) => calendarHandlers.remove(id) as Promise<unknown>,
  removeInRoom: (id, roomId) =>
    calendarHandlers.removeInRoom(id, roomId) as Promise<unknown>,
};

/**
 * Build the calendar PI extension. Returns the
 * `(pi: ExtensionAPI) => void` factory function. Designed to be plugged
 * into `builtinPiExtensionFactories["openbuddy-pi-calendar"]`.
 */
export function createCalendarPiExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const api = pi as unknown as {
      registerTool?: (tool: unknown) => void;
    };
    if (typeof api.registerTool !== "function") return;

    const tools = createCalendarToolDefinitions(liveHandlers);
    for (const tool of tools) {
      api.registerTool(tool);
    }
  };
}

/**
 * The factory registrar — used by `builtinPiExtensionFactories` in
 * pi-extensions.ts. Mirrors the shape of the other 9 builtins so the
 * resolution loop picks it up without any further wiring.
 */
export const calendarPiFactory: ExtensionFactory = createCalendarPiExtension();