import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribePiEvents } from "@/lib/agent/pi-client";
import { createPiEventReplayCoordinator } from "@/lib/agent/pi-event-replay";

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
};

function makeBridge(): FakeBridge {
  return {
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
        bridgeState.portHandler = handler;
        return () => { bridgeState.portHandler = null; };
      }),
    },
  };
}

function emitPort(batch: unknown): void {
  if (!bridgeState.portHandler) throw new Error("no port handler");
  bridgeState.portHandler(batch);
}

describe("subscribePiEvents + replay coordinator — streaming doubling regression", () => {
  beforeEach(() => {
    bridgeState.listeners.clear();
    bridgeState.portHandler = null;
    (window as unknown as { api?: unknown }).api = makeBridge();
  });

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
    bridgeState.portHandler = null;
  });

  // Regression test for the streaming-text doubling bug: before the fix,
  // each pi://update was applied twice because acceptLive synchronously
  // dispatched fresh sequenced events AND deliver()'s fallback
  // `eventGate?.(...) ?? dispatch()` re-ran dispatch().
  // Fix: acceptLive returns boolean, deliver() only falls through when the
  // gate returned false (unsequenced payloads it cannot manage).

  function wireReplayGate() {
    const coordinator = createPiEventReplayCoordinator();
    coordinator.begin();
    coordinator.finish([]); // simulate empty replay so live events dispatch immediately
    return coordinator;
  }

  it("delivers each sequenced delta exactly once (no doubling) when wired through the replay coordinator", async () => {
    const coordinator = wireReplayGate();
    const onUpdate = vi.fn((u: { sequence?: number; content?: Array<{ type: string; text?: string }> }) => u);

    const unlisten = await subscribePiEvents(
      { onUpdate },
      {
        eventGate: (delivery) => coordinator.acceptLive(delivery.payload, delivery.dispatch),
      },
    );

    // Simulate the exact scenario that previously produced
    //   "REALREAL-UI-T-UI-TURN-1URN-1"
    // when the harness sent 5 text deltas over the port.
    const sessionId = "s-regression";
    const deltas = ["R", "E", "A", "L", "-"];
    emitPort({
      version: 1,
      events: deltas.map((text, i) => ({
        sessionId,
        sequence: 100 + i,
        type: "agent_message_chunk",
        content: [{ type: "text_delta", text }],
      })),
    });

    expect(onUpdate).toHaveBeenCalledTimes(deltas.length);

    const seenSequences: number[] = [];
    let assembledText = "";
    for (const call of onUpdate.mock.calls) {
      const payload = call[0] as { sequence?: number; content?: Array<{ type: string; text?: string }> };
      if (typeof payload.sequence === "number") seenSequences.push(payload.sequence);
      const delta = payload.content?.find((c) => c.type === "text_delta")?.text;
      if (typeof delta === "string") assembledText += delta;
    }
    expect(seenSequences).toEqual([100, 101, 102, 103, 104]);
    expect(assembledText).toBe("REAL-");

    unlisten();
  });

  it("delivers unsequenced payloads exactly once (caller falls through, gate returns false)", async () => {
    const coordinator = wireReplayGate();
    const onUpdate = vi.fn();

    await subscribePiEvents(
      { onUpdate },
      {
        eventGate: (delivery) => coordinator.acceptLive(delivery.payload, delivery.dispatch),
      },
    );

    // Unsequenced events: acceptLive returns false, deliver() falls through
    // and dispatches exactly once.
    emitPort({
      version: 1,
      events: [
        { sessionId: "s", type: "tool_permission", toolCallId: "t1" },
        { sessionId: "s", type: "tool_permission", toolCallId: "t2" },
      ],
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("stays dedup-correct after a replay flush — replay-then-live does not re-apply shared sequence", async () => {
    const coordinator = createPiEventReplayCoordinator();
    coordinator.begin(); // hold the gate open: live events queue instead of dispatching

    const onUpdate = vi.fn();
    await subscribePiEvents(
      { onUpdate },
      {
        eventGate: (delivery) => coordinator.acceptLive(delivery.payload, delivery.dispatch),
      },
    );

    // Live delivery for seq 10 is QUEUED (replaying=true). No onUpdate yet.
    emitPort({
      version: 1,
      events: [{ sessionId: "s", sequence: 10, type: "agent_message_chunk" }],
    });
    expect(onUpdate).toHaveBeenCalledTimes(0);

    // finish() drains both replay and queued-live streams in sequence order,
    // deduplicating shared sequences.
    coordinator.finish([
      { sequence: 10, dispatch: () => onUpdate({ sequence: 10, type: "replay-10" }) },
      { sequence: 11, dispatch: () => onUpdate({ sequence: 11, type: "replay-11" }) },
    ]);

    // Live seq 10 and replay seq 10 are the same sequence — the coordinator
    // dedupes via dispatchOrdered (replay takes priority on ties? actually
    // whichever arrives first in the merged sort wins; both contain seq 10
    // and dispatchOrdered drops duplicates). After dedupe, seq 10 must
    // appear EXACTLY ONCE and seq 11 EXACTLY ONCE.
    const seenAfterFlush: number[] = [];
    for (const call of onUpdate.mock.calls) {
      const payload = call[0] as { sequence?: number };
      if (typeof payload.sequence === "number") seenAfterFlush.push(payload.sequence);
    }
    expect(seenAfterFlush.filter((s) => s === 10)).toHaveLength(1);
    expect(seenAfterFlush.filter((s) => s === 11)).toHaveLength(1);
  });
});
