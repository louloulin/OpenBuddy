import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GatewayTransport } from "../gateway-transport";

/**
 * A fetch impl that serves the bridge contract from memory: one SSE stream the
 * test pushes frames into, and a command router.
 */
function fakeBridge(commands: Record<string, (payload: unknown) => unknown> = {}) {
  const streamControllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const eventsUrls: string[] = [];

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/events")) {
      eventsUrls.push(url);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamControllers.push(controller);
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    const match = /\/cmd\/([\w:]+)$/.exec(url);
    if (!match) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const handler = commands[match[1]!];
    if (!handler) {
      return new Response(JSON.stringify({ error: `not_implemented: ${match[1]}` }), { status: 404 });
    }
    try {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return new Response(JSON.stringify({ ok: true, result: handler(payload) ?? null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "boom" }), { status: 500 });
    }
  }) as typeof fetch;

  return {
    fetchImpl,
    /** Every `/events` URL the transport asked for, oldest first. */
    eventsUrls,
    /** Push one SSE frame into the latest open stream. */
    push: (event: string, seq: number, data: unknown) => {
      streamControllers.at(-1)?.enqueue(new TextEncoder().encode(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
    /** Ends the current stream, as a dropped connection would. */
    drop: () => {
      streamControllers.at(-1)?.close();
    },
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("GatewayTransport", () => {
  let transports: GatewayTransport[] = [];
  const track = (transport: GatewayTransport) => {
    transports.push(transport);
    return transport;
  };
  afterEach(() => {
    for (const transport of transports) transport.close();
    transports = [];
  });

  it("invoke posts the payload and unwraps the result", async () => {
    const bridge = fakeBridge({
      agent_list_sessions: payload => ({ got: payload, sessions: ["s1"] }),
    });
    const transport = track(new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl }));
    const result = await transport.invoke<{ got: unknown; sessions: string[] }>("agent_list_sessions", { cwd: "/x" });
    expect(result.sessions).toEqual(["s1"]);
    await expect(transport.invoke("agent_send")).rejects.toThrow("not_implemented");
  });

  it("listen receives live events", async () => {
    const bridge = fakeBridge();
    const transport = track(new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl }));
    const seen: unknown[] = [];
    const unlisten = await transport.listen<{ n: number }>("agent://event", payload => seen.push(payload));
    await sleep(50);
    bridge.push("agent://event", 1, { n: 1 });
    bridge.push("agent://event", 2, { n: 2 });
    await sleep(80);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    unlisten();
  });

  it("early events are buffered until a listener subscribes", async () => {
    const bridge = fakeBridge();
    const transport = track(new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl }));
    await sleep(50);
    bridge.push("agent://event", 1, { early: true });
    await sleep(80);
    const seen: unknown[] = [];
    await transport.listen<{ early: boolean }>("agent://event", payload => seen.push(payload));
    expect(seen).toEqual([{ early: true }]);
  });

  it("state transitions are reported", async () => {
    const bridge = fakeBridge();
    const transport = track(new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl }));
    const states: string[] = [];
    transport.onState(state => states.push(state));
    await sleep(80);
    expect(states).toContain("open");
    transport.close();
    expect(transport.state()).toBe("closed");
  });

  it("reconnects from the last seen seq and keeps delivering", async () => {
    const bridge = fakeBridge();
    const transport = track(new GatewayTransport({
      baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl, maxBackoffMs: 50,
    }));
    const seen: unknown[] = [];
    await transport.listen<{ n: number }>("agent://event", payload => seen.push(payload));
    await sleep(50);
    bridge.push("agent://event", 1, { n: 1 });
    bridge.push("agent://event", 2, { n: 2 });
    await sleep(60);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);

    // The connection drops; the retry must resume after seq 2, not from zero.
    bridge.drop();
    await sleep(200);
    expect(bridge.eventsUrls.at(-1)).toContain("since=2");

    bridge.push("agent://event", 3, { n: 3 });
    await sleep(60);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("streams events without TextDecoderStream (React Native/Hermes)", async () => {
    // Hermes ships TextDecoder but not the TransformStream wrapper, so the
    // transport must decode by hand. Remove it for this test only.
    const globalWithStream = globalThis as { TextDecoderStream?: unknown };
    const saved = globalWithStream.TextDecoderStream;
    delete globalWithStream.TextDecoderStream;
    try {
      const bridge = fakeBridge();
      const transport = track(new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl }));
      const seen: unknown[] = [];
      await transport.listen<{ n: number }>("agent://event", payload => seen.push(payload));
      await sleep(50);
      bridge.push("agent://event", 1, { n: 1 });
      bridge.push("agent://event", 2, { n: 2 });
      await sleep(80);
      expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    } finally {
      globalWithStream.TextDecoderStream = saved;
    }
  });
});
