import { describe, expect, it, vi } from "vitest";
import { bindCapabilityEventBridge } from "./capability-event-bridge";

type Listener = (payload: unknown) => void;

function createContext() {
  const listeners = new Map<string, Listener[]>();
  return {
    on(event: string, listener: Listener) {
      const current = listeners.get(event) ?? [];
      listeners.set(event, [...current, listener]);
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener));
      };
    },
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    count(event: string) {
      return listeners.get(event)?.length ?? 0;
    },
  };
}

describe("capability event bridge", () => {
  it("forwards capability events to the plugin log and Pi renderer channels", () => {
    const context = createContext();
    const emitPluginEvent = vi.fn();
    const emitRendererEvent = vi.fn();
    const unbind = bindCapabilityEventBridge({
      context,
      getSessionId: () => "session-current",
      emitPluginEvent,
      emitRendererEvent,
    });

    context.emit("plan/toggled", { enabled: true });
    context.emit("folder-trust/changed", { sessionId: "session-folder", trusted: true });

    expect(emitPluginEvent).toHaveBeenNthCalledWith(1, "capability/plan/toggled", {
      enabled: true,
      sessionId: "session-current",
    });
    expect(emitRendererEvent).toHaveBeenNthCalledWith(1, "pi://plan-mode", {
      enabled: true,
      sessionId: "session-current",
    });
    expect(emitPluginEvent).toHaveBeenNthCalledWith(2, "capability/folder-trust/changed", {
      sessionId: "session-folder",
      trusted: true,
    });
  });

  it("wraps primitive payloads and keeps all declared mappings active", () => {
    const context = createContext();
    const emitPluginEvent = vi.fn();
    const emitRendererEvent = vi.fn();
    const unbind = bindCapabilityEventBridge({
      context,
      getSessionId: () => "session-1",
      emitPluginEvent,
      emitRendererEvent,
    });
    const sources = [
      ["permission/mode-set", "pi://permission-mode"],
      ["plan/pending", "pi://plan-mode"],
      ["plan/review-declined", "pi://plan-mode"],
      ["mcp/ready", "pi://mcp-status"],
      ["mcp/failed", "pi://mcp-status"],
      ["mcp/close-failed", "pi://mcp-status"],
      ["mcp/tool-start", "pi://mcp-status"],
      ["mcp/tool-end", "pi://mcp-status"],
      ["task/added", "pi://task-update"],
      ["task/updated", "pi://task-update"],
      ["task/completed", "pi://task-update"],
      ["task/removed", "pi://task-update"],
      ["task/cleared", "pi://task-update"],
    ] as const;

    for (const [source, channel] of sources) context.emit(source, "payload");

    expect(emitPluginEvent).toHaveBeenCalledTimes(sources.length);
    expect(emitRendererEvent).toHaveBeenNthCalledWith(1, "pi://permission-mode", {
      value: "payload",
      sessionId: "session-1",
    });
    expect(emitRendererEvent).toHaveBeenLastCalledWith("pi://task-update", {
      value: "payload",
      sessionId: "session-1",
    });
    unbind();
  });

  it("normalizes permission modes for the renderer contract", () => {
    const context = createContext();
    const emitPluginEvent = vi.fn();
    const emitRendererEvent = vi.fn();
    const unbind = bindCapabilityEventBridge({
      context,
      getSessionId: () => "session-1",
      emitPluginEvent,
      emitRendererEvent,
    });

    context.emit("permission/mode-set", { mode: "acceptEdits" });

    // 5档 1:1 透传:renderer-side 直接收到 Pi 原生 mode id,不再做 3 档 re-projection。
    expect(emitRendererEvent).toHaveBeenCalledWith("pi://permission-mode", {
      mode: "acceptEdits",
      sessionId: "session-1",
    });
    unbind();
  });

  it("unbinds every listener so a reinitialized host cannot duplicate events", () => {
    const context = createContext();
    const emitPluginEvent = vi.fn();
    const emitRendererEvent = vi.fn();
    const unbind = bindCapabilityEventBridge({
      context,
      getSessionId: () => "session-1",
      emitPluginEvent,
      emitRendererEvent,
    });

    expect(context.count("plan/toggled")).toBe(1);
    unbind();
    context.emit("plan/toggled", { enabled: false });

    expect(context.count("plan/toggled")).toBe(0);
    expect(emitPluginEvent).not.toHaveBeenCalled();
    expect(emitRendererEvent).not.toHaveBeenCalled();
  });
});
