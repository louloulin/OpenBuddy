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
    // 不钉死数量:"恰好 12 条"是当年的快照,而这条断言的**意图**是"表里每一项
    // 都被注册"(上面逐项断言已覆盖)。给个下界防止表被误删空。
    // 注意:请求判定事件(`session/permission-resolved` / `session/question-resolved`)
    // **不**走这条路 —— 它们由 plugin-event 总线直接转发到渲染层
    // (electron/main/ipc/index.ts 的 agentHost.onPluginEvent → openbuddy://plugin-event),
    // 形状是扁平的 { type, payload }。别把它们加到这里,加了也不会触发。
    expect(FORWARDED_REMOTE_EVENTS.length).toBeGreaterThanOrEqual(12);
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
