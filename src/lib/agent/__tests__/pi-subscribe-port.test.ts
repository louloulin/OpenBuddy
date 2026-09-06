import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribePiEvents } from "@/lib/agent/pi-client";

interface FakeBridge {
  apiVersion: 1;
  invoke: ReturnType<typeof vi.fn>;
  rpc: { request: ReturnType<typeof vi.fn>; onMessage: () => () => void };
  events: {
    on: ReturnType<typeof vi.fn>;
    openPiStream: ReturnType<typeof vi.fn>;
  };
}

const bridgeState = {
  portHandler: null as ((payload: unknown) => void) | null,
  listeners: new Map<string, (payload: unknown) => void>(),
  withPort: true,
  openPiStreamCalls: 0,
};

function makeBridge(): FakeBridge {
  const bridge: FakeBridge = {
    apiVersion: 1,
    invoke: vi.fn(async () => ({ ok: true })),
    rpc: {
      request: vi.fn(async () => ({ type: "server-response", rpcId: "x", value: {} })),
      onMessage: () => () => undefined,
    },
    events: {
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        bridgeState.listeners.set(channel, handler);
        return () => bridgeState.listeners.delete(channel);
      }),
      openPiStream: vi.fn(async (handler: (payload: unknown) => void) => {
        bridgeState.openPiStreamCalls += 1;
        if (!bridgeState.withPort) return null;
        bridgeState.portHandler = handler;
        return () => { bridgeState.portHandler = null; };
      }),
    },
  };
  return bridge;
}

let bridge: FakeBridge | null = null;
const captured: Array<{ sessionId?: string; type: string }> = [];

function emitPort(batch: unknown): void {
  bridgeState.portHandler?.(batch);
}

function emitIpcUpdate(payload: unknown): void {
  const handler = bridgeState.listeners.get("pi://update");
  if (!handler) throw new Error("no ipc update listener");
  handler(payload);
}

describe("subscribePiEvents — stream port transport", () => {
  beforeEach(() => {
    captured.length = 0;
    bridgeState.listeners.clear();
    bridgeState.portHandler = null;
    bridgeState.openPiStreamCalls = 0;
    bridgeState.withPort = true;
    bridge = makeBridge();
    (window as unknown as { api?: unknown }).api = bridge;
  });

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
    bridge = undefined;
    bridgeState.portHandler = null;
  });

  it("uses the port and delivers batched updates with sessionId mapping", async () => {
    const onUpdate = vi.fn((u: { __sessionId?: string; type: string }) => {
      captured.push({ sessionId: u.__sessionId, type: u.type });
    });
    const unlisten = await subscribePiEvents({ onUpdate });
    expect(bridgeState.openPiStreamCalls).toBe(1);
    // No IPC pi://update listener when the port is attached.
    expect(bridgeState.listeners.has("pi://update")).toBe(false);
    emitPort({
      version: 1,
      events: [
        { sessionId: "s1", type: "agent_message_chunk", content: [{ type: "text_delta", text: "hi" }] },
        { sessionId: "s1", type: "agent_thought_chunk", content: [{ type: "thinking_delta", text: "..." }] },
      ],
    });
    expect(captured).toEqual([
      { sessionId: "s1", type: "agent_message_chunk" },
      { sessionId: "s1", type: "agent_thought_chunk" },
    ]);
    unlisten();
  });

  it("falls back to the IPC listener when the bridge has no port API", async () => {
    bridge = makeBridge(false);
    bridgeState.withPort = false;
    (window as unknown as { api?: unknown }).api = bridge;
    const onUpdate = vi.fn((u: { __sessionId?: string; type: string }) => {
      captured.push({ sessionId: u.__sessionId, type: u.type });
    });
    await subscribePiEvents({ onUpdate });
    expect(bridgeState.openPiStreamCalls).toBe(1);
    expect(bridgeState.listeners.has("pi://update")).toBe(true);
    emitIpcUpdate({ sessionId: "s2", type: "agent_message_chunk", content: [] });
    expect(captured).toEqual([{ sessionId: "s2", type: "agent_message_chunk" }]);
  });

  it("honours explicit ipc transport without touching the port", async () => {
    const onUpdate = vi.fn();
    await subscribePiEvents({ onUpdate }, { updateTransport: "ipc" });
    expect(bridgeState.openPiStreamCalls).toBe(0);
    expect(bridgeState.listeners.has("pi://update")).toBe(true);
  });

  it("unlisten closes the port and stops delivery", async () => {
    const onUpdate = vi.fn();
    const unlisten = await subscribePiEvents({ onUpdate });
    unlisten();
    emitPort({ version: 1, events: [{ sessionId: "s1", type: "agent_message_chunk" }] });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("defensively drops malformed batch members without killing delivery", async () => {
    const onUpdate = vi.fn();
    await subscribePiEvents({ onUpdate });
    emitPort({ version: 1, events: [null, "junk", { sessionId: "s1", type: "tool_call", toolCallId: "t1" }] });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect((onUpdate.mock.calls[0][0] as { __sessionId?: string }).__sessionId).toBe("s1");
  });
});
