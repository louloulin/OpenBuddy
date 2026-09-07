/**
 * bootstrap/wire-forwarded-events.ts — Context-scoped event forwarding bus.
 *
 * Phase 8.3 Batch D-6: split `agent-host.ts:initialize()` so the final
 * composition root reads as 8-10 stages of orchestration, not a wall of
 * inline closures. This stage owns:
 *   - the canonical list of Cordis events that are forwarded to the
 *     renderer via `openbuddy://plugin-event` (12 entries today)
 *   - the per-event `context.on(...)` registration
 *   - the `clonePayload(args)` IPC serialization wrapper
 *   - the capability-event bridge binding (`bindCapabilityEventBridge`)
 *     + `state.capabilityEventBridgeUnsubscribe` assignment
 *
 * Why this stage exists:
 *   Pre-Batch-D-6 the 12-event list + the for-loop + the bridge binding
 *   was 35+ lines of inline closure in `initialize()`. The list is
 *   intentionally centralised here so renderer-side event subscribers
 *   have one grep target.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import type { Context } from "@openbuddy/cordis";
import { bindCapabilityEventBridge } from "../../../capability-event-bridge";
import { clonePayload } from "../plugin-event-bus";
import { type AgentHostState } from "../_state-shape";

/**
 * Canonical list of Cordis events that are forwarded to the renderer
 * via the `openbuddy://plugin-event` IPC channel. Order is stable (tested
 * via `event-channel-matrix.test.ts`).
 *
 * Adding an event here automatically registers a `context.on` handler in
 * `wireForwardedEvents()`. Removing an event here stops the forwarder.
 * Keep the list narrow — every entry is one extra renderer subscription
 * to set up.
 */
export const FORWARDED_REMOTE_EVENTS = [
  "agent-preset/selected",
  "commands/change",
  "credentials/reference-updated",
  "cordis/request-run",
  "cordis/request-run-resolved",
  "cordis/dynamic-package",
  "cordis/dynamic-retract",
  "cordis/inspect-query",
  "cordis/inspect-query-resolved",
  "llm/adapters-updated",
  "settings/document-updated",
  "workspace/changed",
] as const;

export type ForwardedRemoteEvent = (typeof FORWARDED_REMOTE_EVENTS)[number];

/**
 * Dependencies required to wire the forwarded-events bus + the capability
 * event bridge. Caller passes the already-constructed `context` (from
 * the prior stage).
 */
export interface WireForwardedEventsDeps {
  state: AgentHostState;
  context: Context;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  emitPluginEvent: (type: string, payload: unknown) => void;
}

/**
 * Wire the forwarded-events bus + the capability event bridge.
 *
 * Side effects on `state`:
 *   - `state.capabilityEventBridgeUnsubscribe` — `bindCapabilityEventBridge`
 *     dispose function; cleared by `disposeHost`.
 *
 * No return value — the function is purely declarative wiring. To remove
 * the handlers, call `state.capabilityEventBridgeUnsubscribe?.()` then
 * tear down the context (the Cordis Context API disposes its own listeners
 * on `ctx.dispose()`).
 */
export function wireForwardedEvents(deps: WireForwardedEventsDeps): void {
  const { state, context, emitRendererEvent, emitPluginEvent } = deps;

  for (const eventName of FORWARDED_REMOTE_EVENTS) {
    context.on(eventName, (...args: unknown[]) => {
      emitRendererEvent("openbuddy://plugin-event", {
        eventVersion: 1,
        type: eventName,
        payload: { args: clonePayload(args) },
      });
    });
  }

  state.capabilityEventBridgeUnsubscribe = bindCapabilityEventBridge({
    context,
    getSessionId: () => state.session?.sessionId,
    emitPluginEvent,
    emitRendererEvent,
  });
}
