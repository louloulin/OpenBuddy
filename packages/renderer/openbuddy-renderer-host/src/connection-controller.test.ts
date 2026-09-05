import { describe, expect, it, vi } from "vitest";
import { ConnectionController } from "./connection-controller";

describe("ConnectionController", () => {
  it("reconnects after a carrier disconnect and isolates generations", async () => {
    const disconnects: Array<() => void> = [];
    const connected: number[] = [];
    const states: string[] = [];
    let opens = 0;
    const controller = new ConnectionController({
      carrier: {
        open: async (_signal, sink, onDisconnect) => {
          opens += 1;
          disconnects.push(onDisconnect);
          sink({ value: opens });
          return { description: { opens }, close: vi.fn() };
        },
      },
      config: { backoffBaseMs: 0, backoffMaxMs: 0 },
      onConnected: (_description, generation) => connected.push(generation),
      onStateChange: (state) => states.push(state),
    });
    const first = controller.start();
    const same = controller.start();
    expect(same).toBe(first);
    await vi.waitFor(() => expect(connected).toEqual([1]));
    disconnects[0]?.();
    await vi.waitFor(() => expect(connected).toEqual([1, 2]));
    expect(states).toEqual(["connected", "reconnecting", "connected"]);
    controller.stop();
  });

  it("retries a failed carrier open and stops without a late reconnect", async () => {
    let opens = 0;
    const connected: number[] = [];
    const controller = new ConnectionController({
      carrier: {
        open: async () => {
          opens += 1;
          if (opens === 1) throw new Error("offline");
          return { description: {}, close: () => undefined };
        },
      },
      config: { backoffBaseMs: 0, backoffMaxMs: 0 },
      onConnected: (_description, generation) => connected.push(generation),
    });
    controller.start();
    await vi.waitFor(() => expect(connected).toEqual([2]));
    controller.stop();
    const count = opens;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(opens).toBe(count);
  });

  it("closes a carrier that resolves after stop", async () => {
    let resolveOpen!: (value: { description: unknown; close: () => void }) => void;
    const close = vi.fn();
    const controller = new ConnectionController({
      carrier: { open: () => new Promise((resolve) => { resolveOpen = resolve; }) },
      config: { backoffBaseMs: 0, backoffMaxMs: 0 },
    });
    controller.start();
    controller.stop();
    resolveOpen({ description: {}, close });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not publish connected when the carrier disconnects during open", async () => {
    const connected: number[] = [];
    const controller = new ConnectionController({
      carrier: {
        open: async (_signal, _emit, onDisconnect) => {
          onDisconnect();
          return { description: {}, close: vi.fn() };
        },
      },
      config: { backoffBaseMs: 0, backoffMaxMs: 0 },
      onConnected: (_description, generation) => connected.push(generation),
    });
    controller.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.stop();
    expect(connected).toEqual([]);
  });
});
