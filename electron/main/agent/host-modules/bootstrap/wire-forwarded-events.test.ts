import { describe, expect, it } from "vitest";

import { FORWARDED_REMOTE_EVENTS, wireForwardedEvents } from "./wire-forwarded-events";
import type { AgentHostState } from "../_state-shape";

/**
 * Build a tiny Cordis-like context that records every `on()` registration
 * and returns a real unsubscribe fn from each call (so capability-event-
 * bridge's tear-down path doesn't NPE).
 */
function makeFakeContext(): {
  on: (event: string, handler: (...args: unknown[]) => void) => () => void;
  handlers: Map<string, (...args: unknown[]) => void>;
  events: string[];
} {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const events: string[] = [];
  return {
    handlers,
    events,
    on(event, handler) {
      handlers.set(event, handler);
      events.push(event);
      return () => {
        handlers.delete(event);
      };
    },
  };
}

function makeStubState(): AgentHostState {
  return {
    capabilityEventBridgeUnsubscribe: null,
    session: undefined,
  } as unknown as AgentHostState;
}

describe("host-modules/bootstrap/wire-forwarded-events", () => {
  it("registers exactly the canonical forwarded-event list", () => {
    const state = makeStubState();
    const context = makeFakeContext();
    const emitted: Array<{ channel: string; payload: unknown }> = [];
    const emitPluginEvent = () => undefined;

    wireForwardedEvents({
      state,
      context: context as never,
      emitRendererEvent: (channel, payload) => emitted.push({ channel, payload }),
      emitPluginEvent,
    });

    // Every entry in FORWARDED_REMOTE_EVENTS should be registered. Other
    // bridge events (mcp/ready, task/*, …) may also be registered via
    // bindCapabilityEventBridge, so we assert superset, not equality.
    for (const event of FORWARDED_REMOTE_EVENTS) {
      expect(context.events).toContain(event);
    }
    expect(FORWARDED_REMOTE_EVENTS.length).toBe(12);
  });

  it("forwarded event handler emits an openbuddy://plugin-event with cloned args", () => {
    const state = makeStubState();
    const context = makeFakeContext();
    const emitted: Array<{ channel: string; payload: unknown }> = [];

    wireForwardedEvents({
      state,
      context: context as never,
      emitRendererEvent: (channel, payload) => emitted.push({ channel, payload }),
      emitPluginEvent: () => undefined,
    });

    const firstEvent = FORWARDED_REMOTE_EVENTS[0];
    const handler = context.handlers.get(firstEvent);
    expect(handler).toBeDefined();
    handler?.({ id: "ws-1" }, { foo: "bar" });

    // The first emitted event should be the openbuddy://plugin-event from
    // our forwarded-events loop (not a capability bridge event).
    const forwarded = emitted.find((e) => e.channel === "openbuddy://plugin-event");
    expect(forwarded).toBeDefined();
    expect((forwarded?.payload as { eventVersion: number }).eventVersion).toBe(1);
    expect((forwarded?.payload as { type: string }).type).toBe(firstEvent);
  });

  it("assigns capabilityEventBridgeUnsubscribe on state", () => {
    const state = makeStubState();
    const context = makeFakeContext();

    wireForwardedEvents({
      state,
      context: context as never,
      emitRendererEvent: () => undefined,
      emitPluginEvent: () => undefined,
    });

    expect(state.capabilityEventBridgeUnsubscribe).not.toBeNull();
    // Calling unsubscribe must not throw.
    expect(() => state.capabilityEventBridgeUnsubscribe?.()).not.toThrow();
  });
});
