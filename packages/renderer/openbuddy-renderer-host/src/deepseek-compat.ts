import { Context, type Context as ContextType } from "@openbuddy/cordis";
import { OpenBuddyService } from "@openbuddy/cordis";
import { parseRemoteCodec, serializeRemoteContribution, validateRemoteCodec, type RemoteCodec } from "@openbuddy/plugin-host/remote-codec";
import { asRpcResult, createRpcId, isReplayableRpcMethod, rpcError as contractRpcError, rpcValue as contractRpcValue, type RpcResult as ContractRpcResult } from "@openbuddy/plugin-host/rpc-contract";
import { ClientModuleSystem } from "./client-modules";
import { ConnectionController, type ConnectionState } from "./connection-controller";
import type { HarnessTransport } from "./harness-transport";
import { OpenBuddyConversationAssembler, type ConversationDefinition, type ConversationTargetSnapshot, type ConversationViewDefinition } from "./conversation-assembler";

type ReactRuntime = {
  createElement?: (...args: any[]) => unknown;
};

type RendererAgentBridge = {
  transport?: HarnessTransport;
  invoke?: (channel: string, args?: unknown) => Promise<unknown>;
  onEvent?: (handler: (event: { type?: string; payload?: unknown; sessionId?: string; rpcId?: string; respond?: (result: RpcResult) => Promise<void> }) => void) => Promise<() => void>;
  onPluginEvent?: (handler: (event: { type?: string; payload?: unknown; sessionId?: string; rpcId?: string; respond?: (result: RpcResult) => Promise<void> }) => void) => Promise<() => void>;
  onRpcMessage?: (handler: (message: unknown) => void) => Promise<() => void>;
};

type RpcResult = ContractRpcResult<unknown>;

type StreamRequest = {
  rpcId?: string;
  payload?: {
    since?: Record<string, number>;
  };
};

type MuxFrame =
  | { type: "session/event"; sessionId: string; event: unknown; sequence?: number }
  | { type: "session/projection"; sessionId: string; key: string; value: unknown; seq: number }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number }
  | { type: "approval/requested"; sessionId: string; approvalId: string; toolName: string; reason?: string }
  | { type: "approval/resolved"; sessionId: string; approvalId: string; outcome: "approved" | "denied" | "cancelled" }
  | { type: "question/requested"; sessionId: string; questions: unknown[] }
  | { type: "question/resolved"; sessionId: string; questionRpcId: string; outcome: "answered" | "cancelled" }
  | { type: "session/jobs"; sessionId: string; jobs: unknown[] }
  | { type: "session/queue"; sessionId: string; items: unknown[] };

type HostFrame =
  | { type: "host/session-added"; sessionId: string; blank: boolean; cwd?: string }
  | { type: "host/session-removed"; sessionId: string }
  | { type: "host/session-status"; sessionId: string; running: boolean }
  | { type: "host/agent-error"; sessionId: string; message: string }
  | { type: "host/workspace-changed"; workspace: unknown }
  | { type: "host/workspace-removed"; workspaceId: string }
  | { type: "host/workspace-order-changed"; workspaceIds: string[] }
  | { type: "host/remote-event"; event: string; args: unknown[] };

type ConnectionEventFrame<T = MuxFrame | HostFrame> = {
  rpcId: string;
  payload: T;
  respond?: (result: RpcResult) => Promise<void>;
};

type EventQueueResult<T> = IteratorResult<T>;

