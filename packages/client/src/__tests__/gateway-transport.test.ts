import { afterEach, describe, expect, it } from "vitest";

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

describe("GatewayTransport — liveness and revocation", () => {
  it("a heartbeat frame keeps the stream alive and never reaches a listener", async () => {
    const bridge = fakeBridge();
    const transport = new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl });
    const seen: unknown[] = [];
    await transport.listen("agent://event", payload => seen.push(payload));
    await sleep(50);
    bridge.push("ping", 0, { t: Date.now() });
    bridge.push("agent://event", 1, { n: 1 });
    await sleep(80);
    expect(seen).toEqual([{ n: 1 }]);
    transport.close();
  });

  it("a 401 on the event stream reports the credential as refused", async () => {
    let unauthorized = false;
    const transport = new GatewayTransport({
      baseUrl: "http://bridge.test",
      token: "t",
      onUnauthorized: () => { unauthorized = true; },
      fetchImpl: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
    });
    await sleep(80);
    expect(unauthorized).toBe(true);
    expect(transport.state()).toBe("closed");
  });

  it("a 401 on a command reports the credential as refused", async () => {
    let unauthorized = false;
    const transport = new GatewayTransport({
      baseUrl: "http://bridge.test",
      token: "t",
      onUnauthorized: () => { unauthorized = true; },
      fetchImpl: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(transport.invoke("agent_send")).rejects.toThrow("unauthorized");
    expect(unauthorized).toBe(true);
  });

  it("a silent stream past the heartbeat window is treated as dead", async () => {
    // The stream never sends a frame; the transport must notice on its own.
    const transport = new GatewayTransport({
      baseUrl: "http://bridge.test",
      token: "t",
      heartbeatTimeoutMs: 60,
      fetchImpl: (async (input: unknown) => {
        if (String(input).includes("/events")) {
          const body = new ReadableStream<Uint8Array>({ start() { /* never writes */ } });
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
      }) as unknown as typeof fetch,
    });
    await sleep(200);
    // The transport gave up on the dead stream and started reconnecting.
    expect(transport.state()).not.toBe("closed");
    transport.close();
  });

  it("reconnectNow drops the backoff and reconnects", async () => {
    const bridge = fakeBridge();
    const transport = new GatewayTransport({ baseUrl: "http://bridge.test", token: "t", fetchImpl: bridge.fetchImpl });
    await sleep(60);
    transport.reconnectNow();
    expect(transport.state()).toBe("connecting");
    await sleep(80);
    expect(transport.state()).toBe("open");
    transport.close();
  });
});

describe("GatewayTransport default fetch", () => {
  it("calls the global fetch as a plain function, not as a method of the transport", async () => {
    // Browsers implement fetch on Window; a detached call with a foreign
    // `this` throws "Illegal invocation". Node tolerates it, so assert the
    // receiver explicitly.
    const original = globalThis.fetch;
    const receivers: unknown[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: hello\ndata: {\"head\":0,\"resync\":false}\n\n"));
      },
    });
    globalThis.fetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    } as typeof fetch;
    try {
      const transport = new GatewayTransport({ baseUrl: "http://bridge.test", token: "t" });
      await sleep(60);
      transport.close();
      expect(receivers.length).toBeGreaterThan(0);
      for (const receiver of receivers) {
        expect(receiver === undefined || receiver === globalThis).toBe(true);
      }
    } finally {
      globalThis.fetch = original;
    }
  });
});
