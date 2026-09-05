import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createWebHarnessTransport } from "./harness-transport";
import { HarnessServer, type HarnessServerAgent } from "../../../../electron/main/harness/harness-server";

class FakeSocket {
  readonly OPEN = 1;
  readonly CONNECTING = 0;
  readyState = this.CONNECTING;
  closed = false;
  sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", {});
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emit(type: string, event: any): void {
    if (type === "open") this.readyState = this.OPEN;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

describe("createWebHarnessTransport", () => {
  it("connects to a real HarnessServer over mux and host carriers", async () => {
    const eventHandlers = new Set<(event: unknown) => void>();
    const pluginHandlers = new Set<(event: { type: string; payload: unknown; sequence?: number }) => void>();
    const agent: HarnessServerAgent & {
      emitEvent: (event: unknown) => void;
      emitPlugin: (event: { type: string; payload: unknown; sequence?: number }) => void;
    } = {
      onEvent: (handler) => { eventHandlers.add(handler); return () => eventHandlers.delete(handler); },
      onPluginEvent: (handler) => { pluginHandlers.add(handler); return () => pluginHandlers.delete(handler); },
      pluginEvents: () => [],
      resolveUiRequest: () => true,
      emitEvent: (event) => { for (const handler of eventHandlers) handler(event); },
      emitPlugin: (event) => { for (const handler of pluginHandlers) handler(event); },
    };
    const server = new HarnessServer({
      agent,
      authToken: "integration-token",
      dispatchRpc: async (request) => request.method === "host.describe"
        ? { product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" }
        : request.method === "typert.catalog"
          ? { packages: [{ package: "@fixture/demo" }], diagnostics: [] }
        : { accepted: true },
    });
    const address = await server.start();
    const events: HarnessTransportEvent[] = [];
    const persisted: Array<Record<string, number>> = [];
    const transport = createWebHarnessTransport({
      baseUrl: address.baseUrl,
      authToken: address.token,
      fetch: (input, init) => globalThis.fetch(input, { ...init, signal: undefined }),
      webSocket: (url) => new WebSocket(url) as unknown as {
        readonly readyState: number;
        readonly OPEN: number;
        readonly CONNECTING: number;
        addEventListener: (type: string, listener: (event: any) => void, options?: { once?: boolean }) => void;
        removeEventListener: (type: string, listener: (event: any) => void) => void;
        send: (data: string) => void;
        close: () => void;
      },
      persistCursors: (cursor) => { persisted.push(cursor); },
    });
    try {
      const opened = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
      const rpc = await transport.call("/api", "host.describe", {});
      expect(rpc).toEqual({ ok: true, value: { product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" } });
      await expect(transport.call("/api", "typert.catalog", {})).resolves.toEqual({
        ok: true,
        value: { packages: [{ package: "@fixture/demo" }], diagnostics: [] },
      });

      agent.emitEvent({
        type: "assistant/end",
        sessionId: "integration-session",
        sessionSequence: 2,
        sequence: 20,
        payload: { text: "carrier-ok" },
      });
      agent.emitPlugin({
        type: "pi/extensions-resolved",
        sequence: 21,
        payload: { builtins: ["openbuddy-pi-observability"], paths: [], availableBuiltins: ["openbuddy-pi-observability"], commands: ["mcp"] },
      });
      await vi.waitFor(() => expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "session/event", payload: expect.objectContaining({ sessionId: "integration-session", sequence: 2, eventSequence: 20 }) }),
        expect.objectContaining({ type: "plugin/event", payload: expect.objectContaining({ type: "pi/extensions-resolved", sequence: 21 }) }),
      ])));
      await opened.close();
      expect(persisted.at(-1)).toEqual({ "integration-session": 2 });
    } finally {
      await server.close();
    }
  });

  it("does not let a session snapshot suppress replayed events", async () => {
    const eventHandlers = new Set<(event: unknown) => void>();
    const pluginHandlers = new Set<(event: { type: string; payload: unknown; sequence?: number }) => void>();
    const agent: HarnessServerAgent = {
      onEvent: (handler) => { eventHandlers.add(handler); return () => eventHandlers.delete(handler); },
      onPluginEvent: (handler) => { pluginHandlers.add(handler); return () => pluginHandlers.delete(handler); },
      sessionBaselines: () => [{ sessionId: "replay-session", lastSeq: 2 }],
      pluginEvents: () => [
        { sequence: 10, sessionSequence: 1, type: "turn/end", payload: { sessionId: "replay-session", type: "turn_end", value: "old" } },
        { sequence: 11, sessionSequence: 2, type: "turn/end", payload: { sessionId: "replay-session", type: "turn_end", value: "replayed" } },
      ],
      resolveUiRequest: () => true,
    };
    const server = new HarnessServer({ agent, dispatchRpc: async (request) => request.method === "host.describe" ? { runtime: "pi" } : {} });
    const address = await server.start();
    const events: HarnessTransportEvent[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: address.baseUrl,
      since: () => ({ "replay-session": 1 }),
      fetch: (input, init) => globalThis.fetch(input, { ...init, signal: undefined }),
      webSocket: (url) => new WebSocket(url) as unknown as {
        readonly readyState: number;
        readonly OPEN: number;
        readonly CONNECTING: number;
        addEventListener: (type: string, listener: (event: any) => void, options?: { once?: boolean }) => void;
        removeEventListener: (type: string, listener: (event: any) => void) => void;
        send: (data: string) => void;
        close: () => void;
      },
    });
    try {
      const opened = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
      await vi.waitFor(() => expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "session/event",
          payload: expect.objectContaining({ sessionId: "replay-session", sequence: 2, eventSequence: 11 }),
        }),
      ])));
      expect(events.some((event) => event.type === "session/event" && JSON.stringify(event.payload).includes('"old"'))).toBe(false);
      await opened.close();
    } finally {
      await server.close();
    }
  });

  it("persists a connection resume token and prefers it on reconnect", async () => {
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const persisted: string[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      loadResumeToken: () => "old-resume-token",
      persistResumeToken: (token) => { persisted.push(token); },
      clientIdentity: "device-a",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
      webSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
    });
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "resume-1", method: "connection/resume", payload: { type: "connection/resume", token: "new-resume-token", cursor: { sequence: 4 } } }) });
    await vi.waitFor(() => expect(persisted).toEqual(["new-resume-token"]));
    expect(urls[0]).toContain("resume=old-resume-token");
    expect(urls[0]).toContain("client=device-a");
    await connection.close();
  });

  it("posts unary RPC and validates the response correlation", async () => {
    let request: any;
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { pong: true } } }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    await expect(transport.call("/api", "demo.ping", { value: 1 })).resolves.toEqual({ ok: true, value: { pong: true } });
    expect(request).toMatchObject({ type: "client-request", method: "demo.ping", payload: { value: 1 } });
  });

  it("retries only safe unary reads with the same rpcId after a transport failure", async () => {
    let attempts = 0;
    const requests: any[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        attempts += 1;
        if (attempts === 1) throw new Error("connection reset");
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { read: true } } }));
      },
    });
    await expect(transport.call("/api", "session.history", { sessionId: "s1" })).resolves.toEqual({ ok: true, value: { read: true } });
    expect(requests).toHaveLength(2);
    expect(requests[1].rpcId).toBe(requests[0].rpcId);
  });

  it("posts client responses to the Harness response endpoint", async () => {
    let path = "";
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (input) => {
        path = String(input);
        return new Response(JSON.stringify({ accepted: true }));
      },
    });
    await expect(transport.respond({ type: "client-response", rpcId: "request-1" as never, result: { ok: true, value: {} } })).resolves.toEqual({ accepted: true });
    expect(path).toBe("http://localhost:4321/api/respond");
  });

  it("opens independent mux and host sockets and drops malformed frames", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { product: "OpenBuddy", runtime: "pi" } } }), {
          headers: { "content-type": "application/json" },
        });
      },
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
    });

    const controller = new AbortController();
    const opened = transport.open(controller.signal, (event) => events.push(event), () => undefined);
    const connection = await opened;
    sockets[0]?.emit("message", { data: "not-json" });
    sockets[0]?.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "subscribed-s1", method: "session/subscribed", payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 4 } }) });
    sockets[0]?.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "mux-1", method: "session/event", payload: { type: "session/event", sessionId: "s1", event: { type: "turn/end" } } }) });
    sockets[1]?.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "host-1", method: "host/session-added", payload: { type: "host/session-added", sessionId: "s1", blank: false } }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sockets).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({ type: "session/subscribed", rpcId: "subscribed-s1", payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 4 }, respond: expect.any(Function) }),
      expect.objectContaining({ type: "session/event", rpcId: "mux-1", payload: { sessionId: "s1", payload: { type: "turn/end" } }, respond: expect.any(Function) }),
      expect.objectContaining({ type: "plugin/event", rpcId: "host-1", payload: { type: "session/created", payload: { type: "host/session-added", sessionId: "s1", blank: false } }, respond: expect.any(Function) }),
    ]);
    await connection.close();
    expect(sockets.every((socket) => socket.closed)).toBe(true);
  });

  it("preserves the Harness envelope sequence for host frames", async () => {
    const events: HarnessTransportEvent[] = [];
    const sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { rpcId: string };
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: {} } }), {
          headers: { "content-type": "application/json" },
        });
      },
      webSocket: (url) => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
    });
    const connection = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    sockets[1]!.emit("message", { data: JSON.stringify({
      type: "server-request",
      rpcId: "host-sequence",
      method: "host/session-status",
      sequence: 17,
      payload: { type: "host/session-status", sessionId: "s1", running: true },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual(expect.objectContaining({
      type: "plugin/event",
      payload: expect.objectContaining({ type: "session/status", sequence: 17 }),
    }));
    await connection.close();
  });

  it("adds the last received session sequence to reconnect socket URLs", async () => {
    const urls: string[] = [];
    let sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      webSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: {} } }));
      },
    });
    const first = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0].emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "event-8", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 8, event: { type: "turn/end" } } }) });
    await first.close();
    sockets = [];
    await transport.open(new AbortController().signal, () => undefined, () => undefined);
    const expectedCursor = encodeURIComponent(JSON.stringify({ s1: 8 }));
    expect(urls.slice(-2).every((url) => url.includes(`since=${expectedCursor}`))).toBe(true);
  });

  it("consumes Harness SSE events when explicitly selected", async () => {
    const events: unknown[] = [];
    const makeStream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": open\n\ndata: {\"type\":\"server-request\",\"rpcId\":\"sse-sub\",\"method\":\"session/subscribed\",\"payload\":{\"type\":\"session/subscribed\",\"sessionId\":\"s1\",\"lastSeq\":8}}\n\ndata: {\"type\":\"server-request\",\"rpcId\":\"sse-1\",\"method\":\"session/event\",\"payload\":{\"type\":\"session/event\",\"sessionId\":\"s1\",\"sequence\":9,\"event\":{\"type\":\"turn/end\"}}}\n\n"));
      },
      cancel() {},
    });
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      eventTransport: "sse",
      fetch: async (input, init) => {
        if (String(input).includes("/api/events.")) return new Response(makeStream(), { headers: { "content-type": "text/event-stream" } });
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    const connection = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([
      expect.objectContaining({ type: "session/subscribed", rpcId: "sse-sub", payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 8 } }),
      expect.objectContaining({ type: "session/event", rpcId: "sse-1", payload: { sessionId: "s1", sequence: 9, payload: { type: "turn/end" } } }),
    ]);
    await connection.close();
  });

  it("passes bearer authentication to HTTP, SSE, and reconnect WebSocket carriers", async () => {
    const fetchRequests: Array<{ input: string; headers: Headers }> = [];
    const socketUrls: string[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      authToken: "test-token",
      webSocket: (url) => {
        socketUrls.push(url);
        const socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (input, init) => {
        fetchRequests.push({ input: String(input), headers: new Headers(init?.headers) });
        if (String(input).includes("/api/events.")) {
          return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
        }
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    await transport.call("/api", "host.describe");
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    await connection.close();
    expect(fetchRequests.find((request) => request.input.endsWith("/api/host.describe"))?.headers.get("authorization")).toBe("Bearer test-token");
    expect(fetchRequests.filter((request) => request.input.includes("/api/events.")).every((request) => request.headers.get("authorization") === "Bearer test-token")).toBe(true);
    expect(socketUrls.every((url) => url.includes("token=test-token"))).toBe(true);
  });

  it("aborts a socket that is still connecting", async () => {
    const socket = new FakeSocket();
    const controller = new AbortController();
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      webSocket: () => socket,
      fetch: async () => new Response(JSON.stringify({ type: "server-response", rpcId: "unused", result: {} })),
    });
    const opening = transport.open(controller.signal, () => undefined, () => undefined);
    controller.abort();
    await expect(opening).rejects.toThrow("aborted");
    expect(socket.closed).toBe(true);
  });

  it("exposes a response callback for interactive server requests", async () => {
    const socket = new FakeSocket();
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      webSocket: () => {
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { product: "OpenBuddy", runtime: "pi" } } }));
      },
    });
    const events: any[] = [];
    let responseBody: unknown;
    const opened = transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    await opened;
    socket.emit("message", { data: JSON.stringify({
      type: "server-request",
      rpcId: "permission-1",
      method: "session.permission",
      payload: { type: "approval/requested", sessionId: "s1", approvalId: "permission-1" },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const responseTransport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        responseBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ accepted: true }));
      },
    });
    await responseTransport.respond({ type: "client-response", rpcId: "permission-1" as never, result: { ok: true, value: { optionId: "allow" } } });
    expect(responseBody).toEqual({ type: "client-response", rpcId: "permission-1", result: { ok: true, value: { optionId: "allow" } } });
  });

  it("debounces persistCursors after session/event updates", async () => {
    const persisted: Array<Record<string, number>> = [];
    const sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      persistDebounceMs: 30,
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "ev-3", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 3, event: { type: "turn/end" } } }) });
    sockets[1]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "ev-5", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 5, event: { type: "turn/end" } } }) });
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "ev-5", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 5, event: { type: "turn/end" } } }) });
    void sockets[1];
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(persisted).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(persisted).toEqual([{ s1: 5 }]);
    await connection.close();
  });

  it("uses loadPersistedCursors as the initial reconnect cursor", async () => {
    const urls: string[] = [];
    const persisted: Array<Record<string, number>> = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      loadPersistedCursors: () => ({ s1: 4, s2: 1 }),
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      webSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    await transport.open(new AbortController().signal, () => undefined, () => undefined);
    expect(urls.length).toBe(2);
    const decoded = urls.map((url) => decodeURIComponent(url.split("since=")[1] ?? ""));
    expect(JSON.parse(decoded[0]!)).toEqual({ s1: 4, s2: 1 });
    expect(JSON.parse(decoded[1]!)).toEqual({ s1: 4, s2: 1 });
    expect(persisted).toEqual([]);
  });

  it("flushes the latest cursor synchronously on close", async () => {
    const persisted: Array<Record<string, number>> = [];
    const sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      persistDebounceMs: 10_000,
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "ev-2", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 2, event: { type: "turn/end" } } }) });
    await connection.close();
    expect(persisted.at(-1)).toEqual({ s1: 2 });
  });

  it("rewrites the in-memory cursor to the server lastSeq on session/cursor-gap frames", async () => {
    const persisted: Array<Record<string, number>> = [];
    const urls: string[] = [];
    const sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      persistDebounceMs: 10,
      webSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "ev-7", method: "session/event", payload: { type: "session/event", sessionId: "s1", sequence: 7, event: { type: "turn/end" } } }) });
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "gap-1", method: "session/cursor-gap", payload: { type: "session/cursor-gap", sessionId: "s1", requested: 9, lastSeq: 4 } }) });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(persisted).toEqual([{ s1: 4 }]);
    await connection.close();
    sockets.length = 0;
    urls.length = 0;
    await transport.open(new AbortController().signal, () => undefined, () => undefined);
    const cursorParam = urls.at(-1)?.split("since=")[1];
    const decoded = decodeURIComponent(cursorParam ?? "");
    expect(JSON.parse(decoded)).toEqual({ s1: 4 });
    sockets[0]?.close();
    sockets[1]?.close();
  });

  it("rewinds to the earliest retained sequence on retention gaps", async () => {
    const persisted: Array<Record<string, number>> = [];
    const sockets: FakeSocket[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      persistDebounceMs: 10,
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });
    const connection = await transport.open(new AbortController().signal, () => undefined, () => undefined);
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "server-request", rpcId: "gap-retention", method: "session/cursor-gap", payload: { type: "session/cursor-gap", sessionId: "s1", requested: 1, lastSeq: 6, reason: "retention", earliestSeq: 5 } }) });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(persisted).toEqual([{ s1: 4 }]);
    await connection.close();
    sockets[0]?.close();
    sockets[1]?.close();
  });

  it("emits a pi/extensions-resolved plugin event from host/extensions-resolved frames", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
    });
    const connection = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    sockets[1]!.emit("message", { data: JSON.stringify({
      type: "server-request",
      rpcId: "ext-1",
      method: "host/extensions-resolved",
      payload: {
        type: "host/extensions-resolved",
        builtins: ["openbuddy-pi-observability"],
        paths: ["/abs/path/extension-a"],
        availableBuiltins: ["openbuddy-pi-observability", "openbuddy-pi-context-status", "openbuddy-pi-context-guard"],
        commands: ["mcp", "websearch", "tasks"],
      },
    }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toContainEqual(expect.objectContaining({
      type: "plugin/event",
      rpcId: "ext-1",
      payload: expect.objectContaining({
        type: "pi/extensions-resolved",
        payload: expect.objectContaining({
          builtins: ["openbuddy-pi-observability"],
          paths: ["/abs/path/extension-a"],
          availableBuiltins: ["openbuddy-pi-observability", "openbuddy-pi-context-status", "openbuddy-pi-context-guard"],
          commands: ["mcp", "websearch", "tasks"],
        }),
      }),
    }));
    sockets[0]?.close();
    sockets[1]?.close();
  });

  it("preserves plugin transaction payloads from host/plugin-event frames", async () => {
    const sockets: FakeSocket[] = [];
    const events: unknown[] = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: {} } }));
      },
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
    });
    const connection = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    sockets[1]!.emit("message", { data: JSON.stringify({
      type: "server-request",
      rpcId: "transaction-1",
      method: "host/plugin-event",
      sequence: 42,
      payload: {
        type: "host/plugin-event",
        event: "plugin/transaction-complete",
        payload: { transactionId: "plugin-1", kind: "pi-reload", target: "all" },
      },
    }) });
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
      type: "plugin/event",
      rpcId: "transaction-1",
      payload: {
        type: "plugin/transaction-complete",
        sequence: 42,
        payload: { transactionId: "plugin-1", kind: "pi-reload", target: "all" },
      },
    })));
    await connection.close();
  });

  it("isolates replaced opens and deduplicates overlapping session frames", async () => {
    const sockets: FakeSocket[] = [];
    const events: HarnessTransportEvent[] = [];
    const persisted: Array<Record<string, number>> = [];
    const transport = createWebHarnessTransport({
      baseUrl: "http://localhost:4321",
      persistCursors: (cursor) => { persisted.push({ ...cursor }); },
      webSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.emit("open", {}));
        return socket;
      },
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result: { ok: true, value: { runtime: "pi" } } }));
      },
    });

    const first = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    const second = await transport.open(new AbortController().signal, (event) => events.push(event), () => undefined);
    const frame = (sequence: number, rpcId: string) => JSON.stringify({
      type: "server-request",
      rpcId,
      method: "session/event",
      payload: { type: "session/event", sessionId: "s1", sequence, event: { type: "turn/end", sequence } },
    });

    sockets[0]!.emit("message", { data: frame(99, "stale") });
    sockets[2]!.emit("message", { data: frame(1, "live") });
    sockets[2]!.emit("message", { data: frame(1, "overlap") });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events.filter((event) => event.type === "session/event")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ rpcId: "live" }));
    expect(events).not.toContainEqual(expect.objectContaining({ rpcId: "stale" }));
    await second.close();
    await first.close();
    expect(persisted.at(-1)).toEqual({ s1: 1 });
  });
});