type StreamSubscription<T> = {
  queue: AsyncEventQueue<ConnectionEventFrame<T>>;
  since: Record<string, number>;
  ready: boolean;
  pending: Array<ConnectionEventFrame<T>>;
};

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: EventQueueResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ done: true, value: undefined as never });
  }

  async next(signal?: AbortSignal): Promise<EventQueueResult<T>> {
    if (this.values.length > 0) return { done: false, value: this.values.shift()! };
    if (this.closed || signal?.aborted) return { done: true, value: undefined as never };
    return new Promise<EventQueueResult<T>>((resolve) => {
      const waiter = (result: EventQueueResult<T>) => {
        signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve({ done: true, value: undefined as never });
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

const forwardedRemoteEvents = new Set([
  "agent-preset/selected",
  "commands/change",
  "credentials/reference-updated",
  "cordis/request-run",
  "cordis/request-run-resolved",
  "cordis/dynamic-package",
  "cordis/dynamic-retract",
  "cordis/inspect-query",
  "cordis/inspect-query-resolved",
  "llm/adapters-updated",
  "settings/document-updated",
]);

function bridgeOf(ctx: Context): RendererAgentBridge {
  return (ctx.get("agentApi") as RendererAgentBridge | undefined) ?? {};
}

function rpcValue(value: unknown): RpcResult {
	return contractRpcValue(value);
}

function rpcError(error: unknown): RpcResult {
	return contractRpcError(error);
}

function response(value: unknown): { rpcId: string; result: RpcResult } {
	return { rpcId: createRpcId(), result: rpcValue(value) };
}

function typedRequest(method: string, payload: unknown, requestId?: string): { type: "client-request"; rpcId: string; method: string; payload: unknown } {
  return { type: "client-request", rpcId: requestId ?? createRpcId("renderer-rpc"), method, payload };
}

type CatalogProvider = { id?: string; name?: string };
type CatalogModel = { providerId?: string; modelId?: string; name?: string };

function catalogOf(value: unknown): { providers: CatalogProvider[]; models: CatalogModel[] } {
  if (!value || typeof value !== "object") return { providers: [], models: [] };
  const record = value as { providers?: unknown; models?: unknown; groups?: unknown };
  const groups = Array.isArray(record.groups) ? record.groups : [];
  const groupProviders = groups.filter((entry): entry is { provider?: unknown; name?: unknown; models?: unknown } => Boolean(entry) && typeof entry === "object");
  const providers = Array.isArray(record.providers)
    ? record.providers.filter((entry): entry is CatalogProvider => Boolean(entry) && typeof entry === "object")
    : groupProviders.map((group) => ({ id: typeof group.provider === "string" ? group.provider : undefined, name: typeof group.name === "string" ? group.name : undefined }));
  const models = Array.isArray(record.models)
    ? record.models.filter((entry): entry is CatalogModel => Boolean(entry) && typeof entry === "object")
    : groupProviders.flatMap((group) => Array.isArray(group.models)
      ? group.models.filter((entry): entry is { id?: unknown; name?: unknown } => Boolean(entry) && typeof entry === "object").map((model) => ({
        providerId: typeof group.provider === "string" ? group.provider : undefined,
        modelId: typeof model.id === "string" ? model.id : undefined,
        name: typeof model.name === "string" ? model.name : undefined,
      }))
      : []);
  return {
    providers,
    models,
  };
}

async function invokeBridge(ctx: Context, channel: string, args?: unknown): Promise<{ rpcId: string; result: RpcResult }> {
  const invoke = bridgeOf(ctx).invoke;
  if (!invoke) return response(undefined);
  try {
    return response(await invoke(channel, args));
  } catch (error) {
		return { rpcId: createRpcId(), result: rpcError(error) };
  }
}

async function invokeBridgeValue(ctx: Context, channel: string, args?: unknown): Promise<unknown> {
  const response = await invokeBridge(ctx, channel, args);
  if (!response.result.ok) throw new Error(response.result.error.message ?? `OpenBuddy bridge call failed: ${channel}`);
  return response.result.value;
}

function sessionIdOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  return typeof value.sessionId === "string" ? value.sessionId : undefined;
}

class DeepSeekConnectionService extends OpenBuddyService {
  static override provide = "connection";
  readonly api: Record<string, unknown>;
  readonly rpc: { call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult> };
  readonly isLoopback = true;
  readonly hostDescription = { getSnapshot: () => ({ product: "OpenBuddy", runtime: "pi" }), subscribe: () => () => undefined };
  private started = false;
  private generation = 0;
  private state: "connected" | "reconnecting" | undefined;
  private activeLoop: { generation: number; stop: () => void } | undefined;
  private readonly bridge: RendererAgentBridge;
  private readonly transport?: HarnessTransport;
  private controller: ConnectionController<{ type?: string; payload?: unknown; sessionId?: string; rpcId?: string; respond?: (result: RpcResult) => Promise<void> }> | undefined;
  private readonly pendingCalls = new Map<symbol, {
    generation: number;
    replayable: boolean;
    requestId: string;
    operation: (requestId: string) => Promise<RpcResult>;
    finish: (result: RpcResult) => void;
  }>();
  private readonly muxStreams = new Set<StreamSubscription<MuxFrame>>();
  private readonly hostStreams = new Set<StreamSubscription<HostFrame>>();
  private lastSequence = 0;
  private readonly lastSessionSequences = new Map<string, number>();

  private pushStream<T>(subscription: StreamSubscription<T>, frame: ConnectionEventFrame<T>): void {
    if (subscription.ready) subscription.queue.push(frame);
    else subscription.pending.push(frame);
  }

  private publishSessionBaseline(event: { payload?: unknown; rpcId?: string }): void {
    if (!event.payload || typeof event.payload !== "object") return;
    const frame = event.payload as Partial<Extract<MuxFrame, { type: "session/subscribed" }>>;
    if (frame.type !== "session/subscribed" || typeof frame.sessionId !== "string" || typeof frame.lastSeq !== "number") return;
    const envelope: ConnectionEventFrame<MuxFrame> = {
      rpcId: event.rpcId ?? `subscribed-${frame.sessionId}`,
      payload: { type: "session/subscribed", sessionId: frame.sessionId, lastSeq: frame.lastSeq },
    };
    for (const stream of [...this.muxStreams]) this.pushStream(stream, envelope);
  }

  private publishStreamEvent(event: { type: "session/event" | "plugin/event"; payload: unknown; rpcId?: string; respond?: (result: RpcResult) => Promise<void> }, generation: number): void {
    const payload = event.payload;
    const record = payload && typeof payload === "object" && "payload" in payload
      ? payload as { type?: unknown; payload: unknown; sequence?: unknown; sessionSequence?: unknown; sessionId?: unknown }
      : undefined;
    const value = record?.payload ?? payload;
    const sequence = typeof record?.sessionSequence === "number"
      ? record.sessionSequence
      : typeof record?.sequence === "number"
        ? record.sequence
      : value && typeof value === "object" && typeof (value as { sequence?: unknown }).sequence === "number"
        ? (value as { sequence: number }).sequence : undefined;
    const sessionId = typeof record?.sessionId === "string" ? record.sessionId : sessionIdOf(value);
    const rpcId = event.rpcId ?? `event-${generation}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (event.type === "plugin/event" && record?.type === "session/projection" && sessionId && value && typeof value === "object") {
      const projection = value as { key?: unknown; value?: unknown };
      if (typeof projection.key === "string" && typeof sequence === "number") {
        const frame: ConnectionEventFrame<MuxFrame> = { rpcId, payload: { type: "session/projection", sessionId, key: projection.key, value: projection.value, seq: sequence }, respond: event.respond };
        for (const stream of [...this.muxStreams]) this.pushStream(stream, frame);
      }
      return;
    }
    if (event.type === "session/event") {
      if (!sessionId) return;
      const frame: ConnectionEventFrame<MuxFrame> = { rpcId, payload: { type: "session/event", sessionId, event: value, ...(sequence === undefined ? {} : { sequence }) }, respond: event.respond };
      for (const stream of [...this.muxStreams]) {
        if (sequence !== undefined && sequence <= (stream.since[sessionId] ?? -1)) continue;
        this.pushStream(stream, frame);
      }
      return;
    }
    const type = typeof record?.type === "string" ? record.type : "plugin/event";
    const interaction = this.interactionFrame(type, value);
    if (interaction) {
      const interactionFrame: ConnectionEventFrame<MuxFrame> = { rpcId: this.rpcIdForEvent(record?.payload ?? payload, rpcId), payload: interaction, respond: event.respond };
      for (const stream of [...this.muxStreams]) this.pushStream(stream, interactionFrame);
      return;
    }
    const session = typeof sessionId === "string" ? sessionId : "";
    if (!this.isSessionEventType(type) && !session) {
      const frame: ConnectionEventFrame<HostFrame> = { rpcId: this.rpcIdForEvent(payload, rpcId), payload: this.pluginFrame(type, value, session), respond: event.respond };
      for (const stream of [...this.hostStreams]) this.pushStream(stream, frame);
      return;
    }
    const typed = this.pluginFrame(type, value, session);
    const frame: ConnectionEventFrame<HostFrame> = { rpcId: this.rpcIdForEvent(payload, rpcId), payload: typed, respond: event.respond };
    for (const stream of [...this.hostStreams]) this.pushStream(stream, frame);
  }

  private rpcIdForEvent(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== "object") return fallback;
    const requestId = (payload as { requestId?: unknown }).requestId;
    return typeof requestId === "string" && requestId ? requestId : fallback;
  }

  private pluginFrame(type: string, value: unknown, sessionId: string): HostFrame {
    const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (type === "session/created" && sessionId) {
      return { type: "host/session-added", sessionId, blank: false, ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}) };
    }
    if ((type === "session/removed" || type === "session/deleted") && sessionId) {
      return { type: "host/session-removed", sessionId };
    }
    if (type === "session/status" && sessionId && typeof payload.running === "boolean") {
      return { type: "host/session-status", sessionId, running: payload.running };
    }
    if (type === "agent/error" && sessionId) {
      return { type: "host/agent-error", sessionId, message: typeof payload.error === "string" ? payload.error : JSON.stringify(value) };
    }
    if (type === "workspace/changed" && payload.workspace !== undefined) return { type: "host/workspace-changed", workspace: payload.workspace };
    if (type === "workspace/removed" && typeof payload.workspaceId === "string") return { type: "host/workspace-removed", workspaceId: payload.workspaceId };
    if (type === "workspace/order-changed" && Array.isArray(payload.workspaceIds)) return { type: "host/workspace-order-changed", workspaceIds: payload.workspaceIds.filter((id): id is string => typeof id === "string") };
    const args = payload && Array.isArray(payload.args) ? payload.args : [value];
    return { type: "host/remote-event", event: type, args };
  }

  private interactionFrame(type: string, value: unknown): MuxFrame | undefined {
    if (!value || typeof value !== "object") return undefined;
    const payload = value as Record<string, unknown>;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined;
    if (!sessionId || !requestId) return undefined;
    if (type === "session/permission") return {
      type: "approval/requested",
      sessionId,
      approvalId: requestId,
      toolName: typeof payload.title === "string" ? payload.title : "permission",
      ...(typeof payload.message === "string" ? { reason: payload.message } : {}),
    };
    if (type === "session/question") return {
      type: "question/requested",
      sessionId,
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    };
    if (type === "session/permission-resolved") return {
      type: "approval/resolved",
      sessionId,
      approvalId: requestId,
      outcome: payload.cancelled === true ? "cancelled" : payload.allowed === false ? "denied" : "approved",
    };
    if (type === "session/question-resolved") return {
      type: "question/resolved",
      sessionId,
      questionRpcId: requestId,
      outcome: payload.cancelled === true ? "cancelled" : "answered",
    };
    return undefined;
  }

  private isSessionEventType(type: string): boolean {
    return /^(?:agent|session|turn|assistant|tool|model)\//u.test(type);
  }

  private async streamBaseline(subscription: StreamSubscription<MuxFrame | HostFrame>, kind: "mux" | "host", signal: AbortSignal): Promise<void> {
    if (!this.bridge.invoke) {
      subscription.ready = true;
      return;
    }
    try {
      const raw = await this.bridge.invoke(kind === "mux" ? "agent:event-log" : "agent:plugin-events");
      if (signal.aborted) return;
      const records = Array.isArray(raw) ? raw.filter((entry): entry is { sequence: number; sessionSequence?: number; sessionId?: string; type?: string; payload?: unknown } => Boolean(entry) && typeof entry === "object" && Number.isSafeInteger((entry as { sequence?: unknown }).sequence)) : [];
      if (kind === "host") {
        for (const record of records) {
          const type = record.type ?? "plugin/event";
          if (this.isSessionEventType(type) || this.interactionFrame(type, record.payload ?? record)) continue;
          this.pushStream(subscription as StreamSubscription<HostFrame>, {
            rpcId: `replay-${record.sequence}`,
            payload: this.pluginFrame(type, record.payload ?? record, record.sessionId ?? ""),
          });
        }
        return;
      }
      const sessions = new Map<string, number>();
      for (const record of records) {
        if (record.sessionId) sessions.set(record.sessionId, Math.max(sessions.get(record.sessionId) ?? -1, record.sessionSequence ?? record.sequence));
      }
      for (const [sessionId, requested] of Object.entries(subscription.since)) {
        sessions.set(sessionId, Math.max(sessions.get(sessionId) ?? -1, requested));
      }
      for (const [sessionId, lastSeq] of sessions) {
        this.pushStream(subscription as StreamSubscription<MuxFrame>, { rpcId: `subscribed-${sessionId}`, payload: { type: "session/subscribed", sessionId, lastSeq } });
      }
      for (const record of records) {
        if (!record.sessionId || (record.sessionSequence ?? record.sequence) <= (subscription.since[record.sessionId] ?? -1)) continue;
        const rpcId = `replay-${record.sequence}`;
        const interaction = this.interactionFrame(record.type ?? "", record.payload ?? record);
        if (interaction) {
          this.pushStream(subscription as StreamSubscription<MuxFrame>, { rpcId, payload: interaction });
        } else if (this.isSessionEventType(record.type ?? "")) {
          this.pushStream(subscription as StreamSubscription<MuxFrame>, {
            rpcId,
          payload: { type: "session/event", sessionId: record.sessionId, event: record.payload ?? record, sequence: record.sessionSequence ?? record.sequence },
          });
        }
      }
    } finally {
      subscription.ready = true;
      for (const frame of subscription.pending.splice(0)) subscription.queue.push(frame as ConnectionEventFrame<MuxFrame | HostFrame>);
    }
  }

  private async *eventStream(kind: "mux" | "host", request?: unknown, signal?: AbortSignal): AsyncIterable<ConnectionEventFrame<MuxFrame | HostFrame>> {
    const queue = new AsyncEventQueue<ConnectionEventFrame<MuxFrame | HostFrame>>();
    const streams = kind === "mux" ? this.muxStreams : this.hostStreams;
    const payload = request && typeof request === "object" && "payload" in request ? (request as StreamRequest).payload : undefined;
    const subscription = { queue, since: payload?.since ?? {}, ready: false, pending: [] } as StreamSubscription<MuxFrame | HostFrame>;
    streams.add(subscription as never);
    if (!this.activeLoop) this.startLoop({});
    try {
      if (!subscription.ready) await this.streamBaseline(subscription, kind, signal ?? new AbortController().signal);
      while (!signal?.aborted) {
        const result = await queue.next(signal);
        if (result.done) return;
        yield result.value;
      }
    } finally {
      streams.delete(subscription as never);
      queue.close();
    }
  }

  private closeEventStreams(): void {
    for (const stream of [...this.muxStreams, ...this.hostStreams]) stream.queue.close();
    this.muxStreams.clear();
    this.hostStreams.clear();
  }

  private connectionLost(generation: number): RpcResult {
    return contractRpcError(Object.assign(new Error(`connection generation ${generation} is no longer active`), { code: "connection-lost" }), "connection-lost", { generation });
  }

  private acceptEvent(event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    const sessionId = typeof (event as { sessionId?: unknown }).sessionId === "string" ? (event as { sessionId: string }).sessionId : sessionIdOf(event);
    const sessionSequence = (event as { sessionSequence?: unknown }).sessionSequence;
    if (sessionId && typeof sessionSequence === "number" && Number.isSafeInteger(sessionSequence)) {
      if (sessionSequence <= (this.lastSessionSequences.get(sessionId) ?? -1)) return false;
      this.lastSessionSequences.set(sessionId, sessionSequence);
      return true;
    }
    const sequence = (event as { sequence?: unknown }).sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence)) return true;
    if (sequence <= this.lastSequence) return false;
    this.lastSequence = sequence;
    return true;
  }

  private async replayEvents(
    signal: AbortSignal,
    emit: (event: { type: "session/event" | "plugin/event"; payload: unknown }) => void,
  ): Promise<void> {
    if (this.lastSequence <= 0 || !this.bridge.invoke) return;
    const baseline = this.lastSequence;
    const raw = await this.bridge.invoke("agent:event-log", { sinceSequence: baseline, limit: 2000 });
    if (signal.aborted) throw new Error("connection generation aborted");
    const records = Array.isArray(raw)
      ? raw.filter((entry): entry is { sequence: number; type?: string; payload: unknown } => Boolean(entry) && typeof entry === "object" && Number.isSafeInteger((entry as { sequence?: unknown }).sequence))
        .sort((left, right) => left.sequence - right.sequence)
      : [];
    if (records.length > 0 && records[0].sequence > baseline + 1) {
      emit({
        type: "plugin/event",
        payload: {
          eventVersion: 1,
          type: "connection/replay-gap",
          timestamp: new Date().toISOString(),
          payload: { sinceSequence: baseline, firstAvailableSequence: records[0].sequence },
        },
      });
    }
    for (const record of records) {
      const type = record.type ?? "";
      const sessionEvent = /^(?:agent|session|turn|assistant|tool|model)\//u.test(type);
      emit({ type: sessionEvent ? "session/event" : "plugin/event", payload: record });
    }
  }

  private rejectPendingCalls(generation: number, preserveReplayable = true): void {
    for (const [token, pending] of this.pendingCalls) {
      if (preserveReplayable && pending.replayable) continue;
      this.pendingCalls.delete(token);
      pending.finish(this.connectionLost(generation));
    }
  }

  private invokePendingCall(token: symbol, pending: {
    generation: number;
    replayable: boolean;
    requestId: string;
    operation: (requestId: string) => Promise<RpcResult>;
    finish: (result: RpcResult) => void;
  }): void {
    const invocationGeneration = pending.generation;
    void pending.operation(pending.requestId).then((result) => {
      if (this.pendingCalls.get(token) !== pending) return;
      if (this.state === "reconnecting" || this.generation !== invocationGeneration || pending.generation !== invocationGeneration) {
        if (!pending.replayable) pending.finish(this.connectionLost(invocationGeneration));
        return;
      }
      pending.finish(result);
    }, (error) => {
      if (this.pendingCalls.get(token) !== pending) return;
      if (this.state === "reconnecting" || this.generation !== invocationGeneration || pending.generation !== invocationGeneration) {
        if (!pending.replayable) pending.finish(this.connectionLost(invocationGeneration));
        return;
      }
      pending.finish(rpcError(error));
    });
  }

  private trackGenerationCall(operation: (requestId: string) => Promise<RpcResult>, endpoint: string, signal?: AbortSignal): Promise<RpcResult> {
    const snapshot = this.controller?.getSnapshot();
    const generation = snapshot?.generation ?? this.generation;
    const replayable = isReplayableRpcMethod(endpoint);
    if (signal?.aborted) return Promise.resolve(contractRpcError(Object.assign(new Error("The operation was aborted"), { code: "cancelled" }), "cancelled"));
    if (this.started && this.state === "reconnecting" && !replayable) return Promise.resolve(this.connectionLost(generation));
    const token = Symbol("rpc");
    return new Promise((resolve) => {
      let settled = false;
      const abort = () => finish(contractRpcError(Object.assign(new Error("The operation was aborted"), { code: "cancelled" }), "cancelled"));
      const finish = (result: RpcResult) => {
        if (settled) return;
        settled = true;
        this.pendingCalls.delete(token);
        signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const pending = { generation, replayable, requestId: createRpcId("renderer-request"), operation, finish };
      this.pendingCalls.set(token, pending);
      signal?.addEventListener("abort", abort, { once: true });
      if (!(this.started && this.state === "reconnecting")) this.invokePendingCall(token, pending);
    });
  }

  getSnapshot(): { generation: number; state?: string; started: boolean } {
    return this.controller?.getSnapshot() ?? { generation: this.generation, state: this.state, started: this.started };
  }

  constructor(ctx: Context) {
    super(ctx, "connection");
    this.bridge = bridgeOf(ctx);
    this.transport = this.bridge.transport;
    const rawCall = async (_channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal, requestId?: string): Promise<RpcResult> => {
			if (signal?.aborted) return rpcError(Object.assign(new Error("The operation was aborted"), { code: "cancelled" }));
      if (this.transport) return this.transport.call(_channel, endpoint, payload, signal, requestId);
      const slash = endpoint.indexOf("/");
      const [domain, method] = slash >= 0 ? [endpoint.slice(0, slash), endpoint.slice(slash + 1)] : endpoint.split(".");
      const args = payload && typeof payload === "object" && "args" in payload ? (payload as { args: unknown }).args : payload;
      const typedEndpoint = new Set(["host.pickDirectory", "host.listDirectory", "host.createDirectory", "host.openPath", "session.list", "session.create", "session.search", "session.fork", "session.rename", "session.history", "session.attachment", "session.updateQueue", "session.prompt", "session.cancel", "session.selectModel", "session.surface", "session.traceEvent", "session.readEvent", "subagent.list", "subagent.history", "subagent.prompt", "subagent.interrupt", "llm.providers", "llm.models", "workspace.list", "workspace.create", "workspace.rename", "workspace.delete", "workspace.insertBefore", "workspace.insertSessionBefore", "workspace.archiveSession"]).has(`${domain}.${method}`);
      if (typedEndpoint) {
        const typedPayload = args && typeof args === "object" ? args : {};
        const typed = await invokeBridge(ctx, "dsh:rpc", typedRequest(`${domain}.${method}`, typedPayload, requestId));
        if (typed.result.ok) {
          const envelope = typed.result.value;
          if (envelope && typeof envelope === "object" && "result" in envelope) {
            const result = asRpcResult((envelope as { result: unknown }).result);
            if (!result.ok) return result;
            const value = result.value;
            if (endpoint === "session.list") return rpcValue((value as { items?: unknown[] })?.items ?? []);
            return rpcValue(value);
          }
        }
      }
      const ipc = domain === "session" && method === "prompt" ? "agent:prompt"
        : domain === "session" && method === "cancel" ? "agent:abort"
        : domain === "session" && method === "selectModel" ? "agent:set-model"
        : domain === "session" && method === "list" ? "sessions:list"
        : domain === "session" && method === "create" ? "agent:new-session"
        : domain === "session" && method === "history" ? "agent:event-log"
        : domain === "session" && method === "models" ? "agent:providers-list"
        : domain === "llm" && method === "models" ? "agent:providers-list"
        : domain === "llm" && method === "providers" ? "agent:providers-list"
        : "dsh:remote";
      const remotePayload = ipc === "dsh:remote"
        ? {
            ...(payload && typeof payload === "object" ? payload as Record<string, unknown> : {}),
            namespace: domain,
            method,
            ...(payload && typeof payload === "object" && "package" in payload ? {} : {}),
            args,
          }
        : undefined;
      const bridged = await invokeBridge(ctx, ipc,
        ipc === "dsh:remote"
          ? remotePayload
          : domain === "session" && method === "list"
            ? (args as { cwd?: string } | undefined)?.cwd ?? "."
            : args);
      if (!bridged.result.ok) return bridged.result;
      let value = bridged.result.value;
		if (value && typeof value === "object" && !Array.isArray(value) && "ok" in value) {
			const envelope = asRpcResult(value);
			if (!envelope.ok) return envelope;
			value = envelope.value;
		}
      if (endpoint === "session.list") {
        const rows = Array.isArray(value) ? value : [];
        return rpcValue({ items: rows.map((row) => ({
          sessionId: row.sessionId,
          updatedAt: Date.parse(row.updatedAt ?? "") || Date.now(),
          running: false,
          blank: false,
          cwd: row.cwd,
        })) });
      }
      if (endpoint === "session.history") return rpcValue({ entries: Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries) ? (value as { entries: unknown[] }).entries : [] });
      if (endpoint === "session.models") {
        const catalog = catalogOf(value);
        return rpcValue({ groups: catalog.providers.map((provider) => ({
          provider: provider.id,
          name: provider.name ?? provider.id,
          models: catalog.models.filter((model) => model.providerId === provider.id).map((model) => ({ id: model.modelId, name: model.name ?? model.modelId })),
        })), failures: [] });
      }
      if (endpoint === "llm.providers") {
        const catalog = catalogOf(value);
        return rpcValue({ providers: catalog.providers.map((provider) => ({
          provider: provider.id,
          displayName: provider.name ?? provider.id,
          settingsNs: "llm-pi-ai",
          settingsPath: [],
          active: true,
        })) });
      }
      if (endpoint === "llm.models") {
        const catalog = catalogOf(value);
        return rpcValue({ groups: catalog.providers.map((provider) => ({
          provider: provider.id,
          name: provider.name ?? provider.id,
          models: catalog.models.filter((model) => model.providerId === provider.id).map((model) => ({ id: model.modelId, name: model.name ?? model.modelId })),
        })), failures: [] });
      }
      return rpcValue(value);
    };
    const call = (_channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<RpcResult> =>
      this.trackGenerationCall((requestId) => rawCall(_channel, endpoint, payload, signal, requestId), endpoint, signal);
    const sessionCall = (method: string, transform?: (payload: any) => unknown) => async (payload: any) => {
      const result = await call("/api", `session.${method}`, transform ? transform(payload) : payload);
		return { rpcId: createRpcId(), result };
    };
    this.api = {
      sessions: {
        list: sessionCall("list", (payload) => payload),
        search: sessionCall("search", (payload) => ({ query: payload?.query, cwd: payload?.cwd, limit: payload?.limit })),
        fork: sessionCall("fork", (payload) => ({
          sessionId: payload?.sessionId,
          ...(payload?.cwd === undefined ? {} : { cwd: payload.cwd }),
          ...(payload?.atSeq === undefined ? {} : { atSeq: payload.atSeq }),
          ...(payload?.increaseTitle === undefined ? {} : { increaseTitle: payload.increaseTitle }),
        })),
        rename: sessionCall("rename", (payload) => ({ sessionId: payload?.sessionId, title: payload?.title, cwd: payload?.cwd })),
        create: sessionCall("create", (payload) => ({
          ...(payload?.workspaceId === undefined ? {} : { workspaceId: payload.workspaceId }),
          ...(payload?.cwd === undefined ? {} : { cwd: payload.cwd }),
          ...(payload?.modelId === undefined ? {} : { modelId: payload.modelId }),
        })),
        history: sessionCall("history", (payload) => ({ sessionId: payload?.sessionId, ...(payload?.beforeSeq === undefined ? {} : { beforeSeq: payload.beforeSeq }), ...(payload?.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }) })),
        attachment: sessionCall("attachment", (payload) => ({ sessionId: payload?.sessionId, attachmentId: payload?.attachmentId })),
        updateQueue: sessionCall("updateQueue", (payload) => ({ sessionId: payload?.sessionId, itemId: payload?.itemId, action: payload?.action })),
        models: sessionCall("models"),
        selectModel: sessionCall("selectModel", (payload) => ({ sessionId: payload?.sessionId, modelId: payload?.modelId })),
        prompt: sessionCall("prompt", (payload) => ({ sessionId: payload?.sessionId, ...(payload?.text === undefined ? {} : { text: payload.text }), ...(payload?.content === undefined ? {} : { content: payload.content }), ...(payload?.mode === undefined ? {} : { mode: payload.mode }) })),
        cancel: sessionCall("cancel", (payload) => ({ sessionId: payload?.sessionId })),
      },
      workspace: {
        list: () => call("/api", "workspace.list", {}),
        create: (payload: unknown) => call("/api", "workspace.create", payload),
        rename: (payload: unknown) => call("/api", "workspace.rename", payload),
        delete: (payload: unknown) => call("/api", "workspace.delete", payload),
        insertBefore: (payload: unknown) => call("/api", "workspace.insertBefore", payload),
        insertSessionBefore: (payload: unknown) => call("/api", "workspace.insertSessionBefore", payload),
        archiveSession: (payload: unknown) => call("/api", "workspace.archiveSession", payload),
      },
      host: {
        describe: async () => response({ product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" }),
        pickDirectory: async () => call("/api", "host.pickDirectory", {}),
        listDirectory: async (payload?: unknown, signal?: AbortSignal) => call("/api", "host.listDirectory", payload ?? {}, signal),
        createDirectory: async (payload: unknown) => call("/api", "host.createDirectory", payload),
        openPath: async (payload: unknown, signal?: AbortSignal) => call("/api", "host.openPath", payload, signal),
      },
      llm: {
		providers: async () => ({ rpcId: createRpcId(), result: await call("/api", "llm.providers", {}) }),
		models: async () => ({ rpcId: createRpcId(), result: await call("/api", "llm.models", {}) }),
      },
      events: {
        mux: (request?: unknown, signal?: AbortSignal) => this.eventStream("mux", request, signal),
        host: (request?: unknown, signal?: AbortSignal) => this.eventStream("host", request, signal),
        respond: (message: unknown, signal?: AbortSignal) => this.transport?.respond(message as never, signal) ?? invokeBridge(ctx, "dsh:rpc", message),
      },
    };
    this.rpc = { call };
    Object.defineProperty(this, "start", {
      configurable: true,
      value: (sinks?: { onMuxEnvelope?: (envelope: unknown) => void; onHostEnvelope?: (envelope: unknown) => void; onConnected?: (description: unknown) => void; onStateChange?: (state: string) => void }) => sinks ? this.startLoop(sinks) : undefined,
    });
  }

  private startLoop(sinks: { onMuxEnvelope?: (envelope: unknown) => void; onHostEnvelope?: (envelope: unknown) => void; onConnected?: (description: unknown) => void; onStateChange?: (state: string) => void }): { generation: number; stop: () => void } {
    if (this.activeLoop) return this.activeLoop;
    this.controller = new ConnectionController({
      carrier: {
        open: async (signal, sink, onDisconnect) => {
          if (this.transport) return this.transport.open(signal, sink, onDisconnect);
          let sessionDispose: (() => void) | undefined;
          let pluginDispose: (() => void) | undefined;
          let replaying = true;
          const queued: Array<{ type: "session/event" | "plugin/event"; payload: unknown; rpcId?: string }> = [];
          const emit = (event: { type: "session/event" | "plugin/event"; payload: unknown; rpcId?: string }) => {
            if (replaying) queued.push(event);
            else if (this.acceptEvent(event.payload)) sink(event);
          };
          const close = () => {
            sessionDispose?.();
            pluginDispose?.();
            sessionDispose = undefined;
            pluginDispose = undefined;
          };
          const abort = () => { close(); onDisconnect(); };
          signal.addEventListener("abort", abort, { once: true });
          try {
            let description: unknown = { product: "OpenBuddy", runtime: "pi", pluginHost: "openbuddy" };
            if (this.bridge.invoke) {
              const raw = await this.bridge.invoke("dsh:rpc", typedRequest("host.describe", {}));
              if (raw && typeof raw === "object" && "result" in raw) {
                const result = asRpcResult((raw as { result: unknown }).result);
                if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
                if (result.value && typeof result.value === "object") description = result.value;
              } else if (raw && typeof raw === "object" && "product" in raw) {
                description = raw;
              }
            }
            const [sessionStop, pluginStop] = await Promise.all([
              this.bridge.onRpcMessage
                ? this.bridge.onRpcMessage((message) => {
                    if (!message || typeof message !== "object") return;
                    const value = message as { type?: unknown; method?: unknown; rpcId?: string; payload?: unknown };
                    if (value.type !== "server-request") return;
                    if (value.method === "session.permission" || value.method === "session.question") {
                      const eventType = value.method === "session.permission" ? "session/permission" : "session/question";
                      const interaction = { type: "plugin/event" as const, payload: { type: eventType, payload: value.payload }, rpcId: value.rpcId };
                      if (replaying) queued.push(interaction);
                      else sink(interaction);
                      return;
                    }
                    if (value.method !== "session.event" && value.method !== "plugin.event") return;
                    const type = value.method === "session.event" ? "session/event" : "plugin/event";
                    if (replaying) queued.push({ type, payload: value.payload, rpcId: value.rpcId });
                    else if (this.acceptEvent(value.payload)) sink({ type, payload: value.payload, rpcId: value.rpcId });
                  })
                : this.bridge.onEvent?.((event) => { emit({ type: "session/event", payload: event, rpcId: event.rpcId }); }) ?? Promise.resolve(undefined),
              this.bridge.onRpcMessage
                ? Promise.resolve(undefined)
                : this.bridge.onPluginEvent?.((event) => { emit({ type: "plugin/event", payload: event, rpcId: event.rpcId }); }) ?? Promise.resolve(undefined),
            ]);
            if (signal.aborted) {
              sessionStop?.();
              pluginStop?.();
              throw new Error("connection generation aborted");
            }
            await this.replayEvents(signal, (event) => {
              if (this.acceptEvent(event.payload)) sink(event);
            });
            replaying = false;
            queued
              .sort((left, right) => {
                const leftSequence = left.payload && typeof left.payload === "object" && typeof (left.payload as { sequence?: unknown }).sequence === "number" ? (left.payload as { sequence: number }).sequence : Number.MAX_SAFE_INTEGER;
                const rightSequence = right.payload && typeof right.payload === "object" && typeof (right.payload as { sequence?: unknown }).sequence === "number" ? (right.payload as { sequence: number }).sequence : Number.MAX_SAFE_INTEGER;
                return leftSequence - rightSequence;
              })
              .forEach((event) => {
                if (this.acceptEvent(event.payload)) sink(event);
              });
            sessionDispose = sessionStop;
            pluginDispose = pluginStop;
            if (!sessionDispose && !pluginDispose) onDisconnect();
            return {
              description,
              close: () => {
                signal.removeEventListener("abort", abort);
                close();
              },
            };
          } catch (error) {
            signal.removeEventListener("abort", abort);
            close();
            onDisconnect();
            throw error;
          }
        },
      },
      onConnected: (description, generation) => {
        this.generation = generation;
        this.started = true;
        this.state = "connected";
        for (const [token, pending] of this.pendingCalls) {
          if (pending.generation === generation) continue;
          pending.generation = generation;
          this.invokePendingCall(token, pending);
        }
        sinks.onConnected?.({ ...(description as Record<string, unknown>), generation });
      },
      onStateChange: (state: ConnectionState) => {
        this.state = state;
        if (state === "reconnecting") this.rejectPendingCalls(this.generation);
        sinks.onStateChange?.(state);
      },
      onEnvelope: (event, generation) => {
    if (event.type === "session/subscribed") {
      this.publishSessionBaseline(event);
      sinks.onMuxEnvelope?.({ rpcId: event.rpcId, payload: event.payload });
      return;
    }
    if (event.type === "session/projection") {
      sinks.onMuxEnvelope?.({ rpcId: event.rpcId, payload: event.payload });
      return;
    }
        const type = event.type === "plugin/event" ? "plugin/event" : "session/event";
        this.publishStreamEvent({ type, payload: event.payload, rpcId: event.rpcId }, generation);
        const sessionId = sessionIdOf(event.payload) ?? event.sessionId;
        const envelope = { rpcId: `event-${generation}-${Date.now()}`, payload: { type, sessionId, event: event.payload ?? event, generation }, respond: event.respond };
        (type === "plugin/event" ? sinks.onHostEnvelope : sinks.onMuxEnvelope)?.(envelope);
      },
      generationSeed: this.generation,
    });
    const loop = {
      generation: this.generation + 1,
      stop: () => {
        this.controller?.stop();
        this.rejectPendingCalls(this.generation, false);
        this.controller = undefined;
        this.activeLoop = undefined;
        this.started = false;
        this.closeEventStreams();
      },
    };
    this.activeLoop = loop;
    this.controller.start();
    return loop;
  }
}

class DeepSeekTypertClientService extends OpenBuddyService {
  static override provide = "typert";
  private readonly remoteListeners = new Set<(change: { kind: "remote"; key: string }) => void>();
  readonly contexts: {
    registerClient: (key: string, binder: { identity: (context: Context) => unknown }) => () => void;
    getClient: (key: string) => { identity: (context: Context) => unknown } | undefined;
  };
  readonly remotes: {
    register: (contribution: { package: string; descriptors: readonly ClientRemoteDescriptor[] }) => () => Promise<void>;
    get: (endpoint: string) => ClientRemoteDescriptor | undefined;
    list: () => ClientRemoteDescriptor[];
    subscribe: (listener: (change: { kind: "remote"; key: string }) => void) => () => void;
  };
  private readonly remoteContributions = new Map<string, { package: string; descriptors: readonly ClientRemoteDescriptor[] }>();
  private readonly remoteEndpoints = new Map<string, string>();

  constructor(ctx: Context) {
    super(ctx, "typert");
    const clientContexts = new Map<string, { identity: (context: Context) => unknown }>();
    const registerClient = (key: string, binder: { identity: (context: Context) => unknown }): (() => void) => {
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw new Error(`dsh-typert: client context key is invalid: ${key}`);
      if (!binder || typeof binder.identity !== "function") throw new Error(`dsh-typert: client context provider is invalid: ${key}`);
      if (clientContexts.has(key)) throw new Error(`dsh-typert: client context provider is already registered: ${key}`);
      clientContexts.set(key, binder);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (clientContexts.get(key) === binder) clientContexts.delete(key);
      };
    };
    this.contexts = { registerClient, getClient: (key) => clientContexts.get(key) };
    this.remotes = {
      register: (contribution) => {
        if (!contribution || typeof contribution.package !== "string" || !contribution.package) {
          throw new Error("dsh-typert: Remote contribution package is required");
        }
        if (!Array.isArray(contribution.descriptors) || contribution.descriptors.length === 0) {
          throw new Error(`dsh-typert: Remote contribution has no descriptors: ${contribution.package}`);
        }
        const contributionEndpoints = new Set<string>();
        for (const descriptor of contribution.descriptors) {
          if (!descriptor || typeof descriptor.namespace !== "string" || !/^[A-Za-z0-9_$.-]{1,80}$/.test(descriptor.namespace)
            || typeof descriptor.method !== "string" || !/^[A-Za-z0-9_$.-]{1,80}$/.test(descriptor.method)) {
            throw new Error(`dsh-typert: Remote descriptor is invalid: ${contribution.package}`);
          }
          const endpoint = `${descriptor.namespace}/${descriptor.method}`;
          if (descriptor.result !== undefined) validateRemoteCodec(descriptor.result, `${endpoint}.result`);
          for (const parameter of descriptor.parameters ?? []) {
            if (parameter.codec !== undefined) validateRemoteCodec(parameter.codec, `${endpoint}.${parameter.wire ?? parameter.name ?? "parameter"}`);
          }
          if (descriptor.invocation?.kind === "context" && descriptor.invocation.codec !== undefined) {
            validateRemoteCodec(descriptor.invocation.codec, `${endpoint}.${descriptor.invocation.wire ?? "context"}`);
          }
          if (descriptor.scope !== undefined) {
            if (descriptor.invocation?.kind === "context"
              || typeof descriptor.scope.context !== "string"
              || typeof descriptor.scope.wire !== "string"
              || (descriptor.parameters ?? []).filter((parameter: { name?: string; wire?: string }) => (parameter.wire ?? parameter.name) === descriptor.scope?.wire).length !== 1) {
              throw new Error(`dsh-typert: Remote descriptor scope is invalid: ${endpoint}`);
            }
          }
          if (contributionEndpoints.has(endpoint)) throw new Error(`dsh-typert: Remote contribution repeats endpoint: ${endpoint}`);
          contributionEndpoints.add(endpoint);
        }
        const previous = this.remoteContributions.get(contribution.package);
        if (previous && previous !== contribution) throw new Error(`dsh-typert: Remote contribution is already registered: ${contribution.package}`);
        for (const endpoint of contributionEndpoints) {
          const owner = this.remoteEndpoints.get(endpoint);
          if (owner !== undefined && owner !== contribution.package) throw new Error(`dsh-typert: Remote endpoint is already registered: ${endpoint}`);
        }
        this.remoteContributions.set(contribution.package, contribution);
        for (const endpoint of contributionEndpoints) this.remoteEndpoints.set(endpoint, contribution.package);
        this.emitRemoteChange(contribution.package);
        let active = true;
        return async () => {
          if (!active) return;
          active = false;
          if (this.remoteContributions.get(contribution.package) === contribution) {
            this.remoteContributions.delete(contribution.package);
            for (const descriptor of contribution.descriptors) {
              const endpoint = `${descriptor.namespace}/${descriptor.method}`;
              if (this.remoteEndpoints.get(endpoint) === contribution.package) this.remoteEndpoints.delete(endpoint);
            }
            this.emitRemoteChange(contribution.package);
          }
        };
      },
      get: (endpoint) => this.listRemoteDescriptors().find((descriptor) => `${descriptor.namespace}/${descriptor.method}` === endpoint),
      list: () => this.listRemoteDescriptors(),
      subscribe: (listener) => {
        this.remoteListeners.add(listener);
        return () => this.remoteListeners.delete(listener);
      },
    };
  }

  private listRemoteDescriptors(): ClientRemoteDescriptor[] {
    return [...this.remoteContributions.values()].flatMap((contribution) => contribution.descriptors.map((descriptor) => ({ ...descriptor, package: contribution.package })));
  }

  private emitRemoteChange(key: string): void {
    const change = { kind: "remote" as const, key };
    for (const listener of [...this.remoteListeners]) {
      try { listener(change); } catch { /* isolate registry observers */ }
    }
  }
}

class DeepSeekTypertGatewayClientService extends OpenBuddyService {
  static override provide = "typertGateway";
  static inject = ["connection"];
  readonly invoke: (request: unknown) => Promise<RpcResult>;

  constructor(ctx: Context) {
    super(ctx, "typertGateway");
    this.invoke = async (request: unknown) => {
      if (!request || typeof request !== "object" || Array.isArray(request)) {
        return rpcError(new Error("dsh-api-gateway: invocation request must be an object"));
      }
      const value = request as Record<string, unknown>;
      const unexpected = Object.keys(value).find((key) => !["package", "namespace", "method", "args", "signal"].includes(key));
      if (unexpected) {
        return rpcError(Object.assign(new Error(`dsh-api-gateway: unexpected request field ${unexpected}`), { code: "input-invalid" }));
      }
      const namespace = value.namespace;
      const method = value.method;
      const args = value.args;
      if (typeof namespace !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(namespace)
        || typeof method !== "string" || !/^[A-Za-z0-9_$.-]{1,80}$/.test(method)) {
        return rpcError(Object.assign(new Error("dsh-api-gateway: namespace and method are invalid"), { code: "input-invalid" }));
      }
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype) {
        return rpcError(Object.assign(new Error(`dsh-api-gateway: ${namespace}/${method} requires named arguments`), { code: "arguments-invalid" }));
      }
      if (value.package !== undefined && (typeof value.package !== "string" || !value.package.trim())) {
        return rpcError(Object.assign(new Error("dsh-api-gateway: package must be a non-empty string"), { code: "input-invalid" }));
      }
      const signal = value.signal;
      if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return rpcError(Object.assign(new Error(`dsh-api-gateway: ${namespace}/${method} has an invalid cancellation signal`), { code: "input-invalid" }));
      }
      const connection = ctx.get("connection") as { rpc?: { call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult> } } | undefined;
      if (!connection?.rpc?.call) return rpcError(Object.assign(new Error("dsh-api-gateway: connection is unavailable"), { code: "service-unavailable" }));
      const { signal: _signal, ...payload } = value;
      return connection.rpc.call("/api", `${namespace}/${method}`, { args: payload.args, ...(typeof payload.package === "string" ? { package: payload.package } : {}) }, signal as AbortSignal | undefined);
    };
    ctx.provide("typertGateway", this);
  }
}

type ClientRemoteDescriptor = {
  id?: string;
  package?: string;
  namespace: string;
  method: string;
  service?: string;
  implementation?: string;
  parameters?: ReadonlyArray<{ name?: string; wire?: string; codec?: RemoteCodec }>;
  invocation?: { kind: "direct" } | { kind: "context"; context: string; wire?: string; codec?: RemoteCodec };
  scope?: { context: string; wire: string };
  result?: RemoteCodec;
  cancellation?: boolean | { parameter: "signal" };
};

export type ClientRemoteContribution = {
  package: string;
  descriptors: ReadonlyArray<ClientRemoteDescriptor>;
};

export class DeepSeekLocaleService extends OpenBuddyService {
  static override provide = "locale";
  private readonly namespaces = new Map<string, Record<string, unknown>>();

  constructor(ctx: Context) {
    super(ctx, "locale");
  }

  register(name: string, values: Record<string, unknown>): () => void {
    const registered = { ...values };
    this.namespaces.set(name, registered);
    return () => {
      if (this.namespaces.get(name) === registered) this.namespaces.delete(name);
    };
  }

  get(name: string): Record<string, unknown> | undefined {
    const value = this.namespaces.get(name);
    return value ? { ...value } : undefined;
  }

  t(name: string, key: string, fallback = key): string {
    const value = this.namespaces.get(name)?.[key];
    return typeof value === "string" ? value : fallback;
  }
}

class DeepSeekRemoteService extends OpenBuddyService {
  static override provide = "remote";
  static inject = ["connection"];
  private readonly namespaces = new Map<string, Record<string, (...args: unknown[]) => Promise<RpcResult>>>();
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  constructor(ctx: Context) {
    super(ctx, "remote");
      ctx.provide("remote", new Proxy(this, {
      get: (target, property, receiver) => {
        if (typeof property !== "string" || property in target) return Reflect.get(target, property, receiver);
        const namespace = target.namespace(property);
        return new Proxy(namespace, { get: (methods, method) => typeof method === "string" ? methods[method] : undefined });
      },
      }));
    const onEvent = bridgeOf(ctx).onEvent;
    const onPluginEvent = (bridgeOf(ctx) as RendererAgentBridge & { onPluginEvent?: RendererAgentBridge["onEvent"] }).onPluginEvent;
    const subscribe = onPluginEvent ?? onEvent;
    if (subscribe) void subscribe((event) => {
      const eventName = event.type ?? "agent/event";
      const args = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        && Array.isArray((event.payload as { args?: unknown }).args)
        ? (event.payload as { args: unknown[] }).args
        : [event.payload];
      for (const listener of this.listeners.get(eventName) ?? []) listener(...args);
      for (const listener of this.listeners.get("agent/event") ?? []) listener(...args);
    }).then((dispose) => ctx.effect(() => dispose, "deepseek-remote.events"));
  }
  async $mount(contribution: { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> }): Promise<() => Promise<void>> {
    const wireContribution = serializeRemoteContribution(contribution) as { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> };
    const typert = this.ctx.get("typert") as DeepSeekTypertClientService | undefined;
    const unregisterContribution = typert?.remotes.register(wireContribution);
    let registration = await invokeBridge(this.ctx, "dsh:remote-register", wireContribution);
    // If the Main process already has a stale registration with a different
    // endpoint set (e.g. capability methods were added since the previous
    // renderer reload), the new shape collides with the previous one. Drop
    // the old registration, then retry once so the renderer reload recovers
    // cleanly without the user having to restart Electron.
    if (!registration.result.ok && /already registered/.test(registration.result.error.message ?? "")) {
      await invokeBridge(this.ctx, "dsh:remote-unregister", { package: wireContribution.package }).catch(() => undefined);
      registration = await invokeBridge(this.ctx, "dsh:remote-register", wireContribution);
    }
    if (!registration.result.ok) {
      await unregisterContribution?.();
      throw new Error(registration.result.error.message ?? "DeepSeek remote registration failed");
    }
    this.installContribution(wireContribution);
    return async () => {
      await invokeBridge(this.ctx, "dsh:remote-unregister", { package: wireContribution.package }).catch(() => undefined);
      this.uninstallContribution(wireContribution);
      await unregisterContribution?.();
    };
  }

  /** Install a contribution whose Host registration is already owned by Main. */
  $mountLocal(contribution: { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> }): () => Promise<void> {
    const wireContribution = serializeRemoteContribution(contribution) as { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> };
    const typert = this.ctx.get("typert") as DeepSeekTypertClientService | undefined;
    const unregisterContribution = typert?.remotes.register(wireContribution);
    this.installContribution(wireContribution);
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      this.uninstallContribution(wireContribution);
      await unregisterContribution?.();
    };
  }

  private installContribution(contribution: { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> }): void {
    for (const descriptor of contribution.descriptors) {
      const methods = this.namespaces.get(descriptor.namespace) ?? {};
      methods[descriptor.method] = async (...args) => {
        const values = [...args];
        const signal = descriptor.cancellation && values.at(-1) instanceof AbortSignal ? values.pop() as AbortSignal : undefined;
        const parameters = descriptor.parameters ?? [];
        const invocation = descriptor.invocation;
        const scope = descriptor.scope;
        const scopeParameterIndex = scope ? parameters.findIndex((parameter) => (parameter.wire ?? parameter.name) === scope.wire) : -1;
        let valueIndex = 0;
        const remoteArgs: Record<string, unknown> | unknown[] = parameters.length
          ? Object.fromEntries(parameters.map((parameter, index) => {
            const wire = parameter.wire ?? parameter.name ?? `arg${index}`;
            if (index === scopeParameterIndex) return [wire, undefined];
            const value = values[valueIndex];
            valueIndex += 1;
            return [wire, parseRemoteCodec(parameter.codec, value, `${descriptor.namespace}/${descriptor.method}.${wire}`)];
          }))
          : values;
        if (scope) {
          const binder = (this.ctx.get("typert") as DeepSeekTypertClientService | undefined)?.contexts.getClient(scope.context);
          if (!binder) throw new Error(`dsh-typert: Client Context provider is unavailable: ${scope.context}`);
          const identity = binder.identity(this.ctx);
          if (identity === undefined) throw new Error(`dsh-typert: Client Context identity is unavailable: ${scope.context}`);
          if (Array.isArray(remoteArgs)) throw new Error("dsh-typert: scoped Remote arguments must be named");
          const parameter = parameters[scopeParameterIndex];
          remoteArgs[scope.wire] = parseRemoteCodec(parameter?.codec, identity, `${descriptor.namespace}/${descriptor.method}.${scope.wire}`);
        }
        if (invocation?.kind === "context") {
          const binder = (this.ctx.get("typert") as DeepSeekTypertClientService | undefined)?.contexts.getClient(invocation.context);
          if (!binder) throw new Error(`dsh-typert: Client Context provider is unavailable: ${invocation.context}`);
          const identity = binder.identity(this.ctx);
          if (identity === undefined) throw new Error(`dsh-typert: Client Context identity is unavailable: ${invocation.context}`);
          if (Array.isArray(remoteArgs)) throw new Error("dsh-typert: scoped Remote arguments must be named");
          const wire = invocation.wire ?? `${invocation.context}Id`;
          remoteArgs[wire] = parseRemoteCodec(invocation.codec, identity, `${descriptor.namespace}/${descriptor.method}.${wire}`);
        }
        const call = (this.ctx.get("connection") as DeepSeekConnectionService).rpc.call("/api", `${descriptor.namespace}/${descriptor.method}`, {
          package: contribution.package,
          namespace: descriptor.namespace,
          method: descriptor.method,
          args: remoteArgs,
        }, signal);
        return call.then((result) => result.ok && descriptor.result
          ? { ...result, value: parseRemoteCodec(descriptor.result, result.value, `${descriptor.namespace}/${descriptor.method}.result`) }
          : result);
      };
      this.namespaces.set(descriptor.namespace, methods);
      if (!(descriptor.namespace in this)) {
        Object.defineProperty(this, descriptor.namespace, { configurable: true, enumerable: true, get: () => this.namespaces.get(descriptor.namespace) });
      }
    }
  }

  private uninstallContribution(contribution: { package: string; descriptors: ReadonlyArray<ClientRemoteDescriptor> }): void {
    for (const descriptor of contribution.descriptors) {
      const methods = this.namespaces.get(descriptor.namespace);
      if (!methods) continue;
      delete methods[descriptor.method];
      if (Object.keys(methods).length === 0) {
        this.namespaces.delete(descriptor.namespace);
        delete (this as unknown as Record<string, unknown>)[descriptor.namespace];
      }
    }
  }
  $on(event: string, listener: (...args: unknown[]) => void): () => void {
    if (!forwardedRemoteEvents.has(event) && event !== "agent/event") return () => undefined;
    const listeners = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }
  $dispatch(event: string, args: readonly unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
  private namespace(name: string): Record<string, (...args: unknown[]) => Promise<RpcResult>> { return this.namespaces.get(name) ?? {}; }
}

const standardRemoteContributions = [
  {
    package: "@deepseek-ai/dsh-commands",
    descriptors: [
      { namespace: "commands", method: "list", implementation: "list", service: "commands", parameters: [{ name: "agent", wire: "agent" }] },
      { namespace: "commands", method: "execute", implementation: "execute", service: "commands", parameters: [{ name: "agent", wire: "agent" }, { name: "line", wire: "line" }, { name: "images", wire: "images", optional: true } ] },
    ],
  },
  {
    package: "@deepseek-ai/dsh-goal",
    descriptors: [
      { namespace: "goals", method: "create", implementation: "create", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "request", wire: "request" }] },
      { namespace: "goals", method: "edit", implementation: "edit", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }, { name: "request", wire: "request" }] },
      { namespace: "goals", method: "pause", implementation: "pause", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "resume", implementation: "resume", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "complete", implementation: "complete", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "clear", implementation: "clear", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
    ],
  },
  {
    package: "@deepseek-ai/dsh-file-reference",
    descriptors: [{ namespace: "fileReferences", method: "list", implementation: "list", service: "fileReferences", parameters: [{ name: "agent", wire: "agent" }, { name: "query", wire: "query" }] }],
  },
  {
    package: "@deepseek-ai/dsh-host-plugin-inventory",
    descriptors: [{ namespace: "pluginInventory", method: "list", implementation: "list", service: "pluginInventory", parameters: [] }],
  },
  {
    package: "@deepseek-ai/dsh-message-feedback",
    descriptors: [
      { namespace: "messageFeedback", method: "list", implementation: "list", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "messageFeedback", method: "put", implementation: "put", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "messageFeedback", method: "delete", implementation: "delete", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
    ],
  },
  {
    package: "@deepseek-ai/dsh-session-reference",
    descriptors: [{ namespace: "sessionReferenceResolver", method: "candidates", implementation: "candidates", service: "sessionReferenceResolver", parameters: [{ name: "agent", wire: "agent" }, { name: "query", wire: "query" }] }],
  },
  {
    package: "@deepseek-ai/dsh-cordis-host-runner",
    descriptors: [
      { namespace: "dynamicCordisRunner", method: "inventory", implementation: "inventory", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "invoke", implementation: "invoke", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "stopFromPanel", implementation: "stopFromPanel", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "undefineFromPanel", implementation: "undefineFromPanel", service: "dynamicCordisRunner" },
    ],
  },
] as const;

const deepSeekConnectionClient = {
  default: { apply: (ctx: Context) => new DeepSeekConnectionService(ctx), ConnectionHandle: DeepSeekConnectionService },
  apply: (ctx: Context) => new DeepSeekConnectionService(ctx),
  ConnectionHandle: DeepSeekConnectionService,
};

const deepSeekGatewayClient = {
  default: { apply: applyDeepSeekGatewayClient, TypertGatewayService: DeepSeekTypertGatewayClientService },
  apply: applyDeepSeekGatewayClient,
  TypertGatewayService: DeepSeekTypertGatewayClientService,
};

function applyDeepSeekGatewayClient(ctx: Context): void {
  new DeepSeekTypertClientService(ctx);
  new DeepSeekTypertGatewayClientService(ctx);
}

const deepSeekRemotesClient = {
  default: { apply: (ctx: Context) => applyDeepSeekRemotes(ctx), ClientRemote: DeepSeekRemoteService },
  apply: (ctx: Context) => applyDeepSeekRemotes(ctx),
  ClientRemote: DeepSeekRemoteService,
};

async function applyDeepSeekRemotes(ctx: Context): Promise<() => Promise<void>> {
  const remote = (ctx.get("remote") as DeepSeekRemoteService | undefined) ?? new DeepSeekRemoteService(ctx);
  const disposers: Array<() => Promise<void>> = [];
  try {
    for (const contribution of standardRemoteContributions) {
      disposers.push(await remote.$mount(contribution));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose();
    throw error;
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose();
  };
}

export interface DeepSeekSlotOptions {
  name: string;
  kind?: "single" | "list" | "keyed" | "chain";
  scope?: "root" | "global" | "session" | "session-maybe";
  children?: Record<string, { kind: "single" | "list" | "keyed" | "chain"; scope: "root" | "global" | "session" | "session-maybe" }>;
  id?: string;
  key?: string;
  order?: number;
  priority?: number;
  select?: (owner: unknown) => unknown | null;
  label?: string | (() => string);
  [key: string]: unknown;
}

export interface DeepSeekSlotSpec {
  name?: string;
  kind: "single" | "list" | "keyed" | "chain";
  scope: "root" | "global" | "session" | "session-maybe";
}

export interface DeepSeekSlotEntry {
  options: DeepSeekSlotOptions;
  component: unknown;
  registrant?: string;
}

export interface DeepSeekChainMatch {
  entry: DeepSeekSlotEntry;
  matched: unknown;
}

type SlotCleanup = void | (() => void) | Iterable<() => void>;

function cleanupOf(value: SlotCleanup): () => void {
  if (typeof value === "function") return value;
  if (!value || typeof value === "string" || typeof (value as Iterable<unknown>)[Symbol.iterator] !== "function") {
    return () => undefined;
  }
  const cleanups = [...value].filter((entry): entry is () => void => typeof entry === "function");
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}

function contributionKind(name: string): "sidebar" | "composer" | "message" | "settings" | "command" | undefined {
  if (name.startsWith("sidebar.")) return "sidebar";
  if (name.includes("composer") || name.includes("input")) return "composer";
  if (name.includes("message") || name.includes("chat.")) return "message";
  if (name.includes("toolview") || name.includes("tool.view")) return "message";
  if (name.includes("session.header") || name.includes("header.actions")) return "command";
  if (name.startsWith("settings.")) return "settings";
  if (name.startsWith("command") || name.includes("commands")) return "command";
  return undefined;
}

function displayLabel(options: DeepSeekSlotOptions): string | undefined {
  return typeof options.label === "function" ? options.label() : options.label;
}

export class DeepSeekSlotRegistry extends OpenBuddyService {
  static override provide = "slots";

  private readonly values = new Map<string, DeepSeekSlotEntry[]>();
  private readonly disposers = new Set<() => void>();
  private readonly core = new DeepSeekSlotCore();

  constructor(ctx: Context) {
    super(ctx, "slots");
    ctx.effect(() => () => this.clear());
  }

  register(options: DeepSeekSlotOptions, component?: unknown): () => void {
    if (!options?.name) throw new Error("deepseek-slots: registration name is required");
    const entry: DeepSeekSlotEntry = { options: { ...options }, component };
    const coreDispose = this.core.register(options, component);
    const entries = this.values.get(options.name) ?? [];
    entries.push(entry);
    entries.sort((left, right) => (left.options.order ?? 0) - (right.options.order ?? 0));
    this.values.set(options.name, entries);
    const contributionId = `${options.name}:${options.id ?? options.key ?? entries.length}`;
    const kind = contributionKind(options.name);
    const contributions = this.ctx.get("rendererContributions") as {
      register?: (value: { kind: "sidebar" | "assistant" | "project" | "composer" | "message" | "settings" | "command"; id: string; payload: Record<string, unknown> }) => () => void;
    } | undefined;
    const unregisterContribution = kind && contributions?.register
      ? contributions.register({
        kind,
        id: contributionId,
        payload: {
          label: displayLabel(options),
          slot: options.name,
          component,
          options: { ...options },
          internal: true,
        },
      })
      : undefined;
    let active = true;
    const dispose = (): void => {
      if (!active) return;
      active = false;
      unregisterContribution?.();
      const current = this.values.get(options.name);
      if (current) {
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length) this.values.set(options.name, current);
        else this.values.delete(options.name);
      }
      coreDispose();
      this.ctx.emit("slots/changed", options.name);
    };
    this.disposers.add(dispose);
    this.ctx.emit("slots/changed", options.name);
    return () => { this.disposers.delete(dispose); dispose(); };
  }

  inject(_name: string, callback: () => SlotCleanup): () => void {
    const dispose = cleanupOf(callback());
    this.disposers.add(dispose);
    return () => { this.disposers.delete(dispose); dispose(); };
  }

  entries(name: string): DeepSeekSlotEntry[] { return [...(this.values.get(name) ?? [])]; }

  entriesOfSlot(name: string): DeepSeekSlotEntry[] { return this.core.entriesOfSlot(name); }

  selectChain(name: string, owner: unknown): DeepSeekChainMatch | undefined {
    return this.core.selectChain(name, owner);
  }

  subscribe(name: string, listener: () => void): () => void {
    return this.core.subscribe(name, listener);
  }

  spec(name: string): ({ name: string } | DeepSeekSlotSpec) | undefined { return this.core.spec(name); }

  snapshot(): Array<{ name: string; spec: DeepSeekSlotSpec; entries: DeepSeekSlotEntry[]; children: string[] }> {
    return this.core.snapshot();
  }

  clear(): void {
    for (const dispose of [...this.disposers]) dispose();
    this.disposers.clear();
    this.values.clear();
    this.core.clear();
  }
}

export class DeepSeekSlotCore {
  private readonly registry = new Map<string, { spec: DeepSeekSlotSpec; entries: DeepSeekSlotEntry[]; parent?: string; owner?: DeepSeekSlotEntry; legacy?: boolean }>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly declarationListeners = new Map<string, Set<() => void>>();

  constructor() {
    this.registry.set("root", { spec: { kind: "single", scope: "root" }, entries: [] });
  }

  declare(name: string, spec: DeepSeekSlotSpec, parent?: string): void {
    const record = this.registry.get(name);
    const legacyUpgrade = record?.legacy
      && record.spec.scope === "global"
      && record.parent === undefined;
    if (record?.spec && !legacyUpgrade && (record.spec.kind !== spec.kind || record.spec.scope !== spec.scope)) {
      throw new Error(`deepseek-slots: slot "${name}" is already declared`);
    }
    if (record?.parent && parent !== undefined && record.parent !== parent) {
      throw new Error(`deepseek-slots: slot "${name}" is already declared by "${record.parent}"`);
    }
    if (!record) this.registry.set(name, { spec: { ...spec }, entries: [], parent });
    else {
      if (legacyUpgrade) {
        record.spec = { ...spec };
        record.legacy = false;
      }
      if (parent !== undefined && record.parent === undefined) record.parent = parent;
    }
    this.emitDeclaration(name);
  }

  register(options: DeepSeekSlotOptions, component?: unknown): () => void {
    if (!options?.name) throw new Error("deepseek-slots: registration name is required");
    const inferredKind = options.kind ?? (options.select ? "chain" : options.id || options.order !== undefined ? "list" : "single");
    const record = this.registry.get(options.name);
    if (!record) {
      this.declare(options.name, { kind: inferredKind, scope: options.scope ?? "global" });
      this.registry.get(options.name)!.legacy = !options.kind && !options.scope;
    } else if (options.kind && record.spec.kind !== options.kind && !record.legacy) {
      throw new Error(`deepseek-slots: slot "${options.name}" kind does not match its declaration`);
    }
    const target = this.registry.get(options.name)!;
    const priority = options.priority ?? 0;
    if (target.spec.kind === "keyed" && options.key === undefined) {
      throw new Error(`deepseek-slots: keyed slot "${options.name}" requires options.key`);
    }
    if (target.spec.kind === "list" && options.id === undefined) {
      throw new Error(`deepseek-slots: list slot "${options.name}" requires options.id`);
    }
    if (target.spec.kind === "chain" && options.select === undefined) {
      throw new Error(`deepseek-slots: chain slot "${options.name}" requires options.select`);
    }
    const sameCell = target.entries.find((entry) => {
      const entryPriority = entry.options.priority ?? 0;
      const sameId = target.spec.kind === "keyed"
        ? entry.options.key === options.key
        : target.spec.kind === "list"
          ? entry.options.id === (options.id ?? options.key)
          : true;
      return sameId && entryPriority === priority;
    });
    if (sameCell) throw new Error(`deepseek-slots: slot "${options.name}" already has a registration at priority ${priority}`);
    const entry = { options: { ...options }, component };
    const entries = target.entries;
    entries.push(entry);
    entries.sort((left, right) => {
      const priority = (left.options.priority ?? 0) - (right.options.priority ?? 0);
      return priority || (left.options.order ?? 0) - (right.options.order ?? 0);
    });
    this.declareChildren(options, entry);
    this.emit(options.name);
    return () => {
      const current = this.registry.get(options.name)?.entries ?? [];
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
      this.collapseChildren(options.name, entry);
      this.emit(options.name);
    };
  }

  entries(name: string): DeepSeekSlotEntry[] { return [...(this.registry.get(name)?.entries ?? [])]; }

  entriesOfSlot(name: string): DeepSeekSlotEntry[] {
    const record = this.registry.get(name);
    if (!record) return [];
    if (record.spec.kind === "chain") return [...record.entries];
    const seen = new Set<string>();
    return record.entries.filter((entry) => {
      const cell = record.spec.kind === "keyed"
        ? entry.options.key ?? ""
        : record.spec.kind === "list"
          ? entry.options.id ?? entry.options.key ?? ""
          : "single";
      if (seen.has(cell)) return false;
      seen.add(cell);
      return true;
    });
  }

  selectChain(name: string, owner: unknown): DeepSeekChainMatch | undefined {
    const record = this.registry.get(name);
    if (!record || record.spec.kind !== "chain") return undefined;
    for (const entry of record.entries) {
      const matched = entry.options.select?.(owner);
      if (matched !== null && matched !== undefined) return { entry, matched };
    }
    return undefined;
  }

  spec(name: string): ({ name: string } | DeepSeekSlotSpec) | undefined {
    const record = this.registry.get(name);
    if (!record) return undefined;
    return record.legacy ? { name } : { name, ...record.spec };
  }

  subscribe(name: string, listener: () => void): () => void {
    const listeners = this.listeners.get(name) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(name);
    };
  }

  subscribeDeclaration(name: string, listener: () => void): () => void {
    const listeners = this.declarationListeners.get(name) ?? new Set<() => void>();
    listeners.add(listener);
    this.declarationListeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.declarationListeners.delete(name);
    };
  }

  snapshot(): Array<{ name: string; spec: DeepSeekSlotSpec; entries: DeepSeekSlotEntry[]; children: string[] }> {
    return [...this.registry.entries()].map(([name, record]) => ({
      name,
      spec: { ...record.spec },
      entries: [...record.entries],
      children: [...this.registry.entries()].filter(([, child]) => child.parent === name).map(([childName]) => childName),
    }));
  }

  clear(): void {
    for (const record of this.registry.values()) {
      record.entries.length = 0;
    }
    for (const name of [...this.registry.keys()]) {
      if (name !== "root") this.registry.delete(name);
    }
    this.registry.get("root")!.entries.length = 0;
    this.listeners.clear();
    this.declarationListeners.clear();
  }

  private declareChildren(options: DeepSeekSlotOptions, owner: DeepSeekSlotEntry): void {
    for (const [name, spec] of Object.entries(options.children ?? {})) {
      this.declare(name, spec, options.name);
      this.registry.get(name)!.owner = owner;
    }
  }

  private collapseChildren(parent: string, owner: DeepSeekSlotEntry): void {
    for (const [name, record] of [...this.registry.entries()]) {
      if (record.parent !== parent || record.owner !== owner) continue;
      record.entries.length = 0;
      this.collapseChildren(name, owner);
      this.registry.delete(name);
      this.emitDeclaration(name);
    }
  }

  private emitDeclaration(name: string): void {
    for (const listener of [...(this.declarationListeners.get(name) ?? [])]) listener();
  }

  private emit(name: string): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener();
  }
}

function primitive(name: string, react: ReactRuntime): (props: Record<string, unknown>) => unknown {
  return (props) => {
    if (!react.createElement) return { name, props };
    const { children, ...rest } = props ?? {};
    return react.createElement("div", { ...rest, "data-deepseek-primitive": name }, ...(Array.isArray(children) ? children : [children]));
  };
}

class ClientCommandDirectory {
  private readonly commands = new Map<string, unknown>();

  register(command: { name: string } | unknown): () => void {
    const name = typeof command === "object" && command !== null && typeof (command as { name?: unknown }).name === "string"
      ? (command as { name: string }).name
      : String(command);
    this.commands.set(name, command);
    return () => { if (this.commands.get(name) === command) this.commands.delete(name); };
  }

  list(): unknown[] { return [...this.commands.values()]; }
  get(name: string): unknown { return this.commands.get(name); }
  clear(): void { this.commands.clear(); }
}

class DeepSeekCommandUiService extends OpenBuddyService {
  static override provide = "commandUi";
  readonly commands = new ClientCommandDirectory();
  readonly popupSelect = ClientPopupSelectController;

  constructor(ctx: Context) {
    super(ctx, "commandUi");
    ctx.effect(() => () => this.commands.clear(), "deepseek-command-ui.cleanup");
  }

  register(command: { name: string } | unknown): () => void { return this.commands.register(command); }
  list(): unknown[] { return this.commands.list(); }
  get(name: string): unknown { return this.commands.get(name); }
}

function filterCommandOptions<T extends { label?: string }>(options: readonly T[], search: string): readonly T[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return options;
  return options.filter((option) => String(option.label ?? "").toLocaleLowerCase().includes(needle));
}

class ClientPopupSelectController<T = unknown> {
  state = { open: false, options: [] as readonly T[], active: 0 };
  private listeners = new Set<() => void>();

  open(options: readonly T[]): void { this.state = { open: true, options, active: 0 }; this.emit(); }
  close(): void { this.state = { ...this.state, open: false }; this.emit(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}

export interface DeepSeekLayoutState {
  sidebarCollapsed: boolean;
  detailsOpen: boolean;
}

export class DeepSeekLayoutController extends OpenBuddyService {
  static override provide = "layout";
  private state: DeepSeekLayoutState = { sidebarCollapsed: false, detailsOpen: false };
  private readonly listeners = new Set<(state: DeepSeekLayoutState) => void>();

  constructor(ctx: Context) {
    super(ctx, "layout");
    this.getSnapshot = this.getSnapshot.bind(this);
    ctx.effect(() => () => this.listeners.clear(), "deepseek-layout.cleanup");
  }

  getSnapshot(): DeepSeekLayoutState { return { ...this.state }; }
  subscribe(listener: (state: DeepSeekLayoutState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  toggleSidebar(): void { this.update({ sidebarCollapsed: !this.state.sidebarCollapsed }); }
  setSidebarCollapsed(collapsed: boolean): void { this.update({ sidebarCollapsed: collapsed }); }
  openDetails(): void { this.update({ detailsOpen: true }); }
  closeDetails(): void { this.update({ detailsOpen: false }); }

  private update(patch: Partial<DeepSeekLayoutState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
    this.ctx.emit("layout/change", snapshot);
  }
}

export interface DeepSeekThemeDefinition {
  id: string;
  colorScheme: "light" | "dark";
  tokens: Record<string, string>;
}

export interface DeepSeekThemeSnapshot {
  preference: "system" | "light" | "dark" | string;
  active: DeepSeekThemeDefinition;
  themes: readonly DeepSeekThemeDefinition[];
  revision: number;
}

export class DeepSeekThemeService extends OpenBuddyService {
  static override provide = "theme";
  private readonly themes = new Map<string, DeepSeekThemeDefinition>([
    ["light", { id: "light", colorScheme: "light", tokens: {} }],
    ["dark", { id: "dark", colorScheme: "dark", tokens: {} }],
  ]);
  private preference: "system" | "light" | "dark" | string = "system";
  private revision = 0;
  private readonly listeners = new Set<(snapshot: DeepSeekThemeSnapshot) => void>();

  constructor(ctx: Context) {
    super(ctx, "theme");
    this.getTheme = this.getTheme.bind(this);
    ctx.effect(() => () => this.listeners.clear(), "deepseek-theme.cleanup");
  }

  getTheme(): DeepSeekThemeSnapshot {
    const resolved = this.preference === "system"
      ? (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : this.preference;
    const active = this.themes.get(resolved) ?? this.themes.get("light")!;
    return { preference: this.preference, active: { ...active, tokens: { ...active.tokens } }, themes: [...this.themes.values()], revision: this.revision };
  }

  register(theme: DeepSeekThemeDefinition): () => void {
    if (!theme?.id || !theme.tokens || !["light", "dark"].includes(theme.colorScheme)) throw new Error("deepseek-theme: invalid theme");
    this.themes.set(theme.id, { ...theme, tokens: { ...theme.tokens } });
    this.publish();
    return () => {
      if (theme.id === "light" || theme.id === "dark") return;
      if (this.themes.delete(theme.id)) this.publish();
    };
  }

  setTheme(id: string): void {
    if (id !== "system" && !this.themes.has(id)) throw new Error(`theme "${id}" is not registered`);
    if (this.preference === id) return;
    this.preference = id;
    this.publish();
  }

  subscribe(listener: (snapshot: DeepSeekThemeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.revision += 1;
    const snapshot = this.getTheme();
    this.ctx.emit("theme/change", snapshot);
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

export class DeepSeekUiRendererService extends OpenBuddyService {
  static override provide = "uiRenderer";

  constructor(ctx: Context, private readonly react: ReactRuntime) {
    super(ctx, "uiRenderer");
  }

  mount(container: unknown, app?: unknown): () => void {
    if (!container || typeof container !== "object") throw new Error("deepseek-ui-renderer: mount container is required");
    const target = container as { __openbuddyMount?: (value: unknown) => (() => void) | void };
    if (typeof target.__openbuddyMount === "function") return target.__openbuddyMount(app) ?? (() => undefined);
    if (app === undefined) throw new Error("deepseek-ui-renderer: OpenBuddy shell owns the application mount");
    if (!this.react.createElement) throw new Error("deepseek-ui-renderer: React runtime is unavailable");
    return () => undefined;
  }
}

export class DeepSeekModelSelectionService extends OpenBuddyService {
  static override provide = "modelSelection";
  static inject = ["connection"];
  private readonly connection: { api?: { llm?: { models?: () => Promise<{ result: RpcResult }> }; sessions?: { selectModel?: (payload: unknown) => Promise<{ result: RpcResult }> } } };

  constructor(ctx: Context) {
    super(ctx, "modelSelection");
    this.connection = ctx.get("connection") as typeof this.connection;
  }

  readonly list = async (): Promise<{ provider: string; name: string; models: Array<{ id: string; name: string }> }[]> => {
    const result = await this.connection.api?.llm?.models?.();
    const rpc = result?.result;
    if (!rpc || !rpc.ok) throw new Error(rpc?.error.message ?? "DeepSeek model catalog is unavailable");
    const catalog = catalogOf(rpc.value);
    return catalog.providers.map((provider) => ({
      provider: provider.id ?? "unknown",
      name: provider.name ?? provider.id ?? "unknown",
      models: catalog.models
        .filter((model) => model.providerId === provider.id)
        .map((model) => ({ id: model.modelId ?? "", name: model.name ?? model.modelId ?? "" }))
        .filter((model) => model.id),
    }));
  }

  readonly select = async (sessionId: string, modelId: string): Promise<unknown> => {
    const result = await this.connection.api?.sessions?.selectModel?.({ sessionId, modelId });
    const rpc = result?.result;
    if (!rpc || !rpc.ok) throw new Error(rpc?.error.message ?? "DeepSeek model selection failed");
    return rpc.value;
  }
}

export class DeepSeekSettingsModelsService extends OpenBuddyService {
  static override provide = "settingsModels";
  static inject = ["connection"];
  private readonly connection: { api?: { llm?: { models?: () => Promise<{ result: RpcResult }> } } };

  constructor(ctx: Context) {
    super(ctx, "settingsModels");
    this.connection = ctx.get("connection") as typeof this.connection;
    ctx.set("settingsModels", this);
  }

  readonly list = async (): Promise<{ provider: string; name: string; models: Array<{ id: string; name: string }> }[]> => {
    const result = await this.connection.api?.llm?.models?.();
    const rpc = result?.result;
    if (!rpc || !rpc.ok) throw new Error(rpc?.error.message ?? "DeepSeek settings model catalog is unavailable");
    const catalog = catalogOf(rpc.value);
    return catalog.providers.map((provider) => ({
      provider: provider.id ?? "unknown",
      name: provider.name ?? provider.id ?? "unknown",
      models: catalog.models.filter((model) => model.providerId === provider.id).map((model) => ({
        id: model.modelId ?? "",
        name: model.name ?? model.modelId ?? "",
      })).filter((model) => model.id),
    }));
  }
}

export interface DeepSeekWorkspaceRecord {
  workspaceId?: string;
  path?: string;
  cwd?: string;
  title?: string;
  sessionIds?: string[];
  sessionCount?: number;
  [key: string]: unknown;
}

export interface DeepSeekWorkspaceListSnapshot {
  items: readonly DeepSeekWorkspaceRecord[];
  archivedSessionIds: readonly string[];
  state: "idle" | "loading" | "error";
  error: string | undefined;
  recentWorkspaceId: string | undefined;
}

type DeepSeekWorkspaceList = (() => Promise<DeepSeekWorkspaceRecord[]>) & DeepSeekSnapshot<DeepSeekWorkspaceListSnapshot>;

export interface DeepSeekSessionRecord {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt?: string | number;
  blank?: boolean;
  running?: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  subagentMode?: "one-shot" | "continuable";
  [key: string]: unknown;
}

export type DeepSeekSubagentAddress = {
  parentSessionId: string;
  childSessionId: string;
  mode: "one-shot" | "continuable";
};

export interface DeepSeekSubagentOpenOptions {
  /** Skip the renderer conversation replay when another UI owns the transcript. */
  loadConversation?: boolean;
}

export type DeepSeekSubagentEntry =
  | { kind: "child"; id: string; activity: "running" | "inactive"; hasChildren: boolean; mode: "one-shot" | "continuable"; label?: string }
  | { kind: "diagnostic"; id: string; reason: "corrupt" | "unsupported" | "unavailable" };

export interface DeepSeekSubagentCatalog {
  entries: readonly DeepSeekSubagentEntry[];
  parentAvailable: boolean;
}

export type DeepSeekSubagentBreadcrumb = readonly DeepSeekSubagentAddress[];

export interface DeepSeekSessionListSnapshot {
  items: readonly DeepSeekSessionRecord[];
  byId: Readonly<Record<string, DeepSeekSessionRecord>>;
  current: string | undefined;
  state: "idle" | "loading" | "error";
  phase: "pending" | "ready";
  subagentsByParent: Readonly<Record<string, DeepSeekSubagentCatalog>>;
  jobsBySession: Readonly<Record<string, readonly unknown[]>>;
  currentAddress: DeepSeekSubagentAddress | undefined;
  subagentBreadcrumb: DeepSeekSubagentBreadcrumb;
  error: string | undefined;
}

export interface DeepSeekProjectionFace extends DeepSeekSnapshot<unknown> {}

export type DeepSeekPromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string };

export type DeepSeekQueueAction =
  | { kind: "edit"; content: readonly DeepSeekPromptContentPart[] }
  | { kind: "remove" }
  | { kind: "steer" };

export interface DeepSeekConversationSnapshot {
  sessionId: string;
  events: readonly unknown[];
  projections: Readonly<Record<string, unknown>>;
  conversation: Readonly<Record<string, ConversationTargetSnapshot>>;
  hasMore: boolean;
  state: "idle" | "loading" | "error";
  error: string | undefined;
}

export interface DeepSeekSessionBinding {
  sessionId: string;
  session: {
    sessionId: string;
    getSnapshot: () => DeepSeekConversationSnapshot;
    subscribe: (listener: () => void) => () => void;
    projections: { faceOf: (key: string) => DeepSeekProjectionFace };
    prompt: (content: string | readonly DeepSeekPromptContentPart[], mode?: "queue" | "steer") => Promise<ContractRpcResult<{ accepted: true }>>;
    cancel: () => Promise<ContractRpcResult<{ accepted: true }>>;
    readAttachment: (attachmentId: string) => Promise<ContractRpcResult<{ attachment: unknown; data: Uint8Array }>>;
    updateQueue: (itemId: string, action: DeepSeekQueueAction) => Promise<ContractRpcResult<{ accepted: true }>>;
    loadOlder: () => Promise<void>;
    rename: (title: string) => Promise<ContractRpcResult<{ title: string; seq?: number }>>;
    command: (line: string) => Promise<unknown>;
  };
  ctx: Context;
}

export interface DeepSeekSessionProvideDescriptor {
  hooks?: readonly string[];
  props?: readonly string[];
  resolve: (binding: DeepSeekSessionBinding) => { hooks?: Record<string, unknown>; props?: Record<string, unknown> };
}

export interface DeepSeekSessionProvideInfo {
  sessionId: string | undefined;
  hooks: Record<string, unknown>;
  props: Record<string, unknown>;
  projections?: { faceOf: (key: string) => DeepSeekProjectionFace };
}

export interface DeepSeekConversationDefinition {
  kind?: string;
  target?: string;
  match?: (event: unknown) => unknown;
  start?: (context: unknown, match: unknown, reader: unknown) => unknown;
  update?: (context: unknown, match: unknown) => unknown;
  publication?: (match: unknown) => "none" | "animation-frame" | "immediate";
  buildLocationData?: (context: unknown, scope: "turn" | "step") => unknown;
  buildViewNode?: (match: unknown) => unknown;
  [key: string]: unknown;
}

class DeepSeekConversationRegistry {
  private readonly definitions = new Map<string, DeepSeekConversationDefinition>();
  private readonly listeners = new Set<() => void>();
  private fallback: DeepSeekConversationDefinition | undefined;
  constructor(private readonly key: "kind" | "target" = "kind", private readonly allowFallback = false) {}
  register(definition: DeepSeekConversationDefinition): () => void {
    const identity = definition?.[this.key];
    if (typeof identity !== "string" || !identity.trim()) throw new Error(`conversation ${this.key} must be non-empty`);
    if (this.key === "kind" && ((definition.target === undefined) !== (definition.buildViewNode === undefined))) throw new Error("conversation event target and buildViewNode must be declared together");
    if (this.key === "kind" && [definition.match, definition.start, definition.update].some((entry) => entry !== undefined) && [definition.match, definition.start, definition.update].some((entry) => typeof entry !== "function")) throw new Error("conversation event requires match, start, and update");
    if (this.definitions.has(identity)) throw new Error(`conversation definition already registered: ${identity}`);
    this.definitions.set(identity, definition);
    this.emit();
    return () => {
      if (this.definitions.get(identity) !== definition) return;
      this.definitions.delete(identity);
      this.emit();
    };
  }
  registerFallback(definition: DeepSeekConversationDefinition): () => void {
    if (!this.allowFallback) throw new Error("conversation view registry does not support fallback");
    const identity = definition?.[this.key];
    if (typeof identity !== "string" || !identity.trim() || definition.target === undefined || definition.buildViewNode === undefined) throw new Error("conversation fallback requires target and buildViewNode");
    if (this.fallback) throw new Error("conversation fallback is already registered");
    this.fallback = definition;
    this.emit();
    return () => {
      if (this.fallback !== definition) return;
      this.fallback = undefined;
      this.emit();
    };
  }
  fallbackEntry(): DeepSeekConversationDefinition | undefined { return this.fallback; }
  entries(): readonly DeepSeekConversationDefinition[] { return [...this.definitions.values()]; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of [...this.listeners]) listener(); }
}

function conversationDefinitionOf(value: DeepSeekConversationDefinition): ConversationDefinition | undefined {
  if (typeof value.kind !== "string" || typeof value.match !== "function" || typeof value.start !== "function" || typeof value.update !== "function") return undefined;
  return {
    kind: value.kind,
    ...(value.target === undefined ? {} : { target: value.target }),
    match: (event) => value.match!(event) as ReturnType<ConversationDefinition["match"]>,
    start: (context, match, reader) => value.start!(context, match, reader),
    update: (context, match) => value.update!(context, match),
    ...(typeof value.publication === "function" ? { publication: (match) => value.publication!(match) } : {}),
    ...(typeof value.buildLocationData === "function" ? { buildLocationData: (context, scope) => value.buildLocationData!(context, scope) as ReturnType<NonNullable<ConversationDefinition["buildLocationData"]>> } : {}),
    ...(typeof value.buildViewNode === "function" ? { buildViewNode: (context) => value.buildViewNode!(context) as ReturnType<NonNullable<ConversationDefinition["buildViewNode"]>> } : {}),
  };
}

function conversationViewDefinitionOf(value: DeepSeekConversationDefinition): ConversationViewDefinition | undefined {
  if (typeof value.target !== "string") return undefined;
  const create = value.create;
  if (typeof create !== "function") return { target: value.target };
  return {
    target: value.target,
    create: () => {
      const builder = create();
      if (!builder || typeof builder !== "object") throw new Error("conversation view builder factory returned an invalid builder");
      const value = builder as { empty?: unknown; replace?: unknown; apply?: unknown };
      if (typeof value.replace !== "function" || typeof value.apply !== "function") throw new Error("conversation view builder must provide replace and apply");
      return {
        empty: value.empty,
        replace: (input) => (value.replace as (value: unknown) => unknown)(input),
        apply: (input) => (value.apply as (value: unknown) => unknown)(input),
      };
    },
  };
}

class DeepSeekProjectionStore {
  private readonly rows = new Map<string, { value: unknown; sequence: number }>();
  private readonly faces = new Map<string, DeepSeekProjectionFace>();
  private readonly listeners = new Set<() => void>();
  private valuesCache: Readonly<Record<string, unknown>> | undefined;

  get(key: string): unknown { return this.rows.get(key)?.value; }
  values(): Readonly<Record<string, unknown>> {
    if (!this.valuesCache) this.valuesCache = Object.freeze(Object.fromEntries([...this.rows].map(([key, row]) => [key, row.value])));
    return this.valuesCache;
  }
  faceOf(key: string): DeepSeekProjectionFace {
    const existing = this.faces.get(key);
    if (existing) return existing;
    const face = { getSnapshot: () => this.get(key), subscribe: (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); } };
    this.faces.set(key, face);
    return face;
  }
  seed(values: Readonly<Record<string, unknown>>, sequence: number): void {
    for (const [key, value] of Object.entries(values)) this.apply(key, value, sequence);
  }
  apply(key: string, value: unknown, sequence: number): void {
    const previous = this.rows.get(key);
    if (previous && sequence <= previous.sequence) return;
    this.rows.set(key, { value, sequence });
    this.valuesCache = undefined;
    for (const listener of [...this.listeners]) listener();
  }
  truncate(sequence: number): void {
    let changed = false;
    for (const [key, row] of this.rows) {
      if (row.sequence <= sequence) continue;
      this.rows.delete(key);
      changed = true;
    }
    if (!changed) return;
    this.valuesCache = undefined;
    for (const listener of [...this.listeners]) listener();
  }
}

const sessionScopeKey = Symbol("openbuddy.deepseek.session.scope");

function sessionScopeOf(ctx: ContextType): string | undefined {
  return (ctx as ContextType & { [sessionScopeKey]?: string })[sessionScopeKey];
}

function createSessionScope(ctx: ContextType, sessionId: string): { ctx: ContextType; dispose: () => void } {
  const fiber = ctx.plugin(() => undefined);
  const scoped = fiber.ctx.extend({
    [sessionScopeKey]: sessionId,
    [Context.filter](listenerCtx: ContextType): boolean {
      const tag = sessionScopeOf(listenerCtx);
      return tag === undefined || tag === sessionId;
    },
  });
  return { ctx: scoped, dispose: () => fiber.dispose() };
}

type DeepSeekSnapshot<T> = {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
};

function normalizedSession(value: unknown): DeepSeekSessionRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : typeof record.id === "string" ? record.id : undefined;
  if (!sessionId) return undefined;
  return {
    ...record,
    sessionId,
    title: typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : sessionId,
    cwd: typeof record.cwd === "string" ? record.cwd : "",
  };
}

export class DeepSeekSessionsService extends OpenBuddyService {
  static override provide = "sessions";
  static inject = ["connection"];
  readonly list: DeepSeekSnapshot<DeepSeekSessionListSnapshot>;
  readonly searchResultLimit = 50;
  private readonly context: Context;
  private readonly listeners = new Set<() => void>();
  private readonly bindings = new Map<string, DeepSeekSessionBinding>();
  private readonly subagentAddresses = new Map<string, DeepSeekSubagentAddress>();
  private readonly projections = new Map<string, DeepSeekProjectionStore>();
  private readonly sessionSnapshots = new Map<string, DeepSeekConversationSnapshot>();
  private readonly sessionListeners = new Map<string, Set<() => void>>();
  private readonly assemblers = new Map<string, OpenBuddyConversationAssembler>();
  private readonly conversationEvents: DeepSeekConversationRegistry;
  private readonly conversationViews: DeepSeekConversationRegistry;
  private readonly conversationDisposers: Array<() => void> = [];
  private readonly scopeDisposers = new Map<string, () => void>();
  private readonly providers: DeepSeekSessionProvideDescriptor[] = [];
  readonly currentProvideInfo: DeepSeekSnapshot<DeepSeekSessionProvideInfo>;
  private provideSnapshot: DeepSeekSessionProvideInfo = { sessionId: undefined, hooks: {}, props: {} };
  private readonly provideListeners = new Set<() => void>();
  private snapshot: DeepSeekSessionListSnapshot = {
    items: [],
    byId: {},
    current: undefined,
    state: "idle",
    phase: "pending",
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    subagentBreadcrumb: [],
    error: undefined,
  };

  constructor(ctx: Context) {
    super(ctx, "sessions");
    this.context = ctx;
    this.conversationEvents = (ctx.get("conversationEvents") as DeepSeekConversationRegistry | undefined) ?? new DeepSeekConversationRegistry("kind", true);
    this.conversationViews = (ctx.get("conversationViews") as DeepSeekConversationRegistry | undefined) ?? new DeepSeekConversationRegistry("target", false);
    this.conversationDisposers.push(this.conversationEvents.subscribe(() => this.rebuildConversations()));
    this.conversationDisposers.push(this.conversationViews.subscribe(() => this.rebuildConversations()));
    this.list = { getSnapshot: () => this.snapshot, subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); } };
    this.currentProvideInfo = { getSnapshot: () => this.provideSnapshot, subscribe: (listener) => { this.provideListeners.add(listener); return () => this.provideListeners.delete(listener); } };
    ctx.set("sessions", this);
    Object.defineProperty(this, "fork", {
      configurable: true,
      value: (options: { sessionId: string; cwd?: string; atSeq?: number; increaseTitle?: boolean }) => this.forkCompatible(options),
    });
  }

  private publish(patch: Partial<DeepSeekSessionListSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if (Object.hasOwn(patch, "currentAddress") || patch.current === undefined) {
      next.subagentBreadcrumb = next.currentAddress === undefined ? [] : this.breadcrumbFor(next.currentAddress);
    }
    if (patch.items !== undefined) {
      next.byId = Object.fromEntries(patch.items.map((item) => [item.sessionId, item]));
    }
    this.snapshot = next;
    this.publishProvideInfo();
    for (const listener of [...this.listeners]) listener();
  }

  private publishProvideInfo(): void {
    const sessionId = this.snapshot.current;
    const binding = sessionId ? this.binding(sessionId) : undefined;
    const hooks: Record<string, unknown> = { session: binding?.session };
    const props: Record<string, unknown> = {};
    if (binding) {
      for (const descriptor of this.providers) {
        const contribution = descriptor.resolve(binding);
        for (const name of descriptor.hooks ?? []) {
          const value = contribution.hooks?.[name];
          if (value === undefined || Object.hasOwn(hooks, name)) throw new Error(`sessions.provide: invalid hook ${name}`);
          hooks[name] = value;
        }
        for (const name of descriptor.props ?? []) {
          const value = contribution.props?.[name];
          if (value === undefined || Object.hasOwn(props, name)) throw new Error(`sessions.provide: invalid prop ${name}`);
          props[name] = value;
        }
      }
    }
    this.provideSnapshot = { sessionId, hooks, props, ...(binding ? { projections: binding.session.projections } : {}) };
    for (const listener of [...this.provideListeners]) listener();
  }

  provide(descriptor: DeepSeekSessionProvideDescriptor): () => void {
    this.providers.push(descriptor);
    try {
      this.publishProvideInfo();
    } catch (error) {
      this.providers.pop();
      this.publishProvideInfo();
      throw error;
    }
    return () => {
      const index = this.providers.indexOf(descriptor);
      if (index >= 0) this.providers.splice(index, 1);
      this.publishProvideInfo();
    };
  }

  readonly handleHostEnvelope = (envelope: unknown): boolean => {
    if (!envelope || typeof envelope !== "object") return false;
    const payload = (envelope as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") return false;
    const frame = payload as { type?: unknown; sessionId?: unknown; workspaceId?: unknown; blank?: unknown; cwd?: unknown; running?: unknown; message?: unknown };
    if (frame.type === "host/session-added" && typeof frame.sessionId === "string") {
      const existing = this.snapshot.byId[frame.sessionId];
      const item: DeepSeekSessionRecord = {
        ...(existing ?? {}),
        sessionId: frame.sessionId,
        title: existing?.title ?? frame.sessionId,
        cwd: typeof frame.cwd === "string" ? frame.cwd : existing?.cwd ?? "",
        blank: typeof frame.blank === "boolean" ? frame.blank : existing?.blank,
      };
      const items = existing
        ? this.snapshot.items.map((entry) => entry.sessionId === frame.sessionId ? item : entry)
        : [...this.snapshot.items, item];
      this.publish({ items, phase: "ready", state: "idle", error: undefined });
      this.binding(frame.sessionId);
      return false;
    }
    if (frame.type === "host/session-removed" && typeof frame.sessionId === "string") {
      const items = this.snapshot.items.filter((entry) => entry.sessionId !== frame.sessionId);
      const current = this.snapshot.current === frame.sessionId ? undefined : this.snapshot.current;
      const currentAddress = this.snapshot.currentAddress?.parentSessionId === frame.sessionId || this.snapshot.currentAddress?.childSessionId === frame.sessionId
        ? undefined
        : this.snapshot.currentAddress;
      this.publish({ items, current, currentAddress });
      this.scopeDisposers.get(frame.sessionId)?.();
      this.scopeDisposers.delete(frame.sessionId);
      this.bindings.delete(frame.sessionId);
      this.sessionListeners.delete(frame.sessionId);
      this.projections.delete(frame.sessionId);
      this.sessionSnapshots.delete(frame.sessionId);
      this.subagentAddresses.delete(frame.sessionId);
      return false;
    }
    if (frame.type === "host/session-status" && typeof frame.sessionId === "string" && typeof frame.running === "boolean") {
      const running = frame.running;
      this.publish({ items: this.snapshot.items.map((entry) => entry.sessionId === frame.sessionId ? { ...entry, running } : entry) });
      return false;
    }
    if (frame.type === "host/agent-error" && typeof frame.sessionId === "string") {
      this.publish({ state: "error", error: typeof frame.message === "string" ? frame.message : "Agent error" });
      return false;
    }
    if (typeof frame.sessionId === "string" && (typeof frame.type !== "string" || frame.type.startsWith("session/"))) {
      this.applySessionEvent(frame.sessionId, payload);
      return false;
    }
    return typeof frame.type === "string" && frame.type.startsWith("host/workspace-");
  };

  private publishSession(sessionId: string, patch: Partial<DeepSeekConversationSnapshot>): void {
    const previous = this.sessionSnapshots.get(sessionId) ?? { sessionId, events: [], projections: {}, conversation: {}, hasMore: false, state: "idle" as const, error: undefined };
    const next = { ...previous, ...patch };
    this.sessionSnapshots.set(sessionId, next);
    for (const listener of [...(this.sessionListeners.get(sessionId) ?? [])]) listener();
  }

  private projectionStore(sessionId: string): DeepSeekProjectionStore {
    const existing = this.projections.get(sessionId);
    if (existing) return existing;
    const store = new DeepSeekProjectionStore();
    this.projections.set(sessionId, store);
    return store;
  }

  private assembler(sessionId: string): OpenBuddyConversationAssembler {
    const existing = this.assemblers.get(sessionId);
    if (existing) return existing;
    const assembler = new OpenBuddyConversationAssembler(
      {
        entries: () => this.conversationEvents.entries().map(conversationDefinitionOf).filter((entry): entry is ConversationDefinition => entry !== undefined),
        fallbackEntry: () => {
          const entry = this.conversationEvents.fallbackEntry();
          return entry ? conversationDefinitionOf(entry) : undefined;
        },
      },
      { entries: () => this.conversationViews.entries().map(conversationViewDefinitionOf).filter((entry): entry is ConversationViewDefinition => entry !== undefined) },
    );
    this.assemblers.set(sessionId, assembler);
    return assembler;
  }

  private rebuildConversations(): void {
    for (const [sessionId, assembler] of this.assemblers) {
      assembler.rebuildRegistry();
      this.publishSession(sessionId, { conversation: assembler.snapshotsByTarget() });
    }
  }

  private applySessionEvent(sessionId: string, event: unknown): void {
    if (!event || typeof event !== "object") return;
    const value = event as Record<string, unknown>;
    const sequence = typeof value.sessionSequence === "number" ? value.sessionSequence : typeof value.sequence === "number" ? value.sequence : undefined;
    const current = this.sessionSnapshots.get(sessionId) ?? { sessionId, events: [], projections: {}, conversation: {}, hasMore: false, state: "idle" as const, error: undefined };
    const eventKey = sequence === undefined ? undefined : `${sequence}`;
    const existing = current.events.some((entry) => entry && typeof entry === "object" && eventKey !== undefined && `${(entry as { sessionSequence?: unknown; sequence?: unknown }).sessionSequence ?? (entry as { sequence?: unknown }).sequence}` === eventKey);
    if (!existing) {
      const assembler = this.assembler(sessionId);
      assembler.append(event);
      this.publishSession(sessionId, { events: [...current.events, event].slice(-2000), conversation: assembler.snapshotsByTarget(), state: "idle", error: undefined });
    }
    if (value.type === "session/projection" && typeof value.key === "string" && typeof value.sequence === "number") {
      const store = this.projectionStore(sessionId);
      store.apply(value.key, value.value, value.sequence);
      this.publishSession(sessionId, { projections: store.values() });
    }
  }

  handleMuxEnvelope(envelope: unknown): void {
    if (!envelope || typeof envelope !== "object") return;
    const payload = (envelope as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") return;
    const frame = payload as { type?: unknown; sessionId?: unknown; event?: unknown; lastSeq?: unknown; key?: unknown; value?: unknown; seq?: unknown; jobs?: unknown };
    if (frame.type === "session/jobs" && typeof frame.sessionId === "string") {
      const jobs = Array.isArray(frame.jobs) ? frame.jobs : [];
      this.publish({ jobsBySession: { ...this.snapshot.jobsBySession, [frame.sessionId]: jobs } });
      void this.loadSubagentCatalog(frame.sessionId);
      return;
    }
    if (frame.type === "session/subscribed" && typeof frame.sessionId === "string" && typeof frame.lastSeq === "number") {
      const current = this.sessionSnapshots.get(frame.sessionId);
      this.projectionStore(frame.sessionId).truncate(frame.lastSeq);
      if (current) this.publishSession(frame.sessionId, { projections: this.projectionStore(frame.sessionId).values() });
      if (current) this.publishSession(frame.sessionId, { state: "idle" });
      return;
    }
    if (frame.type === "session/projection" && typeof frame.sessionId === "string" && typeof frame.key === "string" && typeof frame.seq === "number") {
      const store = this.projectionStore(frame.sessionId);
      store.apply(frame.key, frame.value, frame.seq);
      if (this.sessionSnapshots.has(frame.sessionId)) this.publishSession(frame.sessionId, { projections: store.values() });
      return;
    }
    if (frame.type === "session/event" && typeof frame.sessionId === "string") this.applySessionEvent(frame.sessionId, frame.event);
  }

  private async loadSubagentCatalog(parentSessionId: string): Promise<void> {
    try {
      const value = await this.rpc("subagent.list", { parentSessionId });
      const remoteEntries = value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries)
        ? (value as { entries: unknown[] }).entries
        : [];
      const entries = remoteEntries.filter((entry): entry is DeepSeekSubagentEntry => {
        if (!entry || typeof entry !== "object") return false;
        const row = entry as Record<string, unknown>;
        if (row.kind === "diagnostic") return typeof row.id === "string" && typeof row.reason === "string";
        return row.kind === "child" && typeof row.id === "string"
          && (row.mode === "one-shot" || row.mode === "continuable")
          && (row.activity === "running" || row.activity === "inactive")
          && typeof row.hasChildren === "boolean";
      });
      const knownIds = new Set(entries.filter((entry) => entry.kind === "child").map((entry) => entry.id));
      for (const item of this.snapshot.items) {
        if (item.parentSessionId !== parentSessionId || !item.subagentMode || knownIds.has(item.sessionId)) continue;
        entries.push({
          kind: "child",
          id: item.sessionId,
          mode: item.subagentMode,
          activity: item.running ? "running" : "inactive",
          ...(item.title ? { label: item.title } : {}),
          hasChildren: this.snapshot.items.some((candidate) => candidate.parentSessionId === item.sessionId),
        });
      }
      this.publish({
        subagentsByParent: {
          ...this.snapshot.subagentsByParent,
          [parentSessionId]: {
            entries,
            parentAvailable: (value as { parentAvailable?: unknown }).parentAvailable === true,
          },
        },
      });
    } catch {
      // Catalog is advisory; session history and prompt remain authoritative.
    }
  }

  private breadcrumbFor(address: DeepSeekSubagentAddress): DeepSeekSubagentBreadcrumb {
    const result: DeepSeekSubagentAddress[] = [];
    const seen = new Set<string>();
    let current: DeepSeekSubagentAddress | undefined = address;
    while (current && !seen.has(current.childSessionId)) {
      seen.add(current.childSessionId);
      result.unshift(current);
      const parent = this.subagentAddresses.get(current.parentSessionId);
      current = parent?.childSessionId === current.parentSessionId ? parent : undefined;
    }
    return result;
  }

  private async loadConversation(sessionId: string, address = this.subagentAddresses.get(sessionId)): Promise<void> {
    this.publishSession(sessionId, { state: "loading", error: undefined });
    try {
      const value = await this.rpc(address ? "subagent.history" : "session.history", address ? address : { sessionId });
      const hasMore = value && typeof value === "object" && typeof (value as { hasMore?: unknown }).hasMore === "boolean" ? Boolean((value as { hasMore: boolean }).hasMore) : false;
      const rows = Array.isArray(value)
        ? value
        : value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries)
          ? (value as { entries: unknown[] }).entries
          : [];
      const record = value && typeof value === "object" ? value as { projections?: { asOfSeq?: unknown; values?: unknown } } : undefined;
      if (record?.projections && typeof record.projections.asOfSeq === "number" && record.projections.values && typeof record.projections.values === "object" && !Array.isArray(record.projections.values)) {
        this.projectionStore(sessionId).seed(record.projections.values as Record<string, unknown>, record.projections.asOfSeq);
      }
      const assembler = this.assembler(sessionId);
      assembler.replaceWindow(rows);
      this.publishSession(sessionId, { events: rows, conversation: assembler.snapshotsByTarget(), hasMore, projections: this.projectionStore(sessionId).values(), state: "idle", error: undefined });
    } catch (error) {
      this.publishSession(sessionId, { state: "error", error: String(error) });
    }
  }

  private binding(sessionId: string): DeepSeekSessionBinding {
    const existing = this.bindings.get(sessionId);
    if (existing) return existing;
    const scope = createSessionScope(this.context, sessionId);
    const listeners = this.sessionListeners.get(sessionId) ?? new Set<() => void>();
    this.sessionListeners.set(sessionId, listeners);
    const projectionStore = this.projectionStore(sessionId);
    const address = this.subagentAddresses.get(sessionId);
    const session = {
      sessionId,
      getSnapshot: () => this.sessionSnapshots.get(sessionId) ?? { sessionId, events: [], projections: {}, conversation: {}, hasMore: false, state: "idle", error: undefined },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      projections: { faceOf: (key: string) => projectionStore.faceOf(key) },
      prompt: async (content: string | readonly DeepSeekPromptContentPart[], mode: "queue" | "steer" = "queue") => {
        if (!address) {
          return this.sessionResult<{ accepted: true }>("session.prompt", {
            sessionId,
            mode,
            ...(typeof content === "string" ? { text: content } : { content }),
          });
        }
        if (address.mode !== "continuable") return contractRpcError(new Error("One-shot subagent conversations are read-only"));
        const parts = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
        if (parts.some((part) => part.type === "image")) return contractRpcError(new Error("Image input is unavailable for subagent continuations"));
        return this.sessionResult<{ messageId: string }>("subagent.prompt", {
          ...address,
          content: parts
            .filter((part): part is Extract<DeepSeekPromptContentPart, { type: "text" }> => part.type === "text")
            .map((part) => ({ type: "text" as const, text: part.text })),
        }).then((result) => result.ok ? { ok: true, value: { accepted: true } } : result);
      },
      cancel: async () => this.sessionResult<{ accepted: true }>(address ? "subagent.interrupt" : "session.cancel", address ? address : { sessionId }),
      readAttachment: async (attachmentId: string) => {
        const result = await this.sessionResult<{ attachment: unknown; data: string }>("session.attachment", { sessionId, attachmentId });
        if (!result.ok) return result;
        const binary = typeof atob === "function" ? atob(result.value.data) : "";
        return { ok: true, value: { attachment: result.value.attachment, data: Uint8Array.from(binary, (character) => character.charCodeAt(0)) } };
      },
      updateQueue: (itemId: string, action: DeepSeekQueueAction) => this.sessionResult<{ accepted: true }>("session.updateQueue", { sessionId, itemId, action }),
      loadOlder: async () => {
        if (!this.sessionSnapshots.get(sessionId)?.hasMore) return;
        const current = this.sessionSnapshots.get(sessionId)?.events ?? [];
        const sequences = current.map((entry) => entry && typeof entry === "object" && typeof (entry as { seq?: unknown; sequence?: unknown }).seq === "number"
          ? (entry as { seq: number }).seq
          : entry && typeof entry === "object" && typeof (entry as { sequence?: unknown }).sequence === "number"
            ? (entry as { sequence: number }).sequence
            : undefined).filter((value): value is number => value !== undefined);
        const beforeSeq = sequences.length > 0 ? Math.min(...sequences) : undefined;
        const value = await this.rpc(address ? "subagent.history" : "session.history", address
          ? { ...address, ...(beforeSeq === undefined ? {} : { beforeSeq }) }
          : { sessionId, ...(beforeSeq === undefined ? {} : { beforeSeq }) });
        const rows = value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries) ? (value as { entries: unknown[] }).entries : [];
        const hasMore = value && typeof value === "object" && typeof (value as { hasMore?: unknown }).hasMore === "boolean" ? Boolean((value as { hasMore: boolean }).hasMore) : false;
        if (rows.length > 0) {
          const assembler = this.assembler(sessionId);
          const bySequence = new Map<number, unknown>();
          for (const entry of [...rows, ...current]) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as { seq?: unknown; sequence?: unknown };
            const sequence = typeof record.seq === "number" ? record.seq : typeof record.sequence === "number" ? record.sequence : undefined;
            if (sequence !== undefined) bySequence.set(sequence, entry);
          }
          const merged = [...bySequence.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry);
          assembler.prepend(rows, false);
          this.publishSession(sessionId, { events: merged, conversation: assembler.snapshotsByTarget(), hasMore });
        } else {
          this.publishSession(sessionId, { hasMore: false });
        }
      },
      rename: async (title: string) => address
        ? contractRpcError(new Error("Subagent sessions cannot be renamed through the Harness subagent API"))
        : this.sessionResult<{ title: string; seq?: number }>("session.rename", { sessionId, title }),
      command: async (line: string) => this.command(sessionId, line),
    } as DeepSeekSessionBinding["session"];
    const binding = { sessionId, session, ctx: scope.ctx };
    this.bindings.set(sessionId, binding);
    this.scopeDisposers.set(sessionId, scope.dispose);
    return binding;
  }

  private async sessionResult<T>(method: string, payload: unknown): Promise<ContractRpcResult<T>> {
    try {
      return { ok: true, value: await this.rpc(method, payload) as T };
    } catch (error) {
      return contractRpcError(error);
    }
  }

  private async command(sessionId: string, line: string): Promise<unknown> {
    const value = await invokeBridgeValue(this.context, "dsh:remote", { namespace: "commands", method: "execute", args: { agent: sessionId, line, images: [] } });
    return value;
  }

  scope(sessionId: string): Context | undefined {
    return this.snapshot.items.some((item) => item.sessionId === sessionId) || this.bindings.has(sessionId) ? this.binding(sessionId).ctx : undefined;
  }

  scopeOf(ctx: Context): string | undefined { return sessionScopeOf(ctx); }
  sessionOf(ctx: Context): DeepSeekSessionBinding["session"] | undefined {
    const sessionId = sessionScopeOf(ctx);
    return sessionId ? this.bindings.get(sessionId)?.session : undefined;
  }
  bindingOf(sessionId: string): DeepSeekSessionBinding | undefined {
    return this.snapshot.items.some((item) => item.sessionId === sessionId) || this.bindings.has(sessionId) ? this.binding(sessionId) : undefined;
  }

  subagentAddress(sessionId: string): DeepSeekSubagentAddress | undefined {
    return this.subagentAddresses.get(sessionId);
  }

  openSubagent(address: DeepSeekSubagentAddress, options: DeepSeekSubagentOpenOptions = {}): void {
    void this.activateSubagent(address, options).catch((error) => {
      this.publish({ state: "error", error: String(error) });
    });
  }

  private async activateSubagent(address: DeepSeekSubagentAddress, options: DeepSeekSubagentOpenOptions = {}): Promise<void> {
    if (this.snapshot.subagentsByParent[address.parentSessionId] === undefined) {
      await this.loadSubagentCatalog(address.parentSessionId);
    }
    const catalog = this.snapshot.subagentsByParent[address.parentSessionId];
    const entry = catalog?.entries.find((candidate) => candidate.kind === "child" && candidate.id === address.childSessionId);
    if (!entry || entry.kind !== "child" || entry.mode !== address.mode) {
      throw new Error(`Unknown subagent address: ${address.parentSessionId}/${address.childSessionId}`);
    }
    this.subagentAddresses.set(address.childSessionId, address);
    this.binding(address.childSessionId);
    this.publish({ current: address.childSessionId, currentAddress: address, error: undefined });
    void this.loadSubagentCatalog(address.childSessionId);
    if (options.loadConversation !== false) await this.loadConversation(address.childSessionId, address);
  }

  selectSubagent(address: DeepSeekSubagentAddress): void {
    this.openSubagent(address);
  }

  private async rpc(method: string, payload: unknown): Promise<unknown> {
    const connection = this.context.get("connection") as unknown as DeepSeekConnectionService | undefined;
    if (!connection?.rpc) throw new Error("DeepSeek client connection is unavailable");
    const result = await connection.rpc.call("/api", method, payload);
    if (!result.ok) throw new Error(result.error.message ?? `DeepSeek session request failed: ${method}`);
    return result.value;
  }

  async refresh(cwd?: string): Promise<DeepSeekSessionRecord[]> {
    this.publish({ state: "loading", error: undefined });
    try {
      const value = await this.rpc("session.list", cwd === undefined ? {} : { cwd });
      const rows = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : Array.isArray(value) ? value : [];
      const items = rows.map(normalizedSession).filter((item): item is DeepSeekSessionRecord => Boolean(item));
      for (const item of items) {
        if (item.parentSessionId && item.subagentMode) {
          this.subagentAddresses.set(item.sessionId, { parentSessionId: item.parentSessionId, childSessionId: item.sessionId, mode: item.subagentMode });
        }
      }
      this.publish({ items, state: "idle", phase: "ready" });
      for (const item of items) this.binding(item.sessionId);
      await Promise.all(items.map((item) => this.loadSubagentCatalog(item.sessionId)));
      return items;
    } catch (error) {
      this.publish({ state: "error", error: String(error) });
      throw error;
    }
  }

  open(sessionId: string, options: DeepSeekSubagentOpenOptions = {}): void {
    const item = this.snapshot.items.find((entry) => entry.sessionId === sessionId);
    if (options.loadConversation === false) {
      this.subagentAddresses.delete(sessionId);
      this.publish({ current: sessionId, currentAddress: undefined, error: undefined });
      return;
    }
    void invokeBridgeValue(this.context, "agent:load-session", { sessionId, cwd: item?.cwd ?? "." }).then(() => {
      this.subagentAddresses.delete(sessionId);
      this.publish({ current: sessionId, currentAddress: undefined });
      void this.loadConversation(sessionId);
    }, (error) => { this.publish({ state: "error", error: String(error) }); });
  }

  clear(): void { this.publish({ current: undefined, currentAddress: undefined }); }

  dispose(): void {
    for (const dispose of this.scopeDisposers.values()) dispose();
    this.bindings.clear();
    this.subagentAddresses.clear();
    this.scopeDisposers.clear();
    this.sessionListeners.clear();
    this.projections.clear();
    this.assemblers.clear();
    for (const dispose of this.conversationDisposers.splice(0)) dispose();
    this.sessionSnapshots.clear();
    this.providers.length = 0;
    this.provideListeners.clear();
    this.listeners.clear();
    this.clear();
  }

  async create(input: { cwd?: string; workspaceId?: string } = {}): Promise<string> {
    const value = await this.rpc("session.create", input);
    const sessionId = value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string" ? (value as { sessionId: string }).sessionId : undefined;
    if (!sessionId) throw new Error("DeepSeek session.create did not return a session id");
    await this.refresh(input.cwd);
    return sessionId;
  }

  async search(query: string, signal?: AbortSignal): Promise<{ items: unknown[]; hasMore: boolean }> {
    if (signal?.aborted) throw new Error("The operation was aborted");
    const value = await this.rpc("session.search", { query, limit: this.searchResultLimit });
    if (!value || typeof value !== "object") return { items: [], hasMore: false };
    return { items: Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [], hasMore: Boolean((value as { hasMore?: unknown }).hasMore) };
  }

  async forkSession(sessionId: string, cwd?: string): Promise<string> {
    return this.forkCompatible({ sessionId, ...(cwd === undefined ? {} : { cwd }) });
  }

  private async forkCompatible(options: { sessionId: string; cwd?: string; atSeq?: number; increaseTitle?: boolean }): Promise<string> {
    const value = await this.rpc("session.fork", {
      sessionId: options.sessionId,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.atSeq === undefined ? {} : { atSeq: options.atSeq }),
      ...(options.increaseTitle === undefined ? {} : { increaseTitle: options.increaseTitle }),
    });
    const child = value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string" ? (value as { sessionId: string }).sessionId : undefined;
    if (!child) throw new Error("DeepSeek session.fork did not return a session id");
    await this.refresh(options.cwd);
    if (options.increaseTitle) {
      const sourceTitle = this.snapshot.byId[options.sessionId]?.title;
      if (sourceTitle) {
        const childTitle = `${sourceTitle} (copy)`;
        await this.rpc("session.rename", { sessionId: child, title: childTitle, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
        await this.refresh(options.cwd);
      }
    }
    return child;
  }
}

export class DeepSeekWorkspaceService extends OpenBuddyService {
  static override provide = "workspaces";
  static inject = ["connection", "sessions"];
  private readonly context: Context;
  private readonly sessions: DeepSeekSessionsService;
  readonly list: DeepSeekWorkspaceList;
  private workspaceSnapshot: DeepSeekWorkspaceListSnapshot = { items: [], archivedSessionIds: [], state: "idle", error: undefined, recentWorkspaceId: undefined };
  private readonly workspaceListeners = new Set<() => void>();

  constructor(ctx: Context) {
    super(ctx, "workspaces");
    this.context = ctx;
    this.sessions = ctx.get("sessions") as unknown as DeepSeekSessionsService;
    const load = async (): Promise<DeepSeekWorkspaceRecord[]> => {
      const connection = this.context.get("connection") as unknown as { rpc?: { call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult> } } | undefined;
      this.workspaceSnapshot = { ...this.workspaceSnapshot, state: "loading", error: undefined };
      for (const listener of [...this.workspaceListeners]) listener();
      try {
        const result = await connection?.rpc?.call("/api", "workspace.list", {});
        if (!result?.ok) throw new Error(result?.error.message ?? "DeepSeek workspace catalog is unavailable");
        const value = result.value;
        const items = Array.isArray(value)
          ? value as DeepSeekWorkspaceRecord[]
          : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
            ? (value as { items: DeepSeekWorkspaceRecord[] }).items
            : [];
        const archivedSessionIds = value && typeof value === "object" && Array.isArray((value as { archivedSessionIds?: unknown }).archivedSessionIds)
          ? (value as { archivedSessionIds: string[] }).archivedSessionIds
          : [];
        this.workspaceSnapshot = { items, archivedSessionIds, state: "idle", error: undefined, recentWorkspaceId: items[0]?.workspaceId };
        for (const listener of [...this.workspaceListeners]) listener();
        return items;
      } catch (error) {
        this.workspaceSnapshot = { ...this.workspaceSnapshot, state: "error", error: String(error) };
        for (const listener of [...this.workspaceListeners]) listener();
        throw error;
      }
    };
    Object.assign(load, {
      getSnapshot: () => this.workspaceSnapshot,
      subscribe: (listener: () => void) => { this.workspaceListeners.add(listener); return () => this.workspaceListeners.delete(listener); },
    });
    this.list = load as DeepSeekWorkspaceList;
    ctx.set("workspaces", this);
  }

  readonly create = async (input: string | { path?: string; cwd?: string; title?: string }): Promise<DeepSeekWorkspaceRecord> => {
    const path = typeof input === "string" ? input : input.path ?? input.cwd;
    if (!path) throw new Error("workspace path is required");
    const value = await this.rpc("workspace.create", { path, ...(typeof input === "string" || input.title === undefined ? {} : { title: input.title }) });
    await this.list();
    return (value as { workspace?: DeepSeekWorkspaceRecord })?.workspace ?? value as DeepSeekWorkspaceRecord;
  };

  readonly rename = async (workspaceId: string, title: string): Promise<DeepSeekWorkspaceRecord> => {
    const value = await this.rpc("workspace.rename", { workspaceId, title });
    await this.list();
    return (value as { workspace?: DeepSeekWorkspaceRecord })?.workspace ?? value as DeepSeekWorkspaceRecord;
  };

  readonly delete = async (workspaceId: string): Promise<boolean> => {
    const value = await this.rpc("workspace.delete", { workspaceId });
    await this.list();
    return Boolean((value as { deleted?: unknown })?.deleted ?? value);
  };

  readonly insertBefore = async (workspaceId: string, beforeWorkspaceId?: string): Promise<string[]> => {
    const value = await this.rpc("workspace.insertBefore", { workspaceId, ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }) });
    await this.list();
    return Array.isArray((value as { workspaceIds?: unknown })?.workspaceIds) ? (value as { workspaceIds: string[] }).workspaceIds : [];
  };

  readonly startSession = async (workspaceId?: string): Promise<unknown> => {
    const workspaces = await this.list();
    const workspace = workspaceId ? workspaces.find((entry) => entry.workspaceId === workspaceId) : undefined;
    const cwd = workspace?.path ?? workspace?.cwd;
    const sessionId = await this.sessions.create({
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(cwd === undefined ? {} : { cwd }),
    });
    this.sessions.open(sessionId);
    return sessionId;
  };

  readonly open = async (sessionId: string): Promise<unknown> => {
    this.sessions.open(sessionId);
    return sessionId;
  };

  readonly search = async (query: string, signal?: AbortSignal): Promise<unknown> => {
    if (signal?.aborted) throw new Error("The operation was aborted");
    return this.sessions.search(query, signal);
  };

  readonly connectWorkspace = async (workspaceId: string): Promise<string> => {
    const sessionId = await this.startSession(workspaceId);
    return String(sessionId);
  };

  readonly renameWorkspace = this.rename;
  readonly deleteWorkspace = this.delete;

  readonly insertSessionBefore = async (workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<DeepSeekWorkspaceRecord> => {
    const value = await this.rpc("workspace.insertSessionBefore", { workspaceId, sessionId, ...(beforeSessionId === undefined ? {} : { beforeSessionId }) });
    await this.list();
    return (value as { workspace?: DeepSeekWorkspaceRecord })?.workspace ?? value as DeepSeekWorkspaceRecord;
  };

  readonly archiveSession = async (sessionId: string): Promise<void> => {
    await this.rpc("workspace.archiveSession", { sessionId });
    await this.list();
    if (this.sessions.list.getSnapshot().current === sessionId) this.sessions.clear();
  };

  readonly pickDirectory = async (): Promise<string | null> => {
    const value = await this.rpc("host.pickDirectory", {});
    return value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string"
      ? (value as { path: string }).path
      : null;
  };

  readonly listDirectory = async (path?: string, signal?: AbortSignal): Promise<unknown> => {
    return this.rpc("host.listDirectory", path === undefined ? {} : { path }, signal);
  };

  readonly createDirectory = async (path: string, name: string): Promise<string> => {
    const value = await this.rpc("host.createDirectory", { path, name });
    return value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string" ? (value as { path: string }).path : `${path}/${name}`;
  };

  readonly openPath = async (path: string): Promise<void> => {
    await this.rpc("host.openPath", { path });
  };

  dispose(): void {
    this.workspaceListeners.clear();
    this.workspaceSnapshot = { ...this.workspaceSnapshot, items: [], archivedSessionIds: [], recentWorkspaceId: undefined };
  }

  private async rpc(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const connection = this.context.get("connection") as unknown as { rpc?: { call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult> } } | undefined;
    const result = await connection?.rpc?.call("/api", method, payload, signal);
    if (!result?.ok) throw new Error(result?.error.message ?? `DeepSeek workspace request failed: ${method}`);
    return result.value;
  }
}

type ClientSlotService = {
  inject?: (name: string, callback: () => unknown) => () => void;
  register?: (options: Record<string, unknown>, component?: unknown) => () => void;
  entries?: (name: string) => Array<{ options?: Record<string, unknown> }>;
  entriesOfSlot?: (name: string) => Array<{ options?: Record<string, unknown> }>;
};

function clientView(name: string, react: ReactRuntime): (props: Record<string, unknown>) => unknown {
  return (props) => {
    const children = typeof props?.children === "string" ? props.children : undefined;
    if (!react.createElement) return { name, props };
    return react.createElement("div", { "data-openbuddy-dsh-client": name, ...props }, children);
  };
}

function applyClientFeature(ctx: Context, react: ReactRuntime, options: { slot: string; id: string; name: string; locale?: string; priority?: number }): () => void {
  const slots = ctx.get("slots") as ClientSlotService | undefined;
  const locale = ctx.get("locale") as { register?: (name: string, values: Record<string, unknown>) => () => void } | undefined;
  const view = clientView(options.name, react);
  const localeDispose = options.locale && typeof locale?.register === "function"
    ? locale.register(options.locale, { zh: {}, en: {} })
    : () => undefined;
  if (!slots?.register) return () => { localeDispose?.(); };
  const existing = slots.entriesOfSlot?.(options.slot) ?? slots.entries?.(options.slot) ?? [];
  const priority = options.priority ?? 0;
  if (existing.some((entry) => entry.options?.id === options.id && (entry.options?.priority ?? 0) === priority)) {
    localeDispose?.();
    return () => undefined;
  }
  const register = () => slots.register!({ name: options.slot, id: options.id, locale: options.locale, ...(options.priority === undefined ? {} : { priority: options.priority }) }, view);
  const slotDispose = typeof slots.inject === "function" ? slots.inject(options.slot, register) : register();
  return () => { slotDispose?.(); localeDispose?.(); };
}

function remoteClient(ctx: Context, packageName: string, namespace: string): Record<string, (...args: unknown[]) => Promise<RpcResult>> {
  const connection = ctx.get("connection") as { rpc?: { call: (channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult> } } | undefined;
  const call = (method: string, args: unknown[], signal?: AbortSignal) => {
    if (!connection?.rpc?.call) return Promise.resolve(rpcError(new Error("DeepSeek client connection is unavailable")));
    return connection.rpc.call("/api", `${namespace}/${method}`, { package: packageName, namespace, method, args }, signal);
  };
  return new Proxy({}, { get: (_target, property) => typeof property === "string" ? (...input: unknown[]) => {
    const signal = input.at(-1) instanceof AbortSignal ? input.at(-1) as AbortSignal : undefined;
    const args = signal ? input.slice(0, -1) : input;
    return call(property, args, signal);
  } : undefined }) as Record<string, (...args: unknown[]) => Promise<RpcResult>>;
}

function rpcValueOf(result: RpcResult): unknown {
  if (!result.ok) throw new Error(result.error.message ?? "DeepSeek remote request failed");
  return result.value;
}

class DeepSeekSettingsScope {
  private readonly client: Record<string, (...args: unknown[]) => Promise<RpcResult>>;
  constructor(ctx: Context, readonly namespace: string) {
    this.client = remoteClient(ctx, "@deepseek-ai/dsh-settings-file", "settings");
  }
  async get(): Promise<unknown> { return rpcValueOf(await this.client.get(this.namespace)); }
  async update(patch: unknown): Promise<unknown> { return rpcValueOf(await this.client.update(this.namespace, patch)); }
  async replace(value: unknown): Promise<unknown> { return rpcValueOf(await this.client.replace(this.namespace, value)); }
}

function featureModule(react: ReactRuntime, options: { slot: string; id: string; name: string; locale?: string; exports?: Record<string, unknown> }): Record<string, unknown> {
  const apply = (ctx: Context) => applyClientFeature(ctx, react, options);
  return {
    ...options.exports,
    name: `openbuddy-${options.id}`,
    inject: ["slots", ...(options.locale ? ["locale"] : [])],
    apply,
  };
}

function featureModuleSet(react: ReactRuntime, options: { name: string; inject?: string[]; entries: Array<{ slot: string; id: string; view: string; locale?: string; priority?: number }> }): Record<string, unknown> {
  return {
    name: options.name,
    inject: options.inject ?? ["slots"],
    apply: (ctx: Context) => {
      const slots = ctx.get("slots") as DeepSeekSlotRegistry | undefined;
      if (!slots) return () => undefined;
      const disposers = options.entries.map((entry) => applyClientFeature(ctx, react, { slot: entry.slot, id: entry.id, name: entry.view, locale: entry.locale, priority: entry.priority }));
      return () => disposers.reverse().forEach((dispose) => dispose());
    },
  };
}

const deepSeekSessionTypes = {
  SessionId: (value: string) => value,
  SESSION_FORMAT_VERSION: 0,
};

const deepSeekSessionSurface = {
  isSurfaceEligibleType: (type: string) => ["user/message", "assistant/message", "tool/result"].includes(type),
  isSurfaceEvent: (event: unknown) => Boolean(
    event && typeof event === "object"
      && deepSeekSessionSurface.isSurfaceEligibleType(String((event as { type?: unknown }).type ?? ""))
      && "surfaceOp" in event,
  ),
  deriveEventMessage: (event: unknown) => {
    if (!event || typeof event !== "object") return null;
    const value = event as { type?: unknown; data?: unknown };
    if (value.type === "user/message") return value.data ?? null;
    if (value.type !== "assistant/message" && value.type !== "tool/result") return null;
    const data = value.data && typeof value.data === "object" ? value.data as { message?: unknown } : undefined;
    return data?.message ?? null;
  },
  foldSurface: (events: readonly unknown[]) => {
    const nodes: number[] = [];
    const replacements: Array<{ seq: number; start: number; end: number; shadowedSeqs: number[] }> = [];
    for (const event of events) {
      if (!deepSeekSessionSurface.isSurfaceEvent(event)) continue;
      const value = event as { seq?: unknown; surfaceOp?: unknown };
      if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || value.seq < 0) continue;
      if (value.surfaceOp === "append") {
        nodes.push(value.seq);
        continue;
      }
      if (!value.surfaceOp || typeof value.surfaceOp !== "object") continue;
      const operation = value.surfaceOp as { op?: unknown; start?: unknown; end?: unknown };
      if (operation.op !== "replace" || typeof operation.start !== "number" || typeof operation.end !== "number") continue;
      const startIndex = nodes.indexOf(operation.start);
      const endIndex = nodes.indexOf(operation.end);
      if (startIndex < 0 || endIndex < startIndex) continue;
      const shadowedSeqs = nodes.slice(startIndex, endIndex + 1);
      nodes.splice(startIndex, shadowedSeqs.length, value.seq);
      replacements.push({ seq: value.seq, start: operation.start, end: operation.end, shadowedSeqs });
    }
    return { nodes, replacements };
  },
};

const deepSeekWorkspaceTypes = {
  WorkspaceId: (value: string) => value,
};

const deepSeekSessionQueryTypes = {
  SessionSearchCursor: (value: string) => value,
};

export function createDeepSeekClientCompatibilityModules(react: ReactRuntime): Record<string, unknown> {
  const primitives = new Proxy<Record<string, unknown>>({
    Button: primitive("Button", react),
    Input: primitive("Input", react),
    Menu: primitive("Menu", react),
    Modal: primitive("Modal", react),
    Tooltip: primitive("Tooltip", react),
    MarkdownText: primitive("MarkdownText", react),
  }, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (!(property in target)) target[property] = primitive(property, react);
      return target[property];
    },
  });
  const runtime = {
    SlotRegistry: DeepSeekSlotRegistry,
    ConversationEventRegistry: class extends DeepSeekConversationRegistry {
      constructor() { super("kind", true); }
    },
    ConversationViewRegistry: class extends DeepSeekConversationRegistry {
      constructor() { super("target", false); }
    },
    createScope: (ctx: Context, sessionId: string) => createSessionScope(ctx, sessionId),
    scopeOf: (ctx: Context) => sessionScopeOf(ctx),
    inject: ["connection"],
    apply: (ctx: Context) => {
      const conversationEvents = (ctx.get("conversationEvents") as DeepSeekConversationRegistry | undefined) ?? new DeepSeekConversationRegistry("kind", true);
      const conversationViews = (ctx.get("conversationViews") as DeepSeekConversationRegistry | undefined) ?? new DeepSeekConversationRegistry("target", false);
      ctx.set("conversationEvents", conversationEvents);
      ctx.set("conversationViews", conversationViews);
      const sessions = (ctx.get("sessions") as DeepSeekSessionsService | undefined) ?? new DeepSeekSessionsService(ctx);
      const workspaces = (ctx.get("workspaces") as DeepSeekWorkspaceService | undefined) ?? new DeepSeekWorkspaceService(ctx);
      void sessions.refresh().catch(() => undefined);
      const connection = ctx.get("connection") as unknown as {
        start?: (sinks: { onConnected?: () => void; onMuxEnvelope?: (envelope: unknown) => void; onHostEnvelope?: (envelope: unknown) => void; onStateChange?: (state: string) => void }) => { stop: () => void };
      } | undefined;
      const refresh = () => { void sessions.refresh().catch(() => undefined); void workspaces.list().catch(() => undefined); };
      const loop = connection?.start?.({
        onConnected: refresh,
        onMuxEnvelope: (envelope) => sessions.handleMuxEnvelope(envelope),
        onHostEnvelope: (envelope) => {
          if (sessions.handleHostEnvelope(envelope)) void workspaces.list().catch(() => undefined);
        },
        onStateChange: (state) => { if (state === "reconnecting") sessions.clear(); },
      });
      return () => {
        loop?.stop();
        sessions.dispose();
        workspaces.dispose();
        if (ctx.get("conversationEvents") === conversationEvents) ctx.set("conversationEvents", undefined);
        if (ctx.get("conversationViews") === conversationViews) ctx.set("conversationViews", undefined);
      };
    },
    createSnapshotStore: <T>(value: T) => {
      let snapshot = value;
      const listeners = new Set<() => void>();
      return {
        getSnapshot: () => snapshot,
        set: (next: T) => { snapshot = next; for (const listener of listeners) listener(); },
        update: (mutator: (draft: T) => void) => {
          const draft = typeof structuredClone === "function"
            ? structuredClone(snapshot)
            : JSON.parse(JSON.stringify(snapshot)) as T;
          mutator(draft);
          snapshot = draft;
          for (const listener of listeners) listener();
        },
        subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      };
    },
    shallowEqual: (left: unknown, right: unknown) => {
      if (Object.is(left, right)) return true;
      if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      const leftKeys = Object.keys(leftRecord);
      if (leftKeys.length !== Object.keys(rightRecord).length) return false;
      return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
        && Object.is(leftRecord[key], rightRecord[key]));
    },
  };
  const modules = {
    ClientModuleSystem,
    parseBootManifest: (value: unknown) => value,
  };
  const commands = {
    CommandDirectory: ClientCommandDirectory,
    CommandUiRuntime: DeepSeekCommandUiService,
    PopupSelectController: ClientPopupSelectController,
    filterOptions: filterCommandOptions,
    apply: (ctx: Context) => new DeepSeekCommandUiService(ctx),
    inject: [],
  };
  const locale = {
    FALLBACK_LOCALE: "en",
    COMMON_NS: "common",
    apply: (ctx: Context) => new DeepSeekLocaleService(ctx),
    LocaleService: DeepSeekLocaleService,
    inject: [],
  };
  const commandTypes = {
    CommandId: (value: string) => value,
  };
  const fileReference = {
    activeAtToken: (line: string, cursorCol: number) => {
      const beforeCursor = line.slice(0, cursorCol);
      const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
      if (quoted?.[1] !== undefined && quoted[2] !== undefined) return { prefix: quoted[1], query: quoted[2], quoted: true };
      const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
      return plain?.[1] && plain[2] !== undefined ? { prefix: plain[1], query: plain[2], quoted: false } : undefined;
    },
    formatFileMention: (candidate: { path: string; kind: "file" | "directory" }, preserveQuote: boolean) => {
      const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;
      const quoted = preserveQuote || /\s/u.test(path);
      if (!quoted) return `@${path}`;
      return candidate.kind === "directory" ? `@"${path}` : `@"${path}"`;
    },
  };
  const sessionReference = {
    SESSION_REFERENCE_SCHEME: "dsh-session:",
    formatSessionReferenceMention: (reference: { sessionId: string; label?: string }) => {
      const payload = typeof btoa === "function" ? btoa(JSON.stringify(reference.sessionId)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : reference.sessionId;
      return `@[${reference.label ?? reference.sessionId}](dsh-session:${payload})`;
    },
  };
  const goalClient = featureModule(react, { slot: "conversation.input.dock", id: "goal", name: "GoalDock", locale: "goal", exports: { GoalBar: clientView("GoalBar", react), GoalDock: clientView("GoalDock", react) } });
  const skillClient = featureModule(react, { slot: "tool.call.toolview", id: "skill", name: "SkillRow", locale: "skill", exports: { SkillRow: clientView("SkillRow", react), skill: remoteClient as unknown } });
  const jobsClient = featureModule(react, { slot: "conversation.session.header.actions", id: "job-list", name: "JobListAction", locale: "job", exports: { JobListAction: clientView("JobListAction", react) } });
  const workflowClient = featureModule(react, { slot: "conversation.chat.node", id: "workflow-run", name: "WorkflowRunPanel", locale: "workflowRun", exports: { WorkflowRunPanel: clientView("WorkflowRunPanel", react), workflowRunDefinition: { kind: "workflow-run" } } });
  const attachmentClient = featureModuleSet(react, { name: "openbuddy-ui-attachment", inject: ["slots"], entries: [
    { slot: "conversation.input.attachments", id: "attachments", view: "ComposerAttachments" },
    { slot: "conversation.message.images", id: "message-images", view: "MessageImages" },
  ] });
  const deliverablesClient = featureModule(react, { slot: "conversation.chat.turnTail", id: "produced-files", name: "ProducedFiles", locale: "deliverables", exports: { ProducedFiles: clientView("ProducedFiles", react) } });
  const inputTriggerClient = featureModule(react, { slot: "conversation.input.overlay", id: "slash-menu", name: "InputTriggerMenu", locale: "slash.menu", exports: { InputTriggerService: class InputTriggerService {} } });
  const messageFeedbackClient = featureModule(react, { slot: "conversation.chat.assistant-actions", id: "message-feedback", name: "MessageFeedback", locale: "messageFeedback" });
  const subagentClient = featureModuleSet(react, { name: "openbuddy-ui-subagent", inject: ["slots", "sessions"], entries: [
    { slot: "conversation.chat.node", id: "subagent", view: "SubagentNode", locale: "subagent" },
    { slot: "conversation.session.header.actions", id: "subagent-actions", view: "SubagentActions", locale: "subagent" },
  ] });
  const userQuestionsClient = featureModule(react, { slot: "conversation.input.overlay", id: "user-questions", name: "UserQuestions", locale: "userQuestions" });
  const trajectoryClient = featureModule(react, { slot: "conversation.chat.node", id: "trajectory", name: "Trajectory", locale: "trajectory" });
  const settingsPluginsClient = featureModuleSet(react, { name: "openbuddy-ui-settings-plugins", inject: ["slots", "locale", "connection", "remote", "settingsScope"], entries: [
    { slot: "settings.section", id: "plugins", view: "PluginsSettingsSection", locale: "settings.plugins" },
    { slot: "settings.plugins.tab", id: "configurable", view: "ConfigurablePluginsTab", locale: "settings.plugins" },
    { slot: "settings.plugin.item", id: "openbuddy-plugin-cards", view: "PluginCard", locale: "settings.plugins" },
  ] });
  const settingsPluginInventoryClient = featureModule(react, { slot: "settings.plugins.tab", id: "inventory", name: "PluginInventoryTab", locale: "settings.pluginInventory" });
  const permissionPresetsClient = featureModule(react, { slot: "settings.general.item", id: "permission", name: "PermissionPresetRow", locale: "settings.permission", exports: { PermissionPresetRow: clientView("PermissionPresetRow", react) } });
  const directoryPickerNativeClient = featureModuleSet(react, { name: "openbuddy-ui-directory-picker-native", inject: ["slots", "workspaces"], entries: [
    { slot: "conversation.hero.workspace.directoryFlow", id: "native", view: "NativeDirectoryFlow", priority: 0 },
    { slot: "sidebar.workspaces.directoryFlow", id: "native", view: "NativeDirectoryFlow", priority: 0 },
  ] });
  const directoryPickerBrowseClient = featureModuleSet(react, { name: "openbuddy-ui-directory-picker-browse", inject: ["slots", "workspaces", "locale"], entries: [
    { slot: "conversation.hero.workspace.directoryFlow", id: "browse", view: "BrowseDirectoryFlow", priority: 1 },
    { slot: "sidebar.workspaces.directoryFlow", id: "browse", view: "BrowseDirectoryFlow", priority: 1 },
  ] });
  const layoutClient = {
    name: "openbuddy-ui-layout",
    inject: ["slots", "theme"],
    LayoutController: DeepSeekLayoutController,
    ILayout: DeepSeekLayoutController,
    AppFrame: clientView("AppFrame", react),
    apply: (ctx: Context) => {
      const layout = new DeepSeekLayoutController(ctx);
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const dispose = slots.register({
        name: "root",
        children: {
          sidebar: { kind: "single", scope: "root" },
          conversation: { kind: "single", scope: "session-maybe" },
          details: { kind: "single", scope: "session" },
          "shell.overlay": { kind: "list", scope: "root" },
        },
      }, clientView("AppFrame", react));
      return () => {
        layout.closeDetails();
        dispose();
      };
    },
  };
  const themeClient = {
    name: "openbuddy-ui-theme",
    ThemeRuntime: DeepSeekThemeService,
    ThemeService: DeepSeekThemeService,
    apply: (ctx: Context) => new DeepSeekThemeService(ctx),
  };
  const rendererClient = {
    name: "openbuddy-ui-renderer",
    inject: ["slots"],
    UiRendererService: DeepSeekUiRendererService,
    apply: (ctx: Context) => new DeepSeekUiRendererService(ctx, react),
  };
  const conversationClient = {
    name: "openbuddy-ui-conversation",
    inject: ["slots", "layout"],
    ConversationController: class ConversationController {},
    ConversationRoot: clientView("ConversationRoot", react),
    ConversationSession: clientView("ConversationSession", react),
    InputBar: clientView("InputBar", react),
    ChatView: clientView("ChatView", react),
    DetailsPanel: clientView("DetailsPanel", react),
    apply: (ctx: Context) => {
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const layout = ctx.get("layout") as DeepSeekLayoutController;
      const registrations = [
        slots.register({
          name: "conversation",
          children: {
            "conversation.session": { kind: "single", scope: "session" },
            "conversation.session.header": { kind: "single", scope: "session" },
            "conversation.composer": { kind: "chain", scope: "session" },
            "conversation.composer.bar": { kind: "single", scope: "session-maybe" },
            "conversation.input.overlay": { kind: "list", scope: "session" },
            "conversation.input.dock": { kind: "list", scope: "session" },
            "conversation.composer.dock": { kind: "list", scope: "session" },
            "conversation.input.left": { kind: "list", scope: "session" },
            "conversation.input.right": { kind: "list", scope: "session" },
            "conversation.hero.workspace": { kind: "single", scope: "root" },
            "conversation.hero.brand.mark": { kind: "single", scope: "root" },
          },
        }, clientView("ConversationRoot", react)),
        slots.register({
          name: "conversation.session",
          children: { "conversation.view": { kind: "list", scope: "session" } },
        }, clientView("ConversationSession", react)),
        slots.register({
          name: "conversation.composer.bar",
          children: {
            "conversation.input.attachments": { kind: "single", scope: "session-maybe" },
            "conversation.input.plan": { kind: "single", scope: "session" },
            "conversation.input.model": { kind: "single", scope: "session" },
          },
        }, clientView("InputBar", react)),
        slots.register({ name: "conversation.view", id: "chat" }, clientView("ChatView", react)),
        slots.register({ name: "details" }, clientView("DetailsPanel", react)),
      ];
      return () => {
        layout?.closeDetails?.();
        for (const dispose of registrations.reverse()) dispose();
      };
    },
  };
  const sidebarClient = {
    name: "openbuddy-ui-sidebar",
    inject: ["slots", "layout"],
    SidebarRoot: clientView("SidebarRoot", react),
    apply: (ctx: Context) => {
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const layout = ctx.get("layout") as DeepSeekLayoutController;
      const dispose = slots.register({
        name: "sidebar",
        children: {
          "sidebar.brand.mark": { kind: "single", scope: "root" },
          "sidebar.brand.name": { kind: "single", scope: "root" },
          "sidebar.workspaces": { kind: "single", scope: "root" },
          "sidebar.settings": { kind: "single", scope: "root" },
          "sidebar.footer.action": { kind: "list", scope: "root" },
        },
        inject: { toggleSidebar: () => layout.toggleSidebar() },
      }, clientView("SidebarRoot", react));
      return () => dispose();
    },
  };
  const workspaceClient = {
    name: "openbuddy-ui-workspace",
    inject: ["slots", "connection", "sessions", "workspaces"],
    WorkspaceBrowser: clientView("WorkspaceBrowser", react),
    WorkspacePicker: clientView("WorkspacePicker", react),
    WorkspaceService: DeepSeekWorkspaceService,
    apply: (ctx: Context) => {
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const service = (ctx.get("workspaces") as DeepSeekWorkspaceService | undefined) ?? new DeepSeekWorkspaceService(ctx);
      const registrations = [
        slots.register({
          name: "sidebar.workspaces",
          kind: "single",
          scope: "root",
          id: "deepseek-workspace-browser",
          order: 100,
          label: "工作空间",
          children: { "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" } },
          inject: () => ({ workspaces: service, startSession: service.startSession, open: service.open, searchSessions: service.search }),
        }, clientView("WorkspaceBrowser", react)),
        slots.register({
          name: "conversation.hero.workspace",
          kind: "single",
          scope: "root",
          id: "deepseek-workspace-picker",
          order: 100,
          label: "工作空间选择器",
          children: { "conversation.hero.workspace.directoryFlow": { kind: "single", scope: "root" } },
          inject: () => ({ workspaces: service, createWorkspace: service.create }),
        }, clientView("WorkspacePicker", react)),
      ];
      return () => registrations.reverse().forEach((dispose) => dispose());
    },
  };
  const brandOfficialClient = {
    name: "openbuddy-ui-brand-official",
    inject: ["slots"],
    OfficialBrandMark: clientView("OfficialBrandMark", react),
    OfficialBrandName: clientView("OfficialBrandName", react),
    apply: (ctx: Context) => {
      if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DSH_CLIENT_BUILD_PROFILE !== "official") return;
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const registrations = [
        slots.register({ name: "sidebar.brand.mark", id: "official", order: 100, label: "DeepSeek" }, clientView("OfficialBrandMark", react)),
        slots.register({ name: "sidebar.brand.name", id: "official", order: 100, label: "DeepSeek" }, clientView("OfficialBrandName", react)),
        slots.register({ name: "conversation.hero.brand.mark", id: "official", order: 100, label: "DeepSeek" }, clientView("OfficialBrandMark", react)),
      ];
      return () => registrations.reverse().forEach((dispose) => dispose());
    },
  };
  const modelSelectionClient = {
    name: "openbuddy-ui-model-selection",
    inject: ["commandUi", "connection"],
    ModelDirectoryResolver: DeepSeekModelSelectionService,
    ModelSelect: clientView("ModelSelect", react),
    apply: (ctx: Context) => {
      const modelSelection = new DeepSeekModelSelectionService(ctx);
      const commandUi = ctx.get("commandUi") as DeepSeekCommandUiService;
      const dispose = commandUi.register({
        name: "model",
        description: "Select the Pi model",
        ui: {
          kind: "popupSelect",
          options: () => modelSelection.list(),
          onSelect: (option: { id?: string; sessionId?: string }, session?: { sessionId?: string }) => {
            const sessionId = option.sessionId ?? session?.sessionId;
            if (!sessionId || !option.id) throw new Error("DeepSeek model selection requires sessionId and modelId");
            return modelSelection.select(sessionId, option.id);
          },
        },
      });
      return () => dispose();
    },
  };
  const settingsClient = {
    name: "openbuddy-ui-settings",
    inject: ["connection", "remote", "slots"],
    apply: (ctx: Context) => {
      const settings = new DeepSeekSettingsScope(ctx, "default");
      ctx.provide("settingsScope", settings);
      const dispose = (ctx.get("slots") as DeepSeekSlotRegistry).register({
        name: "settings",
        children: {
          "settings.section": { kind: "list", scope: "root" },
          "settings.onboarding": { kind: "list", scope: "root" },
          "settings.general.item": { kind: "list", scope: "root" },
        },
      }, clientView("SettingsRoot", react));
      return () => dispose();
    },
    SettingsScope: DeepSeekSettingsScope,
    SettingsSchemaService: class SettingsSchemaService {},
  };
  const settingsGeneralClient = {
    name: "openbuddy-ui-settings-general",
    inject: ["slots"],
    GeneralSection: clientView("GeneralSection", react),
    apply: (ctx: Context) => {
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const disposers = [
        slots.register({ name: "settings.section", id: "general", order: 0, label: "General" }, clientView("GeneralSection", react)),
        slots.register({ name: "settings.general.item", id: "openbuddy-runtime", order: 0, label: "OpenBuddy Runtime" }, clientView("SettingsRuntimeItem", react)),
      ];
      return () => disposers.reverse().forEach((dispose) => dispose());
    },
  };
  const settingsModelsClient = {
    name: "openbuddy-ui-settings-models",
    inject: ["slots", "connection"],
    ModelsSection: clientView("ModelsSection", react),
    SettingsModelsService: DeepSeekSettingsModelsService,
    apply: (ctx: Context) => {
      const service = new DeepSeekSettingsModelsService(ctx);
      ctx.set("settingsModels", service);
      const slots = ctx.get("slots") as DeepSeekSlotRegistry;
      const dispose = slots.register({
        name: "settings.section",
        id: "models",
        order: 10,
        label: "Models",
        inject: { load: () => service.list() },
      }, clientView("ModelsSection", react));
      return () => dispose();
    },
  };
  const clientFeatures: Record<string, unknown> = {
    "@deepseek-ai/dsh-client-ui-goal/client": goalClient,
    "@deepseek-ai/dsh-client-ui-goal": goalClient,
    "@deepseek-ai/dsh-client-ui-skill/client": skillClient,
    "@deepseek-ai/dsh-client-ui-skill": skillClient,
    "@deepseek-ai/dsh-client-ui-jobs/client": jobsClient,
    "@deepseek-ai/dsh-client-ui-jobs": jobsClient,
    "@deepseek-ai/dsh-client-ui-workflow-run/client": workflowClient,
    "@deepseek-ai/dsh-client-ui-workflow-run": workflowClient,
    "@deepseek-ai/dsh-client-ui-agent-preset/client": featureModule(react, { slot: "settings.general.item", id: "agent-preset", name: "AgentPresetRow", locale: "settings.agentPreset" }),
    "@deepseek-ai/dsh-client-ui-agent-preset": featureModule(react, { slot: "settings.general.item", id: "agent-preset", name: "AgentPresetRow", locale: "settings.agentPreset" }),
    "@deepseek-ai/dsh-client-ui-attachment/client": attachmentClient,
    "@deepseek-ai/dsh-client-ui-attachment": attachmentClient,
    "@deepseek-ai/dsh-client-ui-deliverables/client": deliverablesClient,
    "@deepseek-ai/dsh-client-ui-deliverables": deliverablesClient,
    "@deepseek-ai/dsh-client-ui-input-trigger/client": inputTriggerClient,
    "@deepseek-ai/dsh-client-ui-input-trigger": inputTriggerClient,
    "@deepseek-ai/dsh-client-ui-message-feedback/client": messageFeedbackClient,
    "@deepseek-ai/dsh-client-ui-message-feedback": messageFeedbackClient,
    "@deepseek-ai/dsh-client-ui-subagent/client": subagentClient,
    "@deepseek-ai/dsh-client-ui-subagent": subagentClient,
    "@deepseek-ai/dsh-client-ui-user-questions/client": userQuestionsClient,
    "@deepseek-ai/dsh-client-ui-user-questions": userQuestionsClient,
    "@deepseek-ai/dsh-client-ui-trajectory/client": trajectoryClient,
    "@deepseek-ai/dsh-client-ui-trajectory": trajectoryClient,
    "@deepseek-ai/dsh-client-ui-settings-plugins/client": settingsPluginsClient,
    "@deepseek-ai/dsh-client-ui-settings-plugins": settingsPluginsClient,
    "@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client": settingsPluginInventoryClient,
    "@deepseek-ai/dsh-client-ui-settings-plugin-inventory": settingsPluginInventoryClient,
    "@deepseek-ai/dsh-client-ui-permission-presets/client": permissionPresetsClient,
    "@deepseek-ai/dsh-client-ui-permission-presets": permissionPresetsClient,
    "@deepseek-ai/dsh-client-ui-directory-picker-native/client": directoryPickerNativeClient,
    "@deepseek-ai/dsh-client-ui-directory-picker-native": directoryPickerNativeClient,
    "@deepseek-ai/dsh-client-ui-directory-picker-browse/client": directoryPickerBrowseClient,
    "@deepseek-ai/dsh-client-ui-directory-picker-browse": directoryPickerBrowseClient,
    "@deepseek-ai/dsh-client-ui-settings/client": settingsClient,
    "@deepseek-ai/dsh-client-ui-settings": settingsClient,
    "@deepseek-ai/dsh-client-ui-settings-general/client": settingsGeneralClient,
    "@deepseek-ai/dsh-client-ui-settings-general": settingsGeneralClient,
    "@deepseek-ai/dsh-client-ui-settings-models/client": settingsModelsClient,
    "@deepseek-ai/dsh-client-ui-settings-models": settingsModelsClient,
    "@deepseek-ai/dsh-client-ui-layout/client": layoutClient,
    "@deepseek-ai/dsh-client-ui-layout": layoutClient,
    "@deepseek-ai/dsh-client-ui-theme/client": themeClient,
    "@deepseek-ai/dsh-client-ui-theme": themeClient,
    "@deepseek-ai/dsh-client-ui-renderer/client": rendererClient,
    "@deepseek-ai/dsh-client-ui-renderer": rendererClient,
    "@deepseek-ai/dsh-client-ui-conversation/client": conversationClient,
    "@deepseek-ai/dsh-client-ui-conversation": conversationClient,
    "@deepseek-ai/dsh-client-ui-sidebar/client": sidebarClient,
    "@deepseek-ai/dsh-client-ui-sidebar": sidebarClient,
    "@deepseek-ai/dsh-client-ui-workspace/client": workspaceClient,
    "@deepseek-ai/dsh-client-ui-workspace": workspaceClient,
    "@deepseek-ai/dsh-client-ui-brand-official/client": brandOfficialClient,
    "@deepseek-ai/dsh-client-ui-brand-official": brandOfficialClient,
    "@deepseek-ai/dsh-client-ui-model-selection/client": modelSelectionClient,
    "@deepseek-ai/dsh-client-ui-model-selection": modelSelectionClient,
  };
  const connection = deepSeekConnectionClient;
  const gateway = deepSeekGatewayClient;
  const remotes = deepSeekRemotesClient;
  return {
    ...clientFeatures,
    "@deepseek-ai/dsh-client-ui-slots": {
      SlotCore: DeepSeekSlotCore,
      SlotRegistry: DeepSeekSlotRegistry,
      resolveSlotLabel: displayLabel,
      apply: (ctx: Context) => new DeepSeekSlotRegistry(ctx),
    },
    "@deepseek-ai/dsh-client-ui-slots/client": {
      SlotCore: DeepSeekSlotCore,
      SlotRegistry: DeepSeekSlotRegistry,
      resolveSlotLabel: displayLabel,
      apply: (ctx: Context) => new DeepSeekSlotRegistry(ctx),
    },
    "@deepseek-ai/dsh-client-ui-primitives": primitives,
    "@deepseek-ai/dsh-client-runtime/client": runtime,
    "@deepseek-ai/dsh-client-runtime": runtime,
    "@deepseek-ai/dsh-client-modules/client": modules,
    "@deepseek-ai/dsh-client-modules": modules,
    "@deepseek-ai/dsh-client-ui-commands/client": commands,
    "@deepseek-ai/dsh-client-ui-commands": commands,
    "@deepseek-ai/dsh-client-ui-conversation/client": conversationClient,
    "@deepseek-ai/dsh-client-ui-conversation": conversationClient,
    "@deepseek-ai/dsh-client-locale/client": locale,
    "@deepseek-ai/dsh-client-locale": locale,
    "@deepseek-ai/dsh-client-connection/client": connection,
    "@deepseek-ai/dsh-client-connection": connection,
    "@deepseek-ai/dsh-commands/brand": commandTypes,
    "@deepseek-ai/dsh-commands/types": commandTypes,
    "@deepseek-ai/dsh-file-reference/grammar": fileReference,
    "@deepseek-ai/dsh-file-reference/types": fileReference,
    "@deepseek-ai/dsh-session-reference/types": sessionReference,
    "@deepseek-ai/dsh-session/types": deepSeekSessionTypes,
    "@deepseek-ai/dsh-session/surface": deepSeekSessionSurface,
    "@deepseek-ai/dsh-session-query/types": deepSeekSessionQueryTypes,
    "@deepseek-ai/dsh-workspace/types": deepSeekWorkspaceTypes,
    "@deepseek-ai/dsh-workspace/client": deepSeekWorkspaceTypes,
    "@deepseek-ai/dsh-workspace/remote": deepSeekWorkspaceTypes,
    "@deepseek-ai/dsh-goal/client": {},
    "@deepseek-ai/dsh-message-feedback/types": {},
    "@deepseek-ai/dsh-host-plugin-inventory/types": {},
    "@deepseek-ai/dsh-api-gateway/types": {},
    "@deepseek-ai/dsh-api-gateway/client": gateway,
    "@deepseek-ai/dsh-api-gateway": gateway,
    "@deepseek-ai/dsh-api-remotes/types": {},
    "@deepseek-ai/dsh-api-remotes/client": remotes,
    "@deepseek-ai/dsh-api-remotes": remotes,
  };
}
