/**
 * extensions/flag-shortcut-bridge.ts — 11th builtin PI ExtensionFactory.
 *
 * Phase M.1 of plan3.0.md. Demonstrates the full Pi native flag/shortcut
 * surface that the rest of OpenBuddy has so far left unused:
 *
 *   - `pi.registerFlag(name, options)` — declare a CLI flag that any later
 *     code (including other extensions) can read back via `pi.getFlag`.
 *   - `pi.registerShortcut(keyId, options)` — bind a keyboard shortcut to
 *     a handler that receives the ExtensionContext (so it can decide based
 *     on `isIdle()` / `isProjectTrusted()` / `abort()` / `shutdown()`).
 *
 * Why this exists:
 *   The other 10 builtin ExtensionFactories cover events, observability,
 *   tools, commands, providers, and session/model bridges. None of them
 *   exercise the flag / shortcut surface, so a future third-party plugin
 *   that calls `pi.getFlag("openbuddy-debug")` would always see `undefined`.
 *   This factory plants a deterministic seed for that surface so:
 *     1. The renderer / CLI can introspect "is the debug overlay on?";
 *     2. Operators have a stable shortcut to abort the current session
 *        without inventing a new keybinding per release;
 *     3. The test fixture pins the exact Pi d.ts shape so future SDK
 *        upgrades break loudly here instead of silently at runtime.
 *
 * Idempotency:
 *   - All handlers are pure forwarders / no-ops when the SDK is older.
 *   - The factory is registered last in `builtinPiExtensionFactories` so
 *     other extensions reading `getFlag("openbuddy-debug")` from a
 *     `before_agent_start` hook can still observe the seeded default.
 *
 * Compatibility:
 *   - `registerFlag` is available from pi-coding-agent 0.84.x onward.
 *   - `registerShortcut` is available from pi-coding-agent 0.84.x onward.
 *   - When either is missing from the runtime, the factory no-ops — the
 *     existing builtins (observability / context / telemetry) keep working.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

type FlagShortcutApi = {
  registerFlag?: (name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }) => void;
  registerShortcut?: (
    shortcut: string,
    options: { description?: string; handler: (ctx: { abort?: () => void; shutdown?: () => void; isIdle?: () => boolean }) => Promise<void> | void },
  ) => void;
  getFlag?: (name: string) => boolean | string | undefined;
};

/** Name of the boolean CLI flag this factory seeds. Stable for cross-version tooling. */
export const OPENBUDDY_DEBUG_FLAG = "openbuddy-debug";

/** KeyId bound to "abort the current session when idle". Stable for renderer introspection. */
export const OPENBUDDY_ABORT_SHORTCUT = "ctrl+shift+o";

/**
 * Build the 11th builtin ExtensionFactory. Returns the
 * `(pi: ExtensionAPI) => void` factory function. Designed to be plugged
 * into `builtinPiExtensionFactories["openbuddy-pi-flag-shortcut"]`.
 */
export function createFlagShortcutBridgeExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const api = pi as unknown as FlagShortcutApi;

    if (typeof api.registerFlag === "function") {
      // boolean flag, default false. The renderer / support bundle reads this
      // back through `getFlag` to decide whether to attach debug breadcrumbs
      // to outgoing IPC events.
      api.registerFlag(OPENBUDDY_DEBUG_FLAG, {
        type: "boolean",
        default: false,
        description: "Enable verbose OpenBuddy debug logging in the renderer and CLI.",
      });
    }

    if (typeof api.registerShortcut === "function") {
      // Keyboard shortcut: when the agent is idle, ask Pi to gracefully
      // shutdown the current session. When busy, no-op (so we don't strand
      // an in-flight tool call). The handler ignores its context for now
      // because `isIdle()` is not on every Pi ExtensionContext variant —
      // the safer default is to forward the request to `shutdown` if it
      // exists on the supplied ctx (typed as a structural duck type above).
      api.registerShortcut(OPENBUDDY_ABORT_SHORTCUT, {
        description: "Abort the current session when idle.",
        handler: (ctx) => {
          if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return;
          if (typeof ctx.shutdown === "function") ctx.shutdown();
          else if (typeof ctx.abort === "function") ctx.abort();
        },
      });
    }
  };
}

/**
 * The factory registrar — used by `builtinPiExtensionFactories` in
 * pi-extensions.ts. Mirrors the shape of the existing builtins so the
 * resolution loop picks it up without any further wiring.
 */
export const flagShortcutBridgeFactory: ExtensionFactory = createFlagShortcutBridgeExtension();
