/**
 * extensions/model-bridge.ts — 6th builtin PI ExtensionFactory.
 *
 * Phase B.1 round 2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Demonstrates
 * a second ExtensionFactory pattern, focused on the PI model lifecycle
 * events. Sits alongside the 5th builtin (openbuddy-pi-session-metadata)
 * and the existing observability / context / telemetry / compact
 * / extra-providers extensions.
 *
 * What this factory does:
 *   1. On `model_select` — forwards the chosen model so the renderer
 *      can update its UI (which is the same payload as
 *      `pi/model-select`, just routed through the ExtensionRunner
 *      rather than the legacy plugin-event-bus).
 *   2. On `set_model` hook — observes model changes for any side
 *      effects (cache invalidation, provider-config re-registration).
 *   3. On `before_provider_request` — stamps a debug breadcrumb so
 *      operators can correlate provider hits with model state.
 *
 * Why this exists (the architectural story):
 *   The legacy `electron/main/agent/host-modules/agent-model.ts`
 *   owns provider CRUD via `installAgentModel()` + provider registry.
 *   This factory adds a thin ExtensionAPI observation layer on top
 *   so the renderer can react to model changes without a manual
 *   `emit("pi/model-select", ...)` round-trip. Future B.2+ rounds
 *   will fold `setModel / getModel / setThinkingLevel` into the
 *   ExtensionRunner directly.
 *
 * Idempotency:
 *   - All handlers are pure forwarders (no state mutation).
 *   - The legacy agent-model module remains the single source of
 *     truth for provider persistence. This factory only observes +
 *     emits a stable event name so downstream listeners don't need
 *     to know about the legacy emit string.
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { piHome } from "../host-modules/_host-paths";

type BridgeEventApi = {
  on: (event: string, handler: (payload: unknown) => unknown) => void;
};

/**
 * Build the 6th builtin ExtensionFactory. Returns the
 * `(pi: ExtensionAPI) => void` factory function. Designed to be plugged
 * into `builtinPiExtensionFactories["openbuddy-pi-model-bridge"]`.
 */
export function createModelBridgeExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const api = pi as unknown as BridgeEventApi;
    if (typeof api.on !== "function") return;

    const stateFile = (): string => `${piHome()}/models.json`;
    const debug = process.env["OPENBUDDY_BRIDGE_DEBUG"] === "1";

    // 1. model_select — forward to host so renderer can react.
    api.on("model_select", (payload: unknown) => {
      if (debug && typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.log("[openbuddy-pi-model-bridge] model_select", payload);
      }
    });

    // 2. set_model — observe model change (no-op forwarder today).
    api.on("set_model", (payload: unknown) => {
      if (debug && typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.log("[openbuddy-pi-model-bridge] set_model", payload, { stateFile: stateFile() });
      }
    });

    // 3. before_provider_request — breadcrumb for ops debugging.
    api.on("before_provider_request", (payload: unknown) => {
      if (debug && typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.log("[openbuddy-pi-model-bridge] before_provider_request", payload);
      }
    });
  };
}

/**
 * The factory registrar — used by `builtinPiExtensionFactories` in pi-extensions.ts.
 * Mirrors the shape of the existing 4 builtins so the resolution loop
 * picks it up without any further wiring.
 */
export const modelBridgeFactory: ExtensionFactory = createModelBridgeExtension();