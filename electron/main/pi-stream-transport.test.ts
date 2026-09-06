import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  const state: {
    ports: Array<{
      id: number;
      started: boolean;
      closed: boolean;
      messages: unknown[];
      closeHandlers: Array<() => void>;
      start: () => void;
      postMessage: (message: unknown) => void;
      close: () => void;
    }>;
    transferred: Array<{ channel: string; transfer: unknown[] }>;
  } = { ports: [], transferred: [] };
  return state;
});

vi.mock("electron", () => {
  let nextId = 0;
  return {
    BrowserWindow: class {},
    MessageChannelMain: class {
      port1 = new (class {
        id = ++nextId;
        started = false;
        closed = false;
        messages: unknown[] = [];
        closeHandlers: Array<() => void> = [];
        start(): void { this.started = true; }
        postMessage(message: unknown): void { this.messages.push(message); }
        once(event: string, handler: () => void): this {
          if (event === "close") this.closeHandlers.push(handler);
          return this;
        }
        close(): void {
          this.closed = true;
          for (const handler of this.closeHandlers.splice(0)) handler();
        }
      })();
      port2 = new (class {
        id = ++nextId;
        start(): void {}
        postMessage(): void {}
        once(): this { return this; }
        close(): void {}
      })();
      constructor() {
        electronState.ports.push(this.port1);
      }
    },
    makeWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        postMessage: (channel: string, message: unknown, transfer?: unknown[]) => {
          electronState.transferred.push({ channel, transfer: transfer ?? [] });
        },
      },
    }),
  };
});

import { createPiStreamTransport, PI_STREAM_BATCH_WINDOW_MS, PI_STREAM_CHANNEL } from "./pi-stream-transport";
import type { BrowserWindow } from "electron";

let makeWin: () => BrowserWindow;

describe("createPiStreamTransport", () => {
  beforeEach(async () => {
    const mod = (await import("electron")) as unknown as { makeWindow: () => BrowserWindow };
    makeWin = mod.makeWindow;
    electronState.ports.length = 0;
    electronState.transferred.length = 0;
    vi.useFakeTimers();
  });

  it("transfers port2 to the renderer frame on attach and starts both endpoints", () => {
    const transport = createPiStreamTransport();
    const win = makeWin();
    expect(transport.attach(win)).toBe(true);
    expect(electronState.transferred).toHaveLength(1);
    expect(electronState.transferred[0].channel).toBe(PI_STREAM_CHANNEL);
    expect(electronState.transferred[0].transfer).toHaveLength(1);
  });

  it("batches updates into one 16ms port message, preserving FIFO order", () => {
    const transport = createPiStreamTransport();
    const win = makeWin();
    transport.attach(win);
    transport.publish({ type: "a" });
    transport.publish({ type: "b" });
    transport.publish({ type: "c" });
    expect(electronState.ports).toHaveLength(1);
    const port1 = electronState.ports[0];
    expect(port1.messages).toHaveLength(0);
    vi.advanceTimersByTime(PI_STREAM_BATCH_WINDOW_MS);
    expect(port1.messages).toHaveLength(1);
    expect(port1.messages[0]).toEqual({ version: 1, events: [{ type: "a" }, { type: "b" }, { type: "c" }] });
  });

  it("flushes immediately when the buffer cap is exceeded", () => {
    const transport = createPiStreamTransport();
    transport.attach(makeWin());
    const port1 = electronState.ports[0];
    for (let i = 0; i < 4096; i += 1) transport.publish({ i });
    // One more push over the cap drains synchronously.
    transport.publish({ overflow: true });
    expect(port1.messages).toHaveLength(1);
    expect(port1.messages[0]).toMatchObject({ version: 1 });
    expect((port1.messages[0] as { events: unknown[] }).events).toHaveLength(4096);
    vi.advanceTimersByTime(PI_STREAM_BATCH_WINDOW_MS);
    expect(port1.messages).toHaveLength(2);
    expect((port1.messages[1] as { events: unknown[] }).events).toEqual([{ overflow: true }]);
  });

  it("flush() forces buffered deltas out before an ordering-sensitive event", () => {
    const transport = createPiStreamTransport();
    transport.attach(makeWin());
    const port1 = electronState.ports[0];
    transport.publish({ type: "agent_message_chunk" });
    transport.flush();
    transport.publish({ type: "tool_call_update" });
    expect(port1.messages).toHaveLength(1);
    expect(port1.messages[0]).toEqual({ version: 1, events: [{ type: "agent_message_chunk" }] });
    vi.advanceTimersByTime(PI_STREAM_BATCH_WINDOW_MS);
    expect(port1.messages).toHaveLength(2);
    expect((port1.messages[1] as { events: unknown[] }).events).toEqual([{ type: "tool_call_update" }]);
  });

  it("drops updates after close() and closes the port", () => {
    const transport = createPiStreamTransport();
    transport.attach(makeWin());
    const port1 = electronState.ports[0];
    transport.close();
    expect(port1.closed).toBe(true);
    transport.publish({ type: "late" });
    vi.advanceTimersByTime(PI_STREAM_BATCH_WINDOW_MS);
    expect(port1.messages).toHaveLength(0);
  });

  it("attach() replaces a previous port", () => {
    const transport = createPiStreamTransport();
    transport.attach(makeWin());
    const first = electronState.ports[0];
    transport.attach(makeWin());
    expect(first.closed).toBe(true);
    expect(electronState.ports).toHaveLength(2);
    transport.publish({ type: "x" });
    vi.advanceTimersByTime(PI_STREAM_BATCH_WINDOW_MS);
    expect(electronState.ports[1].messages).toHaveLength(1);
    expect(first.messages).toHaveLength(0);
  });
});
