import { isReplayableRpcMethod, rpcError, type RpcResult, type RpcMessage, parseRpcMessage, RpcId } from "@openbuddy/plugin-host/rpc-contract";

export type HarnessTransportRequest = {
  rpcId: string;
  method: string;
  payload: unknown;
};

export type HarnessTransportEvent = {
  type: "session/event" | "session/subscribed" | "session/projection" | "session/cursor-gap" | "plugin/event" | "connection/resume";
  payload: unknown;
  rpcId?: string;
  respond?: (result: RpcResult<unknown>) => Promise<void>;
};

export type HarnessTransport = {
  call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal, requestId?: string) => Promise<RpcResult<unknown>>;
  respond: (message: RpcMessage, signal?: AbortSignal) => Promise<unknown>;
  open: (
    signal: AbortSignal,
    emit: (event: HarnessTransportEvent) => void,
    onDisconnect: () => void,
  ) => Promise<{ description: unknown; close: () => void | Promise<void> }>;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type WebSocketLike = {
  readonly readyState: number;
  readonly OPEN: number;
  readonly CONNECTING: number;
  addEventListener: (type: string, listener: (event: any) => void, options?: { once?: boolean }) => void;
  removeEventListener: (type: string, listener: (event: any) => void) => void;
  send: (data: string) => void;
  close: () => void;
};

type WebSocketFactory = (url: string) => WebSocketLike;

export type WebHarnessTransportOptions = {
  baseUrl?: string | URL | (() => string | URL | undefined | Promise<string | URL | undefined>);
  authToken?: string | (() => string | undefined | Promise<string | undefined>);
  /** Stable opaque client identity used as the resume-token audience. */
  clientIdentity?: string | (() => string | undefined | Promise<string | undefined>);
  fetch?: FetchLike;
  webSocket?: WebSocketFactory;
  eventTransport?: "websocket" | "sse";
  onRequest?: (request: HarnessTransportRequest) => RpcResult<unknown> | Promise<RpcResult<unknown>>;
  since?: () => number | Record<string, number> | undefined;
  /**
   * Loads persisted per-session cursor values from a durable store (for example
   * `app.getPath("userData")`). The transport merges the returned map into the
   * initial reconnect cursor on the next `open()` call so a renderer can resume
   * a multi-session mux subscription without re-replaying the full event log.
   */
  loadPersistedCursors?: () => Record<string, number> | undefined | Promise<Record<string, number> | undefined>;
  /**
   * Persists the latest per-session cursor map. The transport calls this after
   * each session-local sequence update, debounced to avoid synchronous disk I/O
   * on every event frame; the call is also flushed synchronously on `close()`
   * and on the abort signal so a renderer shutdown never loses its cursor.
   */
  persistCursors?: (cursor: Record<string, number>) => void | Promise<void>;
  /** Debounce window for `persistCursors`. Defaults to 500 ms. */
  persistDebounceMs?: number;
  loadResumeToken?: () => string | undefined | Promise<string | undefined>;
  persistResumeToken?: (token: string) => void | Promise<void>;
};

function baseUrl(value?: string | URL): URL {
  if (value !== undefined) return new URL(value.toString());
  const location = (globalThis as { location?: { origin?: string } }).location;
  return new URL(location?.origin && location.origin !== "null" ? location.origin : "http://127.0.0.1");
}

function endpointUrl(base: URL, channel: string, endpoint: string): URL {
  if (!/^\/[A-Za-z0-9._~-]+$/.test(channel)) throw new Error(`invalid Harness channel: ${channel}`);
  if (!endpoint || endpoint.split("/").some((part) => !/^[A-Za-z0-9_$.-]+$/.test(part))) {
    throw new Error(`invalid Harness endpoint: ${endpoint}`);
  }
  return new URL(`${channel}/${endpoint}`, base);
}

function socketUrl(base: URL, path: string): string {
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function cursorQuery(value: number | Record<string, number> | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const cursor = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([sessionId, sequence]) => typeof sessionId === "string" && sessionId.length > 0 && Number.isSafeInteger(sequence) && Number(sequence) >= -1)
    .map(([sessionId, sequence]) => [sessionId, Number(sequence)]));
  const entries = Object.entries(cursor);
  if (entries.length === 0) return undefined;
  return JSON.stringify(cursor);
}

function asRpcMessage(value: unknown): RpcMessage {
  return parseRpcMessage(value);
}

function transportError(error: unknown, message: string): RpcResult<never> {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") {
    return rpcError(Object.assign(new Error("The Harness request was cancelled"), { code: "cancelled" }), "cancelled");
  }
  return rpcError(error instanceof Error ? error : new Error(message), "internal");
}

function eventFromFrame(
  kind: "mux" | "host",
  frame: Record<string, unknown>,
  rpcId: string,
  respond: (result: RpcResult<unknown>) => Promise<void>,
  envelopeSequence?: number,
): HarnessTransportEvent | undefined {
  if (frame.type === "connection/resume" && typeof frame.token === "string") {
    return { type: "connection/resume", rpcId, payload: frame, respond };
  }
  if (kind === "mux" && frame.type === "session/event") {
    return {
      type: "session/event",
      rpcId,
      payload: {
        sessionId: frame.sessionId,
        ...(typeof frame.sequence === "number" ? { sequence: frame.sequence } : {}),
        ...(typeof frame.eventSequence === "number" ? { eventSequence: frame.eventSequence } : {}),
        payload: frame.event,
      },
      respond,
    };
  }
  if (kind === "mux" && frame.type === "session/subscribed") {
    return { type: "session/subscribed", rpcId, payload: frame, respond };
  }
  if (kind === "mux" && frame.type === "session/projection") {
    return { type: "session/projection", rpcId, payload: frame, respond };
  }
  if (kind === "mux" && frame.type === "session/cursor-gap") {
    return {
      type: "session/cursor-gap",
      rpcId,
      payload: {
        sessionId: frame.sessionId,
        requested: frame.requested,
        lastSeq: frame.lastSeq,
        ...(frame.reason === "retention" ? { reason: frame.reason } : {}),
        ...(typeof frame.earliestSeq === "number" ? { earliestSeq: frame.earliestSeq } : {}),
      },
      respond,
    };
  }
  const sequence = typeof frame.sequence === "number"
    ? frame.sequence
    : typeof envelopeSequence === "number" ? envelopeSequence : undefined;
  if (kind === "mux" && frame.type === "approval/requested") {
    return { type: "plugin/event", rpcId, payload: { type: "session/permission", ...(sequence === undefined ? {} : { sequence }), payload: { ...frame, requestId: frame.approvalId } }, respond };
  }
  if (kind === "mux" && frame.type === "approval/resolved") {
    return { type: "plugin/event", rpcId, payload: { type: "session/permission-resolved", ...(sequence === undefined ? {} : { sequence }), payload: { ...frame, requestId: frame.approvalId } }, respond };
  }
  if (kind === "mux" && frame.type === "question/requested") {
    return { type: "plugin/event", rpcId, payload: { type: "session/question", ...(sequence === undefined ? {} : { sequence }), payload: { ...frame, requestId: frame.questionRpcId } }, respond };
  }
  if (kind === "mux" && frame.type === "question/resolved") {
    return { type: "plugin/event", rpcId, payload: { type: "session/question-resolved", ...(sequence === undefined ? {} : { sequence }), payload: { ...frame, requestId: frame.questionRpcId } }, respond };
  }
  const hostTypes: Record<string, string> = {
    "host/session-added": "session/created",
    "host/session-removed": "session/removed",
    "host/session-status": "session/status",
    "host/agent-error": "agent/error",
    "host/workspace-changed": "workspace/changed",
    "host/workspace-removed": "workspace/removed",
    "host/workspace-order-changed": "workspace/order-changed",
    "host/plugin-event": "plugin/event",
    "host/remote-event": "plugin/event",
    "host/extensions-resolved": "plugin/event",
  };
  const type = typeof frame.type === "string" ? hostTypes[frame.type] : undefined;
  if (!type) return undefined;
  const payload = frame.type === "host/plugin-event"
    ? { type: frame.event, ...(sequence === undefined ? {} : { sequence }), payload: frame.payload }
    : frame.type === "host/remote-event"
    ? { type: frame.event, ...(sequence === undefined ? {} : { sequence }), payload: { args: frame.args } }
    : frame.type === "host/extensions-resolved"
    ? { type: "pi/extensions-resolved", ...(sequence === undefined ? {} : { sequence }), payload: { builtins: frame.builtins, paths: frame.paths, availableBuiltins: frame.availableBuiltins, commands: frame.commands } }
    : { type, ...(sequence === undefined ? {} : { sequence }), payload: { ...frame } };
  return { type: "plugin/event", rpcId, payload, respond };
}

export function createWebHarnessTransport(options: WebHarnessTransportOptions = {}): HarnessTransport {
  let lastSequence = 0;
  const lastSessionSequences = new Map<string, number>();
  let openGeneration = 0;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const persistDebounceMs = options.persistDebounceMs ?? 500;
  const flushPersist = async (): Promise<void> => {
    if (!options.persistCursors) return;
    const snapshot = Object.fromEntries(lastSessionSequences);
    await options.persistCursors(snapshot);
  };
  const schedulePersist = (): void => {
    if (!options.persistCursors) return;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void flushPersist();
    }, persistDebounceMs);
  };
  const resolveBase = async (): Promise<URL> => {
    const configured = typeof options.baseUrl === "function" ? await options.baseUrl() : options.baseUrl;
    if (configured === undefined) throw new Error("OpenBuddy Harness server is unavailable");
    return baseUrl(configured);
  };
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const socketFactory = options.webSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  const resolveToken = async (): Promise<string | undefined> => typeof options.authToken === "function" ? options.authToken() : options.authToken;
  const resolveClientIdentity = async (): Promise<string | undefined> => typeof options.clientIdentity === "function" ? options.clientIdentity() : options.clientIdentity;
  let resumeToken: string | undefined;
  const resolveResumeToken = async (): Promise<string | undefined> => resumeToken ?? await options.loadResumeToken?.();

  const call = async (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal, requestId?: string): Promise<RpcResult<unknown>> => {
    const rpcId = RpcId(requestId ?? `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    try {
      const base = await resolveBase();
      const token = await resolveToken();
      const clientIdentity = await resolveClientIdentity();
      const request = {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(clientIdentity ? { "x-openbuddy-client": clientIdentity } : {}) },
        body: JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }),
        ...(signal ? { signal } : {}),
      } satisfies RequestInit;
      let response: Response;
      try {
        response = await fetchImpl(endpointUrl(base, channel, endpoint), request);
      } catch (error) {
        if (!isReplayableRpcMethod(endpoint) || signal?.aborted) throw error;
        response = await fetchImpl(endpointUrl(base, channel, endpoint), request);
      }
      if (!response.ok) return transportError(new Error(`Harness HTTP request failed: ${response.status}`), "HTTP request failed");
      const message = asRpcMessage(await response.json());
      if (message.type !== "server-response") return transportError(new Error("Harness RPC response has an invalid type"), "invalid RPC response");
      if (message.rpcId !== rpcId) return transportError(new Error(`Harness rpcId mismatch: ${message.rpcId}`), "RPC correlation failed");
      return message.result;
    } catch (error) {
      return transportError(error, "Harness RPC request failed");
    }
  };

  const respond = async (message: RpcMessage, signal?: AbortSignal): Promise<unknown> => {
    const base = await resolveBase();
    const token = await resolveToken();
    const clientIdentity = await resolveClientIdentity();
    const response = await fetchImpl(new URL("/api/respond", base), {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(clientIdentity ? { "x-openbuddy-client": clientIdentity } : {}) },
      body: JSON.stringify(message),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Harness response failed: ${response.status}`);
    return response.json();
  };

  const consumeMessage = (
    kind: "mux" | "host",
    raw: unknown,
    emit: (event: HarnessTransportEvent) => void,
    isCurrent: () => boolean,
  ): void => {
    if (!isCurrent()) return;
    try {
      const envelopeSequence = raw && typeof raw === "object" && typeof (raw as { sequence?: unknown }).sequence === "number"
        ? (raw as { sequence: number }).sequence
        : undefined;
      const message = asRpcMessage(raw);
      if (message.type !== "server-request") throw new Error("unexpected Harness event message");
      const mappedEvent = message.payload && typeof message.payload === "object"
        ? eventFromFrame(
          kind,
          message.payload as Record<string, unknown>,
          message.rpcId,
          async (result) => { await respond({ type: "client-response", rpcId: RpcId(message.rpcId), result }); },
          envelopeSequence,
        )
        : undefined;
      const sequence = mappedEvent?.payload && typeof mappedEvent.payload === "object"
        ? (mappedEvent.payload as { sequence?: unknown }).sequence
        : undefined;
      if (!isCurrent()) return;
      if (mappedEvent) {
        const eventPayload = mappedEvent.payload && typeof mappedEvent.payload === "object"
          ? mappedEvent.payload as Record<string, unknown>
          : {};
        const sessionId = typeof eventPayload.sessionId === "string" ? eventPayload.sessionId : undefined;
        const sessionSequence = mappedEvent.type === "session/subscribed"
          ? eventPayload.lastSeq
          : mappedEvent.type === "session/projection"
            ? eventPayload.seq
            : eventPayload.sequence;
        if (mappedEvent.type === "session/event"
          && sessionId && typeof sessionSequence === "number" && Number.isSafeInteger(sessionSequence)) {
          if (sessionSequence <= (lastSessionSequences.get(sessionId) ?? -1)) return;
          lastSessionSequences.set(sessionId, sessionSequence);
          schedulePersist();
        } else if (mappedEvent.type === "plugin/event" && typeof sequence === "number" && Number.isSafeInteger(sequence)) {
          if (sequence <= lastSequence) return;
          lastSequence = sequence;
        }
        if (mappedEvent.type === "session/projection"
          && eventPayload.snapshot !== true
          && sessionId && typeof sessionSequence === "number" && Number.isSafeInteger(sessionSequence)) {
          lastSessionSequences.set(sessionId, Math.max(lastSessionSequences.get(sessionId) ?? -1, sessionSequence));
          schedulePersist();
        }
        if (mappedEvent.type === "session/cursor-gap") {
          const payload = mappedEvent.payload && typeof mappedEvent.payload === "object" ? mappedEvent.payload as { sessionId?: unknown; lastSeq?: unknown; reason?: unknown; earliestSeq?: unknown } : {};
          const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
          const lastSeq = payload.lastSeq;
          if (sessionId && typeof lastSeq === "number" && Number.isSafeInteger(lastSeq) && lastSeq >= -1) {
            const earliestSeq = payload.reason === "retention" && typeof payload.earliestSeq === "number"
              && Number.isSafeInteger(payload.earliestSeq) && payload.earliestSeq >= 0
              ? payload.earliestSeq
              : undefined;
            lastSessionSequences.set(sessionId, earliestSeq === undefined ? lastSeq : earliestSeq - 1);
            schedulePersist();
          }
        }
        if (mappedEvent.type === "connection/resume") {
          const payload = mappedEvent.payload && typeof mappedEvent.payload === "object" ? mappedEvent.payload as { token?: unknown; cursor?: unknown } : {};
          const cursor = payload.cursor && typeof payload.cursor === "object" && !Array.isArray(payload.cursor)
            ? payload.cursor as { sequence?: unknown; sessions?: unknown }
            : undefined;
          if (cursor?.sessions && typeof cursor.sessions === "object" && !Array.isArray(cursor.sessions)) {
            for (const [sessionId, sequence] of Object.entries(cursor.sessions)) {
              if (Number.isSafeInteger(sequence) && sequence >= -1) lastSessionSequences.set(sessionId, Number(sequence));
            }
            schedulePersist();
          }
          if (cursor && Number.isSafeInteger(cursor.sequence) && Number(cursor.sequence) >= 0) lastSequence = Number(cursor.sequence);
          if (typeof payload.token === "string" && payload.token.length > 0) {
            resumeToken = payload.token;
            void Promise.resolve(options.persistResumeToken?.(payload.token)).catch(() => undefined);
          }
        }
        emit(mappedEvent);
        return;
      }
      if (options.onRequest) {
        void Promise.resolve(options.onRequest({ rpcId: message.rpcId, method: message.method, payload: message.payload }))
          .then(async (result) => { await respond({ type: "client-response", rpcId: RpcId(message.rpcId), result }); })
          .catch(async (error) => { await respond({ type: "client-response", rpcId: RpcId(message.rpcId), result: rpcError(error) }); });
      }
    } catch {
      // Malformed carrier frames are isolated from the connection loop.
    }
  };

  const openSocket = async (
    path: string,
    kind: "mux" | "host",
    signal: AbortSignal,
    emit: (event: HarnessTransportEvent) => void,
    onDisconnect: () => void,
    since?: number | Record<string, number>,
    isCurrent: () => boolean = () => true,
  ): Promise<() => void> => {
    const base = await resolveBase();
    const url = socketUrl(base, path);
    const token = await resolveToken();
    const clientIdentity = await resolveClientIdentity();
    const resume = await resolveResumeToken();
    const cursor = cursorQuery(since);
    const query = [resume ? `resume=${encodeURIComponent(resume)}` : cursor ? `since=${encodeURIComponent(cursor)}` : "", token ? `token=${encodeURIComponent(token)}` : "", clientIdentity ? `client=${encodeURIComponent(clientIdentity)}` : ""].filter(Boolean).join("&");
    const socket = socketFactory(query ? `${url}?${query}` : url);
    let opened = false;
    let closed = false;
    let disconnected = false;
    let resolveOpen!: () => void;
    let rejectOpen!: (error: unknown) => void;
    const openedPromise = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      signal.removeEventListener("abort", handleAbort);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      cleanup();
      if (socket.readyState === socket.CONNECTING || socket.readyState === socket.OPEN) socket.close();
    };
    const handleOpen = () => {
      opened = true;
      resolveOpen();
    };
    const handleMessage = (event: { data?: unknown }) => {
      if (closed || !isCurrent()) return;
      if (typeof event.data !== "string") return;
      try {
        consumeMessage(kind, JSON.parse(event.data), emit, () => !closed && isCurrent());
      } catch {
        // Ignore malformed JSON frames at the carrier boundary.
      }
    };
    const handleError = (event: unknown) => {
      if (!opened) rejectOpen(event instanceof Error ? event : new Error("Harness WebSocket failed to open"));
      else if (!disconnected) {
        disconnected = true;
        if (isCurrent()) onDisconnect();
      }
    };
    const handleClose = () => {
      if (!opened) rejectOpen(new Error("Harness WebSocket closed before opening"));
      else if (!disconnected) {
        disconnected = true;
        if (isCurrent()) onDisconnect();
      }
    };
    const handleAbort = () => {
      if (!opened) rejectOpen(new Error("Harness WebSocket open was aborted"));
      close();
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    try {
      await openedPromise;
      return close;
    } catch (error) {
      close();
      throw error;
    }
  };

  const openSse = async (
    path: string,
    kind: "mux" | "host",
    signal: AbortSignal,
    emit: (event: HarnessTransportEvent) => void,
    onDisconnect: () => void,
    since?: number | Record<string, number>,
    isCurrent: () => boolean = () => true,
  ): Promise<() => void> => {
    const base = await resolveBase();
    const url = new URL(path, base);
    const cursor = cursorQuery(since);
    if (cursor) url.searchParams.set("since", cursor);
    const resume = await resolveResumeToken();
    if (resume) { url.searchParams.delete("since"); url.searchParams.set("resume", resume); }
    const token = await resolveToken();
    const clientIdentity = await resolveClientIdentity();
    if (clientIdentity) url.searchParams.set("client", clientIdentity);
    const headers = { accept: "text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(clientIdentity ? { "x-openbuddy-client": clientIdentity } : {}) };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok || !response.body) {
      signal.removeEventListener("abort", abort);
      throw new Error(`Harness SSE failed: ${response.status}`);
    }
    let closed = false;
    let buffer = "";
    const reader = response.body.getReader();
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", abort);
      controller.abort();
      void reader.cancel();
    };
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += new TextDecoder().decode(chunk.value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const data = event.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (data) consumeMessage(kind, JSON.parse(data), emit, () => !closed && isCurrent());
          }
        }
      } catch {
        if (!controller.signal.aborted && isCurrent()) onDisconnect();
      } finally {
        if (!closed && !controller.signal.aborted && isCurrent()) onDisconnect();
      }
    })();
    return close;
  };

  return {
    call,
    respond,
    open: async (signal, emit, onDisconnect) => {
      const generation = ++openGeneration;
      let closed = false;
      const isCurrent = () => !closed && generation === openGeneration;
      const scopedDisconnect = () => { if (isCurrent()) onDisconnect(); };
      const opened: Array<() => void> = [];
      const localAbort = new AbortController();
      const abortLocal = () => localAbort.abort();
      signal.addEventListener("abort", abortLocal, { once: true });
      const configuredCursor = options.since?.();
      if (lastSessionSequences.size === 0 && options.loadPersistedCursors) {
        const persisted = await options.loadPersistedCursors();
        if (persisted && typeof persisted === "object") {
          for (const [sessionId, sequence] of Object.entries(persisted)) {
            if (Number.isSafeInteger(sequence) && sequence >= -1) {
              lastSessionSequences.set(sessionId, Math.max(lastSessionSequences.get(sessionId) ?? -1, sequence));
            }
          }
        }
      }
      const since = configuredCursor
        ?? (lastSessionSequences.size > 0 ? Object.fromEntries(lastSessionSequences) : (lastSequence > 0 ? lastSequence : undefined));
      try {
        const open = options.eventTransport === "sse" ? openSse : openSocket;
        await Promise.all([
          open("/api/events.mux", "mux", localAbort.signal, emit, scopedDisconnect, since, isCurrent).then((close) => { opened.push(close); return close; }),
          open("/api/events.host", "host", localAbort.signal, emit, scopedDisconnect, since, isCurrent).then((close) => { opened.push(close); return close; }),
        ]);
        const descriptionResult = await call("/api", "host.describe", {}, localAbort.signal);
        if (!descriptionResult.ok) throw new Error(descriptionResult.error.message);
        return {
          description: descriptionResult.value,
          close: () => {
            closed = true;
            signal.removeEventListener("abort", abortLocal);
            if (persistTimer) {
              clearTimeout(persistTimer);
              persistTimer = undefined;
            }
            if (options.persistCursors && lastSessionSequences.size > 0) {
              void options.persistCursors(Object.fromEntries(lastSessionSequences));
            }
            localAbort.abort();
            opened.forEach((close) => close());
          },
        };
      } catch (error) {
        localAbort.abort();
        opened.forEach((close) => close());
        throw error;
      }
    },
  };
}
