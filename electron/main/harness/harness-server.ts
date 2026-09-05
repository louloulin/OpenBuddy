/**
 * OpenBuddy Harness Server — multi-tenant transport layer for the pi-based
 * open-source WorkBuddy.
 *
 * This file is intentionally bespoke and ~80% of it has no upstream
 * equivalent in the pi SDK. The pi runtime only exposes an in-process
 * `createAgentSession` helper and `SessionManager` for local disk; the
 * WorkBuddy harness adds:
 *
 *   - HTTP/WebSocket transport with CORS + bearer auth and SSE fallback
 *   - Persistent RPC store with HMAC-signed resume tokens and replay
 *     idempotency (`@openbuddy/plugin-host` + `harness-rpc-store.ts`)
 *   - Cursor-gap detection + recovery-claim handshake for partial
 *     reconnects (`harness-resume-token.ts` + `harness-recovery-token.ts`)
 *   - Multi-tenant fan-out across workspaces with workspace-scoped Buddy
 *     relay and remote-event channels
 *     (`@openbuddy/collaboration-network` + `RemoteRelayServer`)
 *   - Lifecycle event audit channel (`@openbuddy/core-session/lifecycle`)
 *
 * The only direct pi SDK reuse happens through `SessionManager.listAll`
 * and `SessionManager.open` calls in `electron/main/agent/agent-host.ts`,
 * not here. The harness stays coupled to its own RPC store because the
 * upstream API is process-local — the open-source build does not strip
 * this layer when migrating toward `pi.createAgentSession`.
 *
 * When the harness does call into the pi SDK runtime (via the injected
 * `HarnessServerAgent` dependency), it only consumes event streams and
 * UI-request resolvers — never direct session construction.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import { isBenignSocketClose } from "./harness-server-benign-error";
import { createRpcId, isReplayableRpcMethod, parseRpcMessage, rpcError, rpcRequestFingerprint, rpcValue, RpcId, type ClientRequest, type ClientResponse, type RpcMessage } from "@openbuddy/plugin-host";
import { HarnessRpcRevisionConflict, HarnessRpcStore, harnessRpcIdentity, type HarnessRpcState, type PersistedHarnessRpcEntry, type PersistedHarnessRpcIntent } from "./harness-rpc-store";
import type { DeepSeekConnectionDispatchContext } from "../deepseek/deepseek-runtime";
import { issueHarnessResumeToken, verifyHarnessResumeToken, type HarnessResumeCursor } from "./harness-resume-token";
import { hashHarnessRecoveryClaim, issueHarnessRecoveryClaim, verifyHarnessRecoveryClaim, verifyHarnessRecoveryClaimWithKeys } from "./harness-recovery-token";
import { attachRemoteRelayWebSocket, RemoteRelayServer } from "@openbuddy/collaboration-network";
import { lifecycleEvent, hashLifecycleSecret, type OpenBuddyLifecycleEvent } from "@openbuddy/core-session/lifecycle";

export type HarnessServerAgent = {
  onEvent: (handler: (event: unknown) => void) => () => void;
  onPluginEvent: (handler: (event: { type: string; payload: unknown; sequence?: number; sessionSequence?: number }) => void) => () => void;
  pluginEvents: (query?: { sinceSequence?: number; limit?: number }) => Array<{ sequence: number; sessionSequence?: number; payload: unknown; type: string }>;
  sessionBaselines?: () => Array<{ sessionId: string; lastSeq: number }> | Promise<Array<{ sessionId: string; lastSeq: number }>>;
  sessionProjectionBaseline?: (sessionId: string) => { asOfSeq: number; values: Readonly<Record<string, unknown>> } | Promise<{ asOfSeq: number; values: Readonly<Record<string, unknown>> }>;
  listSubagentChildren?: (sessionId: string) => unknown[] | Promise<unknown[]>;
  listSessionJobs?: (sessionId: string) => unknown[];
  resolveUiRequest: (requestId: string, value: string | boolean | { decision: "allow_always" } | { answers: Record<string, string | string[]>; annotations: Record<string, { preview?: string; notes?: string }> } | undefined) => boolean;
};

export type HarnessSessionCursor = Record<string, number>;

type SessionFrame = {
  type: "session/event";
  sessionId: string;
  event: unknown;
  sequence?: number;
  /** Process-global event sequence used by renderer replay de-duplication. */
  eventSequence?: number;
};
type HostFrame =
  | { type: "host/session-added"; sessionId: string; blank: boolean; cwd?: string }
  | { type: "host/session-removed"; sessionId: string }
  | { type: "host/session-status"; sessionId: string; running: boolean }
  | { type: "host/agent-error"; sessionId: string; message: string }
  | { type: "host/workspace-changed"; workspace: unknown }
  | { type: "host/workspace-removed"; workspaceId: string }
  | { type: "host/workspace-order-changed"; workspaceIds: string[] }
  | { type: "host/extensions-resolved"; builtins: string[]; paths: string[]; availableBuiltins: string[]; commands: string[] }
  | { type: "host/plugin-event"; event: string; payload: unknown }
  | { type: "host/remote-event"; event: string; args: unknown[] };
type MuxFrame =
  | SessionFrame
  | { type: "session/projection"; sessionId: string; key: string; value: unknown; seq: number; snapshot?: true }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number; snapshot?: true }
  | {
      type: "session/cursor-gap";
      sessionId: string;
      requested: number;
      lastSeq: number;
      reason?: "ahead" | "retention";
      earliestSeq?: number;
    }
  | { type: "approval/requested"; sessionId: string; approvalId: string; toolName: string; reason?: string }
  | { type: "approval/resolved"; sessionId: string; approvalId: string; outcome: "approved" | "denied" | "cancelled" }
  | { type: "question/requested"; sessionId: string; questionRpcId: string; questions: unknown[] }
  | { type: "question/resolved"; sessionId: string; questionRpcId: string; outcome: "answered" | "cancelled" }
  | { type: "session/jobs"; sessionId: string; jobs: readonly unknown[] };
type ResumeFrame = { type: "connection/resume"; token: string; cursor: HarnessResumeCursor };
type Frame = MuxFrame | HostFrame | ResumeFrame;
type DownlinkFrame = { frame: Frame; rpcId?: string; sequence?: number };
type Downlink = { socket: WebSocket; kind: "mux" | "host"; sinceSequence?: number; sinceSessions?: HarnessSessionCursor; replaying: boolean; pending: DownlinkFrame[]; resumeToken?: string; clientIdentity?: string };
type SseDownlink = { response: ServerResponse; kind: "mux" | "host"; sinceSequence?: number; sinceSessions?: HarnessSessionCursor; replaying: boolean; pending: DownlinkFrame[]; closed: boolean; resumeToken?: string; clientIdentity?: string };
type CachedRpc = { fingerprint: string; expiresAt: number; result: ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>; pending?: Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> };

const RPC_CACHE_TTL_MS = 60_000;
const RPC_CACHE_LIMIT = 512;
/**
 * Maximum number of per-session cursors embedded in a signed resume token.
 * The renderer's persisted `harness:session-cursors` map covers the rest, so
 * older sessions are evicted from the cursor rather than exploding the token
 * length as the workspace grows.
 */
const RESUME_TOKEN_SESSION_LIMIT = 64;

export type HarnessServerConfig = {
  host?: string;
  port?: number;
  authToken?: string;
  resumeTokenSecret?: string;
  resumeTokenIdentity?: string;
  rpcCachePath?: string;
  rpcCacheIdentity?: string;
	/** Explicit side-effect methods; unspecified methods default to non-replayable. */
  sideEffectRpcMethods?: readonly string[];
	/** Projects durable RPC lifecycle transitions into the canonical Pi JSONL session. */
	lifecycleJournal?: (sessionId: string, event: OpenBuddyLifecycleEvent) => Promise<void>;
	recoveryClaimSecret?: string;
	recoveryClaimKeyId?: string;
	recoveryClaimVerificationKeys?: readonly { id: string; secret: string; expiresAt?: number }[];
	recoveryClaimIdentity?: string;
  logger?: (message: string, error?: unknown) => void;
  dispatchRpc: (request: ClientRequest, context?: DeepSeekConnectionDispatchContext) => Promise<unknown>;
  agent: HarnessServerAgent;
  /** Optional, explicitly enabled Buddy carrier; Harness auth still gates the upgrade. */
  buddyRelay?: RemoteRelayServer;
};

export type HarnessServerAddress = {
  host: string;
  port: number;
  baseUrl: string;
  token?: string;
};

let activeAddress: HarnessServerAddress | undefined;
let activeServer: HarnessServer | undefined;

export function getHarnessServerAddress(): HarnessServerAddress | undefined {
  return activeAddress;
}

/** Register the currently running HarnessServer so IPC handlers can dispatch recovery RPC. */
export function setActiveHarnessServer(server: HarnessServer | undefined): void {
  activeServer = server;
  if (server) activeAddress = server.address();
  else activeAddress = undefined;
}

/** Return the currently registered HarnessServer or undefined if it has been closed. */
export function getActiveHarnessServer(): HarnessServer | undefined {
  return activeServer;
}

/**
 * CORS headers applied to every response served by the harness HTTP server.
 *
 * The renderer runs at a different origin than the harness server in both
 * dev (`http://localhost:1420`) and prod (`file://`). Because the harness
 * server only listens on loopback AND authenticates every request with a
 * bearer token, allowing any origin is safe — the security boundary is the
 * token, not the browser CORS layer.
 *
 * Keep these headers in sync with what the OPTIONS preflight advertises in
 * `handleHttp()` so the browser will accept the actual request after a
 * successful preflight.
 */
const CORS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, X-Openbuddy-Harness-Token, X-Openbuddy-Client",
  "access-control-max-age": "600",
});

function applyCorsHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  applyCorsHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function requestAuthority(req: IncomingMessage): DeepSeekConnectionDispatchContext {
	const address = req.socket.remoteAddress;
	const authority = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" ? "loopback" : "trusted-host";
	const header = req.headers["x-openbuddy-client"];
	const caller = typeof header === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : authority;
	return { authority, caller };
}

function frameEnvelope(frame: Frame, rpcId = createRpcId("event"), sequence?: number): { type: "server-request"; rpcId: string; method: string; payload: Frame; sequence?: number } {
  const payload = typeof sequence === "number" && !("sequence" in frame)
    ? { ...frame, sequence } as Frame
    : frame;
  return { type: "server-request", rpcId, method: frame.type, payload, ...(typeof sequence === "number" ? { sequence } : {}) };
}

function sessionIdOf(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string"
    ? (value as { sessionId: string }).sessionId : undefined;
}

function sessionSequenceOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const sequence = (value as { sessionSequence?: unknown }).sessionSequence;
  return typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function parseSince(value: string | null): { sinceSequence?: number; sinceSessions?: HarnessSessionCursor } {
  if (!value) return {};
  const legacy = Number(value);
  if (Number.isSafeInteger(legacy) && legacy >= 0) return { sinceSequence: legacy };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const sessions = Object.fromEntries(Object.entries(parsed)
      .filter(([sessionId, sequence]) => Boolean(sessionId) && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= -1)
      .map(([sessionId, sequence]) => [sessionId, sequence as number]));
    return Object.keys(sessions).length > 0 ? { sinceSessions: sessions } : {};
  } catch {
    return {};
  }
}

function resumeSince(
  token: string | null,
  secret: string | undefined,
  identity: string,
  clientIdentity?: string,
): { sinceSequence?: number; sinceSessions?: HarnessSessionCursor } {
  if (!token || !secret) return {};
  const cursor = verifyHarnessResumeToken(token, secret, identity, Date.now(), clientIdentity);
  if (!cursor) return {};
  return {
    ...(cursor.sequence === undefined ? {} : { sinceSequence: cursor.sequence }),
    ...(cursor.sessions === undefined ? {} : { sinceSessions: cursor.sessions }),
  };
}

function recordSessionId(record: { payload: unknown; sessionId?: string }): string | undefined {
  return sessionIdOf(record.payload) ?? record.sessionId;
}

function recordSessionSequence(record: { payload: unknown; sequence: number; sessionSequence?: number }): number {
  return record.sessionSequence ?? sessionSequenceOf(record.payload) ?? record.sequence;
}

function recordAfterCursor(record: { payload: unknown; sequence: number; sessionSequence?: number }, downlink: Pick<Downlink, "sinceSequence" | "sinceSessions">, kind: "mux" | "host"): boolean {
  if (kind === "mux" && downlink.sinceSessions) {
    const sessionId = recordSessionId(record);
    return Boolean(sessionId) && recordSessionSequence(record) > (downlink.sinceSessions[sessionId!] ?? -1);
  }
  return downlink.sinceSequence === undefined || record.sequence > downlink.sinceSequence;
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pluginFrames(event: { type: string; payload: unknown; sequence?: number; sessionSequence?: number }, agent?: HarnessServerAgent): { mux?: MuxFrame; host?: HostFrame; rpcId?: string } {
  const payload = objectPayload(event.payload);
  const sessionId = sessionIdOf(event.payload);
  const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined;
  if (event.type === "session/projection" && sessionId && typeof payload.key === "string") {
    return { mux: { type: "session/projection", sessionId, key: payload.key, value: payload.value, seq: event.sessionSequence ?? event.sequence ?? 0 } };
  }
  if (event.type === "session/permission" && sessionId && requestId) {
    return { mux: { type: "approval/requested", sessionId, approvalId: requestId, toolName: typeof payload.toolName === "string" ? payload.toolName : "unknown", ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}) }, rpcId: requestId };
  }
  if (event.type === "session/question" && sessionId && requestId) {
    return { mux: { type: "question/requested", sessionId, questionRpcId: requestId, questions: Array.isArray(payload.questions) ? payload.questions : [] }, rpcId: requestId };
  }
  if (event.type === "session/permission-resolved" && sessionId && requestId) {
    const outcome = payload.approved === true ? "approved" : payload.answered === false ? "cancelled" : "denied";
    return { mux: { type: "approval/resolved", sessionId, approvalId: requestId, outcome }, rpcId: requestId };
  }
  if (event.type === "session/question-resolved" && sessionId && requestId) {
    return { mux: { type: "question/resolved", sessionId, questionRpcId: requestId, outcome: payload.answered === false ? "cancelled" : "answered" }, rpcId: requestId };
  }
  if ((event.type === "session/jobs" || event.type === "subagent/start" || event.type === "subagent/end" || event.type === "subagent/settled" || event.type === "subagent/prompt") && sessionId) {
    if (!agent?.listSessionJobs) return {};
    const jobs = agent.listSessionJobs?.(sessionId) ?? [];
    if (!agent.listSessionJobs) return {};
    return {
      mux: {
        type: "session/jobs",
        sessionId,
        jobs,
      },
    };
  }
  if (event.type === "session/created" && sessionId) return { host: { type: "host/session-added", sessionId, blank: false, ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}) } };
  if ((event.type === "session/removed" || event.type === "session/deleted") && sessionId) return { host: { type: "host/session-removed", sessionId } };
  if (event.type === "session/status" && sessionId && typeof payload.running === "boolean") return { host: { type: "host/session-status", sessionId, running: payload.running } };
  if (event.type === "agent/error" && sessionId) return { host: { type: "host/agent-error", sessionId, message: typeof payload.error === "string" ? payload.error : JSON.stringify(event.payload) } };
  if (event.type === "workspace/changed" && payload.workspace !== undefined) return { host: { type: "host/workspace-changed", workspace: payload.workspace } };
  if (event.type === "workspace/removed" && typeof payload.workspaceId === "string") return { host: { type: "host/workspace-removed", workspaceId: payload.workspaceId } };
  if (event.type === "workspace/order-changed" && Array.isArray(payload.workspaceIds)) return { host: { type: "host/workspace-order-changed", workspaceIds: payload.workspaceIds.filter((item): item is string => typeof item === "string") } };
  if (event.type === "pi/extensions-resolved") {
    return {
      host: {
        type: "host/extensions-resolved",
        builtins: Array.isArray(payload.builtins) ? payload.builtins.filter((item): item is string => typeof item === "string") : [],
        paths: Array.isArray(payload.paths) ? payload.paths.filter((item): item is string => typeof item === "string") : [],
        availableBuiltins: Array.isArray(payload.availableBuiltins) ? payload.availableBuiltins.filter((item): item is string => typeof item === "string") : [],
        commands: Array.isArray(payload.commands) ? payload.commands.filter((item): item is string => typeof item === "string") : [],
      },
    };
  }
  if (event.type.startsWith("plugin/") || event.type === "profile/reloaded" || event.type === "profile/reload-failed" || event.type.startsWith("pi/extension")) {
    return { host: { type: "host/plugin-event", event: event.type, payload: event.payload } };
  }
  return { host: { type: "host/remote-event", event: event.type, args: Array.isArray(payload.args) ? payload.args : [event.payload] } };
}

function sessionFrame(event: unknown, sequence?: number, globalSequence?: number): SessionFrame | undefined {
  const payload = objectPayload(event);
  const sessionId = sessionIdOf(event);
  if (!sessionId) return undefined;
  const sessionSequence = sessionSequenceOf(event) ?? (typeof sequence === "number" ? sequence : payload.sequence);
  return {
    type: "session/event",
    sessionId,
    event,
    ...(typeof sessionSequence === "number" ? { sequence: sessionSequence } : {}),
    ...(typeof globalSequence === "number" ? { eventSequence: globalSequence } : {}),
  };
}

function sessionFrameForRecord(record: { payload: unknown; sequence: number; sessionSequence?: number }): SessionFrame | undefined {
  return sessionFrame(record.payload, record.sessionSequence ?? record.sequence, record.sequence);
}

/**
 * Returns the per-session cursor-gap frames for a replay. A gap exists when the
 * client supplied `sinceSessions[sessionId] = requested` and the server's
 * authoritative baseline is `lastSeq < requested`. The gap frame tells the
 * renderer to reset its in-memory cursor to `lastSeq` so the next reconnect
 * resumes from the right boundary instead of skipping events.
 */
function cursorGapFrames(
  baselines: ReadonlyArray<{ sessionId: string; lastSeq: number }>,
  sinceSessions: HarnessSessionCursor | undefined,
  records: ReadonlyArray<{ payload: unknown; sequence: number; sessionSequence?: number; sessionId?: string }>,
): Array<{ sessionId: string; requested: number; lastSeq: number }> {
  if (!sinceSessions) return [];
  const lastSeqById = new Map(baselines.map((entry) => [entry.sessionId, entry.lastSeq]));
  const firstSeqById = new Map<string, number>();
  for (const record of records) {
    const sessionId = recordSessionId(record);
    if (!sessionId) continue;
    const sequence = recordSessionSequence(record);
    firstSeqById.set(sessionId, Math.min(firstSeqById.get(sessionId) ?? sequence, sequence));
  }
  const gaps: Array<{ sessionId: string; requested: number; lastSeq: number }> = [];
  for (const [sessionId, requested] of Object.entries(sinceSessions)) {
    if (!Number.isSafeInteger(requested) || requested < -1) continue;
    const lastSeq = lastSeqById.get(sessionId);
    if (lastSeq === undefined) continue;
    const earliestSeq = firstSeqById.get(sessionId);
    if (requested > lastSeq || (earliestSeq !== undefined && requested < earliestSeq - 1)) {
      gaps.push({ sessionId, requested, lastSeq });
    }
  }
  return gaps;
}

function cursorGapFrame(
  gap: { sessionId: string; requested: number; lastSeq: number },
  records: ReadonlyArray<{ payload: unknown; sequence: number; sessionSequence?: number; sessionId?: string }>,
): MuxFrame {
  const earliestSeq = records
    .filter((record) => recordSessionId(record) === gap.sessionId)
    .map(recordSessionSequence)
    .reduce<number | undefined>((minimum, sequence) => Math.min(minimum ?? sequence, sequence), undefined);
  const retention = earliestSeq !== undefined && gap.requested < earliestSeq - 1;
  return {
    type: "session/cursor-gap",
    sessionId: gap.sessionId,
    requested: gap.requested,
    lastSeq: gap.lastSeq,
    ...(retention ? { reason: "retention" as const, earliestSeq } : { reason: "ahead" as const }),
  };
}

async function readJson(req: IncomingMessage, maxBytes = 16 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.byteLength;
    if (size > maxBytes) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export class HarnessServer {
  private readonly server: Server;
  private readonly websocketServer = new WebSocketServer({ noServer: true });
  private readonly downlinks = new Set<Downlink>();
  private readonly sseDownlinks = new Set<SseDownlink>();
  private readonly rpcCache = new Map<string, CachedRpc>();
	private readonly rpcIntents = new Map<string, PersistedHarnessRpcIntent>();
	private readonly rpcInFlight = new Map<string, Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>>>();
  private readonly rpcStore?: HarnessRpcStore;
  private readonly rpcCacheReady: Promise<void>;
  private rpcPersistQueue = Promise.resolve();
  private rpcPersistedRevision = 0;
  private readonly recoveryQueues = new Map<string, Promise<void>>();
  private readonly lifecycleRevisions = new Map<string, number>();
  private readonly disposers: Array<() => void> = [];
  private addressValue: HarnessServerAddress | undefined;

  constructor(private readonly config: HarnessServerConfig) {
    this.rpcStore = config.rpcCachePath
      ? new HarnessRpcStore(config.rpcCachePath, config.rpcCacheIdentity ?? harnessRpcIdentity(config.authToken))
      : undefined;
    this.rpcCacheReady = this.restoreRpcCache();
    this.server = createServer((req, res) => { void this.handleHttp(req, res); });
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.disposers.push(this.config.agent.onEvent((event) => {
      const globalSequence = (event as unknown as { sequence?: unknown }).sequence;
      const sessionSequence = (event as unknown as { sessionSequence?: unknown }).sessionSequence;
      const muxSequence = typeof sessionSequence === "number"
        ? sessionSequence
        : typeof globalSequence === "number" ? globalSequence : undefined;
      const frame = sessionFrame(
        event,
        typeof sessionSequence === "number" ? sessionSequence : undefined,
        typeof globalSequence === "number" ? globalSequence : undefined,
      );
      if (frame) this.broadcast("mux", frame, typeof muxSequence === "number" ? `event-${muxSequence}` : undefined, muxSequence);
    }));
    this.disposers.push(this.config.agent.onPluginEvent((event) => {
      const frames = pluginFrames(event, this.config.agent);
      const sequence = typeof event.sequence === "number" ? event.sequence : undefined;
      const muxSequence = typeof event.sessionSequence === "number" ? event.sessionSequence : sequence;
      if (frames.mux) this.broadcast("mux", frames.mux, frames.rpcId, muxSequence);
      if (frames.host) {
        // P1-17: reclaim lifecycleRevisions when a session is removed —
        // previously the Map grew without bound for the lifetime of the app.
        if (frames.host.type === "host/session-removed") this.releaseSessionLifecycle(frames.host.sessionId);
        this.broadcast("host", frames.host, frames.rpcId, sequence);
      }
    }));
  }

  async start(): Promise<HarnessServerAddress> {
    if (this.addressValue) return this.addressValue;
    await this.rpcCacheReady;
    const host = this.config.host ?? "127.0.0.1";
    const port = this.config.port ?? 0;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => { this.server.off("error", onError); resolve(); };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, host);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Harness server did not expose a TCP address");
    this.addressValue = { host, port: address.port, baseUrl: `http://${host}:${address.port}`, ...(this.config.authToken ? { token: this.config.authToken } : {}) };
    activeAddress = this.addressValue;
    return this.addressValue;
  }

  address(): HarnessServerAddress | undefined { return this.addressValue; }

  private connectionCursor(url: URL): { sinceSequence?: number; sinceSessions?: HarnessSessionCursor; resumeToken?: string; clientIdentity?: string } {
    const identity = this.config.resumeTokenIdentity ?? harnessRpcIdentity(this.config.authToken);
    const rawClientIdentity = url.searchParams.get("client") ?? undefined;
    const clientIdentity = rawClientIdentity && /^[A-Za-z0-9._:-]{1,128}$/.test(rawClientIdentity) ? rawClientIdentity : undefined;
    const resumeToken = url.searchParams.get("resume") ?? undefined;
    const resumed = resumeSince(resumeToken ?? null, this.config.resumeTokenSecret ?? this.config.authToken, identity, clientIdentity);
    if (resumed.sinceSequence !== undefined || resumed.sinceSessions !== undefined) return { ...resumed, ...(resumeToken ? { resumeToken } : {}), ...(clientIdentity ? { clientIdentity } : {}) };
    return { ...parseSince(url.searchParams.get("since")), ...(resumeToken ? { resumeToken } : {}), ...(clientIdentity ? { clientIdentity } : {}) };
  }

  async close(): Promise<void> {
    await this.rpcPersistQueue;
    this.disposers.splice(0).forEach((dispose) => dispose());
    for (const downlink of this.downlinks) downlink.socket.terminate();
    this.downlinks.clear();
    for (const downlink of this.sseDownlinks) downlink.response.end();
    this.sseDownlinks.clear();
    // P1-17: drop every per-session revision counter so a server restart
    // doesn't carry a stale map across reload boundaries.
    this.releaseAllSessionsLifecycle();
    const closedAddress = this.addressValue;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.addressValue = undefined;
    if (activeAddress === closedAddress) activeAddress = undefined;
    if (activeServer === this) activeServer = undefined;
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Browser CORS preflight — short-circuit before any business logic so the
    // preflight never enters the RPC dispatch loop. The same `applyCorsHeaders`
    // path is used for real responses (see `json()` and `handleSse()`).
    applyCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "content-length": "0" });
      res.end();
      return;
    }
    let requestRpcId: string | undefined;
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
      if (!this.authorized(req, url)) return json(res, 401, { error: "unauthorized" });
      const streamKind = url.pathname === "/api/events.mux" ? "mux" : url.pathname === "/api/events.host" ? "host" : undefined;
      if (req.method === "GET" && streamKind) return this.handleSse(url, streamKind, req, res);
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readJson(req);
      const message = parseRpcMessage(body);
      requestRpcId = message.rpcId;
      if (url.pathname === "/api/respond") {
        if (message.type !== "client-response") return json(res, 400, { accepted: false, reason: "bad-response" });
        const accepted = this.resolveResponse(message);
        return json(res, 200, { accepted, ...(accepted ? {} : { reason: "not-pending" }) });
      }
      const endpoint = url.pathname.slice("/api/".length);
      if (message.type !== "client-request" || message.method !== endpoint) return json(res, 400, { type: "server-response", rpcId: "rpcId" in message ? message.rpcId : createRpcId("invalid"), result: rpcError(new Error("RPC endpoint mismatch"), "bad-request") });
      if (this.isRecoveryMethod(message.method)) {
			const result = await this.dispatchRecovery(message, requestAuthority(req));
			return json(res, 200, { type: "server-response", rpcId: message.rpcId, result });
		}
      const result = await this.dispatchCached(message, requestAuthority(req));
      return json(res, 200, { type: "server-response", rpcId: message.rpcId, result });
    } catch (error) {
      const status = typeof (error as { statusCode?: unknown })?.statusCode === "number" ? (error as { statusCode: number }).statusCode : 400;
      return json(res, status, { type: "server-response", rpcId: requestRpcId ?? createRpcId("invalid"), result: rpcError(error, "bad-request") });
    }
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const expected = this.config.authToken;
    if (!expected) return true;
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
    const header = req.headers["x-openbuddy-harness-token"];
    const supplied = bearer ?? (typeof header === "string" ? header : undefined) ?? url.searchParams.get("token") ?? undefined;
    return supplied === expected;
  }

  private async dispatchCached(message: ClientRequest, context: DeepSeekConnectionDispatchContext): Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> {
    await this.rpcCacheReady;
    const now = Date.now();
    for (const [rpcId, entry] of this.rpcCache) if (entry.expiresAt <= now && !entry.pending) this.rpcCache.delete(rpcId);
    for (const [rpcId, intent] of this.rpcIntents) if (intent.expiresAt <= now) this.rpcIntents.delete(rpcId);
    const fingerprint = rpcRequestFingerprint(message);
    const existing = this.rpcCache.get(message.rpcId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return rpcError(new Error("RPC id was reused with a different request"), "bad-request");
      if (existing.pending) return existing.pending;
      return existing.result;
    }
	const inFlight = this.rpcInFlight.get(message.rpcId);
	if (inFlight) return inFlight;
	const intent = this.rpcIntents.get(message.rpcId);
	if (intent) {
		if (intent.fingerprint !== fingerprint) return rpcError(new Error("RPC id was reused with a different request"), "bad-request");
		return this.uncertainRpcResult(message.rpcId, intent);
	}
	const equivalentIntent = [...this.rpcIntents.values()].find((candidate) => candidate.fingerprint === fingerprint && candidate.expiresAt > now);
	if (equivalentIntent) {
		return rpcError(new Error("An equivalent side-effect RPC is already unresolved; explicit recovery is required"), "rpc-uncertain", {
			rpcId: message.rpcId,
			blockedByRpcId: equivalentIntent.rpcId,
			method: equivalentIntent.method,
			status: equivalentIntent.status,
			recovery: "inspect-side-effect-before-retry",
		});
	}
	const run = this.dispatchFresh(message, context, fingerprint, now);
	this.rpcInFlight.set(message.rpcId, run);
	try {
		return await run;
	} finally {
		if (this.rpcInFlight.get(message.rpcId) === run) this.rpcInFlight.delete(message.rpcId);
	}
  }

	private uncertainRpcResult(rpcId: string, intent: PersistedHarnessRpcIntent): ReturnType<typeof rpcError> {
		return rpcError(new Error("RPC outcome is uncertain after host restart; explicit recovery is required"), "rpc-uncertain", {
			rpcId,
			blockedByRpcId: intent.rpcId,
			method: intent.method,
			status: intent.status,
			recovery: "inspect-side-effect-before-retry",
		});
	}

	private isRecoveryMethod(method: string): boolean {
		return method === "recovery.list" || method === "recovery.claim" || method === "recovery.resolve";
	}

	private recoverySecret(): string | undefined {
		return this.config.recoveryClaimSecret ?? this.config.resumeTokenSecret ?? this.config.authToken;
	}

	private recoveryKeyId(): string {
		return this.config.recoveryClaimKeyId ?? "default";
	}

	private recoveryVerificationKeys(): readonly { id: string; secret: string; expiresAt?: number }[] {
		const current = this.recoverySecret();
		const configured = this.config.recoveryClaimVerificationKeys ?? [];
		return [
			...(current ? [{ id: this.recoveryKeyId(), secret: current }] : []),
			...configured.filter((key) => key.id !== this.recoveryKeyId()),
		];
	}

	private recoveryIdentity(): string {
		return this.config.recoveryClaimIdentity ?? harnessRpcIdentity(this.config.authToken);
	}

	private recoveryAuthority(intent: PersistedHarnessRpcIntent): DeepSeekConnectionDispatchContext["authority"] {
		return intent.authority ?? "loopback";
	}

	private recoveryAuthorityError(intent: PersistedHarnessRpcIntent, context: DeepSeekConnectionDispatchContext): ReturnType<typeof rpcError> {
		return rpcError(new Error("recovery caller authority does not match the side-effect authority"), "recovery-authority-invalid", {
			rpcId: intent.rpcId,
			expectedAuthority: this.recoveryAuthority(intent),
			actualAuthority: context.authority,
		});
	}

	/**
	 * Public recovery dispatch entry. Builds a typed ClientRequest internally and
	 * routes it through the same recovery pipeline used by HTTP/WS transports so
	 * IPC callers do not duplicate the side-effect, intent, and signing logic.
	 */
	async dispatchRecoveryMethod(method: "recovery.list" | "recovery.claim" | "recovery.resolve", payload: Record<string, unknown> = {}, context: DeepSeekConnectionDispatchContext = { authority: "loopback", caller: "openbuddy-ui" }): Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> {
		const message: ClientRequest = {
			type: "client-request",
			rpcId: createRpcId("recovery-" + method.slice("recovery.".length)),
			method,
			payload: payload as ClientRequest["payload"],
		};
		return this.dispatchRecovery(message, context);
	}

	/** Recovery queue summary that the renderer surfaces in WorkBuddy style. */
	recoveryStatus(): { pending: number; uncertain: number; byMethod: Record<string, number> } {
		const byMethod: Record<string, number> = {};
		let pending = 0;
		let uncertain = 0;
		for (const intent of this.rpcIntents.values()) {
			if (intent.status === "pending") pending += 1;
			else uncertain += 1;
			byMethod[intent.method] = (byMethod[intent.method] ?? 0) + 1;
		}
		return { pending, uncertain, byMethod };
	}

	/**
	 * P1-17: prune lifecycle state for a closed session. The previous code
	 * only called `lifecycleRevisions.set(sessionId, ...)` and never deleted,
	 * so the Map grew without bound for the lifetime of the app.
	 *
	 * Callers should invoke this when a session is archived / revoked so the
	 * revision counter and any per-session tracking state can be reclaimed.
	 */
	releaseSessionLifecycle(sessionId: string): void {
		this.lifecycleRevisions.delete(sessionId);
	}

	/** P1-17: drop lifecycle state for every known session (used on shutdown). */
	releaseAllSessionsLifecycle(): void {
		this.lifecycleRevisions.clear();
	}

	private async dispatchRecovery(message: ClientRequest, context: DeepSeekConnectionDispatchContext = { authority: "loopback", caller: "loopback" }): Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> {
		const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
			? message.payload as Record<string, unknown>
			: {};
		const rpcId = typeof payload.rpcId === "string" ? payload.rpcId : undefined;
		if (!rpcId || message.method === "recovery.list") return this.dispatchRecoveryUnlocked(message, context);
		const previous = this.recoveryQueues.get(rpcId) ?? Promise.resolve();
		const run = previous.catch(() => undefined).then(() => this.dispatchRecoveryUnlocked(message, context));
		const marker = run.then(() => undefined, () => undefined);
		this.recoveryQueues.set(rpcId, marker);
		try {
			return await run;
		} finally {
			if (this.recoveryQueues.get(rpcId) === marker) this.recoveryQueues.delete(rpcId);
		}
	}

	private async dispatchRecoveryUnlocked(message: ClientRequest, context: DeepSeekConnectionDispatchContext = { authority: "loopback", caller: "loopback" }): Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> {
		await this.rpcCacheReady;
		try {
			const { validateRpcRequestPayload } = await import("@openbuddy/plugin-host");
			validateRpcRequestPayload(message.method, message.payload);
		} catch (error) {
			return rpcError(error, "bad-request");
		}
		const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
			? message.payload as Record<string, unknown>
			: {};
		const rpcId = typeof payload.rpcId === "string" ? payload.rpcId : undefined;
		if (message.method === "recovery.list") {
			if (Object.keys(payload).length > 0) return rpcError(new Error("recovery.list does not accept fields"), "bad-request");
			return rpcValue({ intents: [...this.rpcIntents.values()].map((intent) => ({
				rpcId: intent.rpcId,
				method: intent.method,
				status: intent.status,
				createdAt: intent.createdAt,
				expiresAt: intent.expiresAt,
				...(intent.claimedBy ? { claimedBy: intent.claimedBy } : {}),
				...(intent.authority ? { authority: intent.authority } : {}),
				...(intent.claimExpiresAt ? { claimExpiresAt: intent.claimExpiresAt } : {}),
			})) });
		}
		if (!rpcId) return rpcError(new Error("recovery rpcId is required"), "bad-request");
		let intent = this.rpcIntents.get(rpcId);
		if (!intent || intent.status !== "uncertain") {
			if (message.method === "recovery.resolve") {
				const cached = this.rpcCache.get(rpcId)?.result;
				if (cached?.ok && cached.value && typeof cached.value === "object" && (cached.value as Record<string, unknown>).recovered === true) {
					const claimant = (cached.value as Record<string, unknown>).claimant;
					const receiptAuthority = cached.value as Record<string, unknown>;
					if (typeof claimant === "string" && claimant === context.caller && (receiptAuthority.authority ?? "loopback") === context.authority) return cached;
					return rpcError(new Error("recovery receipt is bound to a different caller"), "recovery-authority-invalid", { rpcId, caller: context.caller ?? "unknown" });
				}
			}
			return rpcError(new Error("recovery intent was not found or is not uncertain"), "recovery-state-invalid", { rpcId });
		}
		const now = Date.now();
		if (intent.expiresAt <= now) {
			this.rpcIntents.delete(rpcId);
			await this.persistRpcCache();
			return rpcError(new Error("recovery intent has expired"), "recovery-state-invalid", { rpcId });
		}
		if (message.method === "recovery.claim") {
			if (Object.keys(payload).some((key) => !["rpcId", "claimant"].includes(key))) return rpcError(new Error("recovery.claim has an unknown field"), "bad-request");
			const claimant = typeof payload.claimant === "string" && payload.claimant.trim() ? payload.claimant.trim() : undefined;
			if (!claimant) return rpcError(new Error("recovery claimant is required"), "bad-request");
			if (!context.caller || claimant !== context.caller) return rpcError(new Error("recovery claimant does not match caller identity"), "recovery-authority-invalid", { rpcId, caller: context.caller ?? "unknown" });
			if (context.authority !== this.recoveryAuthority(intent)) return this.recoveryAuthorityError(intent, context);
			if (intent.claimExpiresAt !== undefined && intent.claimExpiresAt > now) return rpcError(new Error("recovery intent is already claimed"), "recovery-claim-conflict", { rpcId, claimedBy: intent.claimedBy ?? "unknown", claimExpiresAt: intent.claimExpiresAt });
			const secret = this.recoverySecret();
			if (!secret) return rpcError(new Error("recovery claim signing is unavailable"), "recovery-token-invalid", { rpcId });
			const token = issueHarnessRecoveryClaim(secret, this.recoveryIdentity(), { rpcId, fingerprint: intent.fingerprint, claimant, authority: this.recoveryAuthority(intent) }, undefined, Date.now(), this.recoveryKeyId());
			const claim = verifyHarnessRecoveryClaim(token, secret, this.recoveryIdentity(), Date.now(), this.recoveryAuthority(intent));
			if (!claim) return rpcError(new Error("recovery claim signing failed"), "recovery-token-invalid", { rpcId });
			intent.claimedBy = claimant;
			intent.claimHash = hashHarnessRecoveryClaim(token);
			intent.claimKeyId = claim.keyId ?? this.recoveryKeyId();
			intent.claimExpiresAt = claim.expiresAt;
			try {
				await this.persistRpcCache(true);
			} catch (error) {
				delete intent.claimedBy;
				delete intent.claimHash;
				delete intent.claimKeyId;
				delete intent.claimExpiresAt;
				return rpcError(error, "recovery-state-invalid", { rpcId });
			}
			if (this.rpcStore) {
				const durable = (await this.rpcStore.readState()).intents.find((candidate) => candidate.rpcId === rpcId);
				if (!durable || durable.claimedBy !== claimant || durable.claimHash !== intent.claimHash || durable.claimKeyId !== intent.claimKeyId) {
					if (durable) this.rpcIntents.set(rpcId, { ...durable });
					else this.rpcIntents.delete(rpcId);
					return rpcError(new Error("recovery intent was claimed by another authority"), "recovery-claim-conflict", {
						rpcId,
						claimedBy: durable?.claimedBy ?? "unknown",
						claimExpiresAt: durable?.claimExpiresAt,
					});
				}
			}
			await this.journalRpcLifecycle(intent, "claim", context).catch((error) => this.config.logger?.("failed to journal RPC claim", error));
			return rpcValue({ rpcId, method: intent.method, status: "claimed", claimant, authority: this.recoveryAuthority(intent), expiresAt: claim.expiresAt, token });
		}
		if (Object.keys(payload).some((key) => !["rpcId", "token", "action"].includes(key))) return rpcError(new Error("recovery.resolve has an unknown field"), "bad-request");
		const token = typeof payload.token === "string" ? payload.token : undefined;
		const action = payload.action === "committed" || payload.action === "aborted" ? payload.action : undefined;
		const secret = this.recoverySecret();
		if (context.authority !== this.recoveryAuthority(intent)) return this.recoveryAuthorityError(intent, context);
		let durableEntry: PersistedHarnessRpcEntry | undefined;
		let durableIntent: PersistedHarnessRpcIntent | undefined;
		if (this.rpcStore) {
			const durable = await this.rpcStore.readState();
			durableIntent = durable.intents.find((candidate) => candidate.rpcId === rpcId);
			durableEntry = durable.entries.find((candidate) => candidate.rpcId === rpcId);
			if (!durableIntent) {
				if (!durableEntry?.result.ok || !durableEntry.result.value || typeof durableEntry.result.value !== "object" || (durableEntry.result.value as Record<string, unknown>).recovered !== true) {
					return rpcError(new Error("recovery intent was resolved by another authority"), "recovery-claim-conflict", { rpcId });
				}
			} else {
				intent = durableIntent;
			}
		}
		const claim = token ? verifyHarnessRecoveryClaimWithKeys(token, this.recoveryVerificationKeys(), this.recoveryIdentity(), Date.now(), this.recoveryAuthority(intent)) : undefined;
		if (!claim || claim.rpcId !== rpcId || claim.fingerprint !== intent.fingerprint || claim.claimant !== context.caller || claim.authority !== this.recoveryAuthority(intent) || (intent.claimKeyId !== undefined && claim.keyId !== intent.claimKeyId) || intent.claimHash !== hashHarnessRecoveryClaim(token!)) return rpcError(new Error("recovery claim token is invalid"), "recovery-token-invalid", { rpcId });
		if (durableIntent?.claimHash && durableIntent.claimHash !== hashHarnessRecoveryClaim(token!)) {
			this.rpcIntents.set(rpcId, { ...durableIntent });
			return rpcError(new Error("recovery intent is claimed by another authority"), "recovery-claim-conflict", { rpcId, claimedBy: durableIntent.claimedBy ?? "unknown" });
		}
		if (durableEntry) {
			const durableValue = durableEntry.result.ok && durableEntry.result.value && typeof durableEntry.result.value === "object" ? durableEntry.result.value as Record<string, unknown> : undefined;
			if (!durableValue || durableValue.recovered !== true || durableValue.claimant !== claim.claimant || durableValue.authority !== this.recoveryAuthority(intent)) {
				return rpcError(new Error("recovery receipt is bound to another claimant"), "recovery-claim-conflict", { rpcId });
			}
			return rpcValue({ rpcId, status: durableValue.status === "committed" || durableValue.status === "aborted" ? durableValue.status : action, receipt: { recovered: true, rpcId, status: durableValue.status, claimant: claim.claimant, authority: this.recoveryAuthority(intent) }, claimant: claim.claimant, authority: this.recoveryAuthority(intent) });
		}
		if (intent.claimExpiresAt !== undefined && intent.claimExpiresAt <= now) return rpcError(new Error("recovery claim has expired"), "recovery-token-invalid", { rpcId });
		if (!action) return rpcError(new Error("recovery action must be committed or aborted"), "bad-request", { rpcId });
		const receipt = rpcValue({ recovered: true, rpcId, status: action, claimant: claim.claimant, authority: this.recoveryAuthority(intent) });
		this.rpcCache.set(rpcId, { fingerprint: intent.fingerprint, expiresAt: intent.expiresAt, result: receipt });
		this.rpcIntents.delete(rpcId);
		try {
			await this.persistRpcCache(true);
		} catch (error) {
			this.rpcCache.delete(rpcId);
			this.rpcIntents.set(rpcId, intent);
			return rpcError(error, "recovery-state-invalid", { rpcId });
		}
		if (this.rpcStore) {
			const durable = await this.rpcStore.readState();
			const durableEntry = durable.entries.find((candidate) => candidate.rpcId === rpcId);
			if (durableEntry?.result.ok && durableEntry.result.value && typeof durableEntry.result.value === "object" && (durableEntry.result.value as Record<string, unknown>).recovered === true) {
				const durableValue = durableEntry.result.value as Record<string, unknown>;
				if (durableValue.claimant !== claim.claimant || durableValue.authority !== this.recoveryAuthority(intent)) {
					return rpcError(new Error("recovery receipt is bound to another claimant"), "recovery-claim-conflict", { rpcId });
				}
				return rpcValue({ rpcId, status: durableValue.status === "committed" || durableValue.status === "aborted" ? durableValue.status : action, receipt: { recovered: true, rpcId, status: durableValue.status, claimant: claim.claimant, authority: this.recoveryAuthority(intent) }, claimant: claim.claimant, authority: this.recoveryAuthority(intent) });
			}
		}
		await this.journalRpcLifecycle(intent, "resolve", context, action).catch((error) => this.config.logger?.("failed to journal RPC recovery resolution", error));
		return rpcValue({ rpcId, status: action, receipt: { recovered: true, rpcId, status: action }, claimant: claim.claimant, authority: this.recoveryAuthority(intent) });
	}

	private async dispatchFresh(message: ClientRequest, context: DeepSeekConnectionDispatchContext, fingerprint: string, now: number): Promise<ReturnType<typeof rpcValue> | ReturnType<typeof rpcError>> {
		const sideEffect = this.isSideEffectMethod(message.method);
		if (sideEffect) {
			const sessionId = sessionIdOf(message.payload);
			this.rpcIntents.set(message.rpcId, {
				rpcId: message.rpcId,
				fingerprint,
				method: message.method,
				...(sessionId ? { sessionId } : {}),
				authority: context.authority,
				createdAt: now,
				expiresAt: now + RPC_CACHE_TTL_MS,
					status: "pending",
				});
				const intent = this.rpcIntents.get(message.rpcId)!;
				try {
					await this.persistRpcCache(true);
			} catch (error) {
				this.rpcIntents.delete(message.rpcId);
					throw error;
				}
				await this.journalRpcLifecycle(intent, "intent", context).catch((error) => this.config.logger?.("failed to journal RPC intent", error));
			}
		const pending = Promise.resolve()
			.then(() => this.config.dispatchRpc(message, context))
			.then((value) => rpcValue(value), (error) => rpcError(error));
		const entry: CachedRpc = { fingerprint, expiresAt: now + RPC_CACHE_TTL_MS, result: rpcError(new Error("RPC request is pending"), "internal"), pending };
		this.rpcCache.set(message.rpcId, entry);
		while (this.rpcCache.size > RPC_CACHE_LIMIT) {
			const oldest = this.rpcCache.keys().next().value;
			if (typeof oldest !== "string") break;
			this.rpcCache.delete(oldest);
		}
		const result = await pending;
		entry.result = result;
		entry.pending = undefined;
		if (!sideEffect) {
			await this.persistRpcCache();
			return result;
		}
		const intent = this.rpcIntents.get(message.rpcId);
		this.rpcIntents.delete(message.rpcId);
		try {
			await this.persistRpcCache(true);
			if (intent) await this.journalRpcLifecycle(intent, "resolve", context, result.ok ? "committed" : "failed").catch((error) => this.config.logger?.("failed to journal RPC resolution", error));
			return result;
		} catch (error) {
			const uncertain = rpcError(new Error("RPC completed but its receipt could not be durably persisted; explicit recovery is required"), "rpc-uncertain", {
				rpcId: message.rpcId,
				method: message.method,
				recovery: "inspect-side-effect-before-retry",
				persistenceError: String(error),
			});
				if (intent) await this.journalRpcLifecycle({ ...intent, status: "uncertain" }, "uncertain", context).catch(() => undefined);
			entry.result = uncertain;
			if (intent) this.rpcIntents.set(message.rpcId, { ...intent, status: "uncertain" });
			await this.persistRpcCache().catch(() => undefined);
			return uncertain;
		}
	}

	private nextLifecycleRevision(sessionId: string): number {
		const revision = (this.lifecycleRevisions.get(sessionId) ?? 0) + 1;
		this.lifecycleRevisions.set(sessionId, revision);
		return revision;
	}

	private async journalRpcLifecycle(
		intent: PersistedHarnessRpcIntent,
		phase: "intent" | "claim" | "resolve" | "uncertain",
		context: DeepSeekConnectionDispatchContext,
		status?: string,
	): Promise<void> {
		const sessionId = intent.sessionId;
		if (!sessionId || !this.config.lifecycleJournal) return;
		await this.config.lifecycleJournal(sessionId, lifecycleEvent({
			operation: "rpc",
			phase,
			revision: this.nextLifecycleRevision(sessionId),
			sessionId,
			rpcId: intent.rpcId,
			fingerprint: intent.fingerprint,
			method: intent.method,
			status: status ?? intent.status,
			...(intent.claimHash ? { claimHash: hashLifecycleSecret(intent.claimHash) } : {}),
			...(context.authority ? { authority: context.authority } : {}),
			...(context.caller ? { caller: context.caller } : {}),
		}));
	}

	private isSideEffectMethod(method: string): boolean {
		const configured = this.config.sideEffectRpcMethods;
		return configured?.includes(method) === true || !isReplayableRpcMethod(method);
	}

  private async restoreRpcCache(): Promise<void> {
    if (!this.rpcStore) return;
    try {
		const restored = await this.rpcStore.readState();
		this.rpcPersistedRevision = restored.revision;
		for (const entry of restored.entries) {
        this.rpcCache.set(entry.rpcId, { ...entry });
      }
		const uncertainIntents = restored.intents.map((intent) => ({ ...intent, status: "uncertain" as const }));
		for (const intent of uncertainIntents) this.rpcIntents.set(intent.rpcId, intent);
		if (uncertainIntents.length > 0) {
			this.rpcPersistedRevision = await this.rpcStore.writeState(restored.entries, uncertainIntents, restored.revision);
			await Promise.all(uncertainIntents.map((intent) => this.journalRpcLifecycle(intent, "uncertain", { authority: "loopback", caller: "recovery" }).catch((error) => this.config.logger?.("failed to journal uncertain RPC", error))));
		}
      while (this.rpcCache.size > RPC_CACHE_LIMIT) {
        const oldest = this.rpcCache.keys().next().value;
        if (typeof oldest !== "string") break;
        this.rpcCache.delete(oldest);
      }
    } catch (error) {
      this.config.logger?.("failed to restore Harness RPC cache", error);
    }
  }

  private persistRpcCache(fail = false): Promise<void> {
    if (!this.rpcStore) return Promise.resolve();
	const write = this.rpcPersistQueue.catch(() => undefined).then(async () => {
		try {
			await this.persistRpcState(this.persistedRpcEntries(), [...this.rpcIntents.values()]);
		} catch (error) {
			if (!fail) this.config.logger?.("failed to persist Harness RPC cache", error);
			if (fail) throw error;
		}
    });
	this.rpcPersistQueue = write;
    return fail ? write : write.catch(() => undefined);
  }

	private persistedRpcEntries(): PersistedHarnessRpcEntry[] {
		return [...this.rpcCache.entries()]
			.filter(([, entry]) => !entry.pending)
			.map(([rpcId, entry]) => ({ rpcId, fingerprint: entry.fingerprint, expiresAt: entry.expiresAt, result: entry.result }));
	}

	private async persistRpcState(
		entries: readonly PersistedHarnessRpcEntry[],
		intents: readonly PersistedHarnessRpcIntent[],
	): Promise<void> {
		const maxAttempts = 3;
		let localEntries = entries.map((entry) => ({ ...entry }));
		let localIntents = intents.map((intent) => ({ ...intent }));
		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			try {
				this.rpcPersistedRevision = await this.rpcStore!.writeState(localEntries, localIntents, this.rpcPersistedRevision);
				return;
			} catch (error) {
				if (!(error instanceof HarnessRpcRevisionConflict) || attempt === maxAttempts - 1) throw error;
				const external = await this.rpcStore!.readState();
				const merged = this.mergePersistedRpcState(external, localEntries, localIntents);
				this.absorbReconciledRpcState(external, localEntries, localIntents);
				localEntries = merged.entries;
				localIntents = merged.intents;
				this.rpcPersistedRevision = external.revision;
			}
		}
	}

	private mergePersistedRpcState(
		external: HarnessRpcState,
		localEntries: readonly PersistedHarnessRpcEntry[],
		localIntents: readonly PersistedHarnessRpcIntent[],
	): HarnessRpcState {
		const entries = new Map(external.entries.map((entry) => [entry.rpcId, { ...entry }]));
		const intents = new Map(external.intents.map((intent) => [intent.rpcId, { ...intent }]));
		for (const entry of localEntries) {
			const current = entries.get(entry.rpcId);
			if (current && current.fingerprint !== entry.fingerprint) {
				throw new HarnessRpcRevisionConflict(this.rpcPersistedRevision, external.revision);
			}
			if (!current) {
				entries.set(entry.rpcId, { ...entry });
				intents.delete(entry.rpcId);
			}
		}
		for (const intent of localIntents) {
			const currentEntry = entries.get(intent.rpcId);
			if (currentEntry) {
				if (currentEntry.fingerprint !== intent.fingerprint) {
					throw new HarnessRpcRevisionConflict(this.rpcPersistedRevision, external.revision);
				}
				continue;
			}
			const currentIntent = intents.get(intent.rpcId);
			if (currentIntent && (currentIntent.fingerprint !== intent.fingerprint || currentIntent.authority !== intent.authority)) {
				throw new HarnessRpcRevisionConflict(this.rpcPersistedRevision, external.revision);
			}
			if (!currentIntent) {
				intents.set(intent.rpcId, { ...intent });
			} else if (currentIntent.claimExpiresAt === undefined && intent.claimExpiresAt !== undefined) {
				intents.set(intent.rpcId, { ...currentIntent, claimedBy: intent.claimedBy, claimHash: intent.claimHash, claimKeyId: intent.claimKeyId, claimExpiresAt: intent.claimExpiresAt });
			}
		}
		return { entries: [...entries.values()], intents: [...intents.values()], revision: external.revision };
	}

	private absorbReconciledRpcState(
		external: HarnessRpcState,
		localEntries: readonly PersistedHarnessRpcEntry[],
		localIntents: readonly PersistedHarnessRpcIntent[],
	): void {
		const localEntryIds = new Set(localEntries.map((entry) => entry.rpcId));
		for (const entry of external.entries) {
			if (!localEntryIds.has(entry.rpcId) && !this.rpcCache.has(entry.rpcId)) this.rpcCache.set(entry.rpcId, { ...entry });
		}
		const localIntentIds = new Set(localIntents.map((intent) => intent.rpcId));
		for (const intent of external.intents) {
			if (!localIntentIds.has(intent.rpcId)) {
				const current = this.rpcIntents.get(intent.rpcId);
				if (!current || intent.claimHash !== undefined || intent.status !== current.status) this.rpcIntents.set(intent.rpcId, { ...intent });
			}
		}
	}

  private handleSse(url: URL, kind: "mux" | "host", req: IncomingMessage, res: ServerResponse): void {
    const { sinceSequence, sinceSessions, resumeToken, clientIdentity } = this.connectionCursor(url);
    const downlink: SseDownlink = {
      response: res,
      kind,
      ...(sinceSequence === undefined ? {} : { sinceSequence }),
      ...(sinceSessions === undefined ? {} : { sinceSessions }),
      replaying: true,
      pending: [],
      closed: false,
      ...(resumeToken ? { resumeToken } : {}),
      ...(clientIdentity ? { clientIdentity } : {}),
    };
    // `applyCorsHeaders()` was already called by `handleHttp()` for this
    // request path; calling it again here is harmless because Node's
    // `ServerResponse#setHeader` deduplicates identical values. We still call
    // it so `handleSse()` is safe to invoke directly from tests.
    applyCorsHeaders(res);
    res.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "transfer-encoding": "chunked",
    });
    this.sseDownlinks.add(downlink);
    const close = () => {
      downlink.closed = true;
      this.sseDownlinks.delete(downlink);
    };
    res.on("close", close);
    res.on("error", close);
    res.write(": open\n\n");
    void this.replaySse(downlink);
    void req;
  }

  private resolveResponse(message: ClientResponse): boolean {
    if (!message.result.ok) return this.config.agent.resolveUiRequest(message.rpcId, undefined);
    const value = message.result.value;
    if (!value || typeof value !== "object") return false;
    const payload = value as Record<string, unknown>;
    if (payload.optionId !== undefined || payload.cancelled !== undefined) {
      return this.config.agent.resolveUiRequest(message.rpcId,
        payload.cancelled === true || payload.optionId === "deny" ? false
          : payload.optionId === "allow_always" ? { decision: "allow_always" }
            : payload.optionId === "allow");
    }
    const answers = payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers) ? payload.answers as Record<string, string | string[]> : {};
    const annotations = payload.annotations && typeof payload.annotations === "object" && !Array.isArray(payload.annotations) ? payload.annotations as Record<string, { preview?: string; notes?: string }> : {};
    return this.config.agent.resolveUiRequest(message.rpcId, { answers, annotations });
  }

  private handleUpgrade(req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!this.authorized(req, url)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const path = url.pathname;
    if (path === "/api/buddy-relay") {
      if (!this.config.buddyRelay) { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
      this.websocketServer.handleUpgrade(req, socket, head, (websocket: WebSocket) => {
        attachRemoteRelayWebSocket(websocket, this.config.buddyRelay!);
      });
      return;
    }
    const kind = path === "/api/events.mux" ? "mux" : path === "/api/events.host" ? "host" : undefined;
    if (!kind) { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    this.websocketServer.handleUpgrade(req, socket, head, (websocket: WebSocket) => {
      const { sinceSequence, sinceSessions, resumeToken, clientIdentity } = this.connectionCursor(url);
      const downlink: Downlink = {
        socket: websocket,
        kind,
        ...(sinceSequence === undefined ? {} : { sinceSequence }),
        ...(sinceSessions === undefined ? {} : { sinceSessions }),
        replaying: true,
        pending: [],
        ...(resumeToken ? { resumeToken } : {}),
        ...(clientIdentity ? { clientIdentity } : {}),
      };
      this.downlinks.add(downlink);
      websocket.on("close", () => this.downlinks.delete(downlink));
      websocket.on("error", () => this.downlinks.delete(downlink));
      websocket.on("message", () => websocket.close(1008, "downlink only"));
      setImmediate(() => { void this.replay(downlink); });
    });
  }

  private async replay(downlink: Downlink): Promise<void> {
    if (downlink.kind === "mux") {
      const baselines = await (this.config.agent.sessionBaselines?.() ?? this.sessionBaselinesFromEvents());
      const records = this.config.agent.pluginEvents({ limit: 2000 });
      for (const baseline of baselines) {
        if (downlink.socket.readyState !== WebSocket.OPEN) return;
        this.send(downlink, {
          frame: { type: "session/subscribed", sessionId: baseline.sessionId, lastSeq: baseline.lastSeq, snapshot: true },
          rpcId: RpcId(`subscribed-${baseline.sessionId}`),
        });
        const projection = await this.config.agent.sessionProjectionBaseline?.(baseline.sessionId);
        if (projection) {
          for (const [key, value] of Object.entries(projection.values)) {
            this.send(downlink, { frame: { type: "session/projection", sessionId: baseline.sessionId, key, value, seq: projection.asOfSeq, snapshot: true }, rpcId: RpcId(`projection-${baseline.sessionId}-${key}`), sequence: projection.asOfSeq });
          }
        }
        const jobs = this.config.agent.listSessionJobs?.(baseline.sessionId);
        if (this.config.agent.listSessionJobs) this.send(downlink, { frame: { type: "session/jobs", sessionId: baseline.sessionId, jobs: jobs ?? [] }, rpcId: RpcId(`jobs-${baseline.sessionId}`) });
      }
      for (const gap of cursorGapFrames(baselines, downlink.sinceSessions, records)) {
        if (downlink.socket.readyState !== WebSocket.OPEN) return;
        this.send(downlink, {
          frame: cursorGapFrame(gap, records),
          rpcId: RpcId(`cursor-gap-${gap.sessionId}`),
        });
      }
    }
    const records = this.config.agent.pluginEvents({ limit: 2000 }).filter((record) => recordAfterCursor(record, downlink, downlink.kind));
    for (const record of records) {
      if (downlink.socket.readyState !== WebSocket.OPEN) return;
      const frame = downlink.kind === "mux"
        ? (record.type === "session/projection" ? pluginFrames(record, this.config.agent).mux : sessionFrameForRecord(record) ?? pluginFrames(record, this.config.agent).mux)
        : pluginFrames(record, this.config.agent).host;
      const frameSequence = downlink.kind === "mux" ? recordSessionSequence(record) : record.sequence;
      if (frame) this.send(downlink, { frame, rpcId: RpcId(`replay-${record.sequence}`), sequence: frameSequence });
    }
    downlink.replaying = false;
    const pending = downlink.pending.splice(0);
    pending.sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
    for (const item of pending) this.send(downlink, item);
    await this.sendResume(downlink);
  }

  private send(downlink: Downlink, item: DownlinkFrame): void {
    if (downlink.socket.readyState !== WebSocket.OPEN) return;
    // Socket can transition to CLOSED between the readyState check above and
    // the underlying TCP write. The ws library surfaces that as an
    // unhandled error event which would otherwise crash the main process;
    // wrap the send so a torn-down downlink never escalates.
    try {
      downlink.socket.send(JSON.stringify(frameEnvelope(item.frame, item.rpcId ? RpcId(item.rpcId) : RpcId(randomUUID()), item.sequence)));
    } catch (error) {
      if (!isBenignSocketClose(error)) {
        console.error("[openbuddy-harness] send failed:", error);
      }
    }
  }

  private sendSse(downlink: SseDownlink, item: DownlinkFrame): void {
    if (downlink.closed || downlink.response.writableEnded) return;
    // Same defensive try/catch as send(): the SSE response can be closed
    // (peer reset) between the writableEnded check and the write call,
    // which raises ERR_STREAM_WRITE_AFTER_END / EPIPE.
    try {
      downlink.response.write(`data: ${JSON.stringify(frameEnvelope(item.frame, item.rpcId ? RpcId(item.rpcId) : RpcId(randomUUID()), item.sequence))}\n\n`);
    } catch (error) {
      if (!isBenignSocketClose(error)) {
        console.error("[openbuddy-harness] SSE send failed:", error);
      }
    }
  }

  private broadcast(kind: "mux" | "host", frame: Frame, rpcId?: string, sequence?: number): void {
    for (const downlink of this.downlinks) {
      if (downlink.kind !== kind || downlink.socket.readyState !== WebSocket.OPEN) continue;
      const item = { frame, ...(rpcId ? { rpcId } : {}), ...(typeof sequence === "number" ? { sequence } : {}) };
      if (downlink.replaying) downlink.pending.push(item);
      else this.send(downlink, item);
    }
    for (const downlink of this.sseDownlinks) {
      if (downlink.kind !== kind || downlink.closed || downlink.response.writableEnded) continue;
      const item = { frame, ...(rpcId ? { rpcId } : {}), ...(typeof sequence === "number" ? { sequence } : {}) };
      if (downlink.replaying) downlink.pending.push(item);
      else this.sendSse(downlink, item);
    }
  }

  private async replaySse(downlink: SseDownlink): Promise<void> {
    if (downlink.kind === "mux") {
      const baselines = await (this.config.agent.sessionBaselines?.() ?? this.sessionBaselinesFromEvents());
      const records = this.config.agent.pluginEvents({ limit: 2000 });
      for (const baseline of baselines) {
        if (downlink.closed || downlink.response.writableEnded) return;
        this.sendSse(downlink, {
          frame: { type: "session/subscribed", sessionId: baseline.sessionId, lastSeq: baseline.lastSeq, snapshot: true },
          rpcId: RpcId(`subscribed-${baseline.sessionId}`),
        });
        const projection = await this.config.agent.sessionProjectionBaseline?.(baseline.sessionId);
        if (projection) {
          for (const [key, value] of Object.entries(projection.values)) {
            this.sendSse(downlink, { frame: { type: "session/projection", sessionId: baseline.sessionId, key, value, seq: projection.asOfSeq, snapshot: true }, rpcId: RpcId(`projection-${baseline.sessionId}-${key}`), sequence: projection.asOfSeq });
          }
        }
      }
      for (const gap of cursorGapFrames(baselines, downlink.sinceSessions, records)) {
        if (downlink.closed || downlink.response.writableEnded) return;
        this.sendSse(downlink, {
          frame: cursorGapFrame(gap, records),
          rpcId: RpcId(`cursor-gap-${gap.sessionId}`),
        });
      }
    }
    const records = this.config.agent.pluginEvents({ limit: 2000 }).filter((record) => recordAfterCursor(record, downlink, downlink.kind));
    for (const record of records) {
      if (downlink.closed || downlink.response.writableEnded) return;
      const frame = downlink.kind === "mux"
        ? (record.type === "session/projection" ? pluginFrames(record, this.config.agent).mux : sessionFrameForRecord(record) ?? pluginFrames(record, this.config.agent).mux)
        : pluginFrames(record, this.config.agent).host;
      const frameSequence = downlink.kind === "mux" ? recordSessionSequence(record) : record.sequence;
      if (frame) this.sendSse(downlink, { frame, rpcId: RpcId(`replay-${record.sequence}`), sequence: frameSequence });
    }
    downlink.replaying = false;
    const pending = downlink.pending.splice(0);
    pending.sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
    for (const item of pending) this.sendSse(downlink, item);
    await this.sendResumeSse(downlink);
  }

  private async resumeCursor(): Promise<HarnessResumeCursor> {
    const records = this.config.agent.pluginEvents({ limit: 2000 });
    const baselines = await (this.config.agent.sessionBaselines?.() ?? this.sessionBaselinesFromEvents());
    const sortedBaselines = [...baselines].sort((left, right) => right.lastSeq - left.lastSeq);
    const cappedBaselines = sortedBaselines.slice(0, RESUME_TOKEN_SESSION_LIMIT);
    const droppedCount = sortedBaselines.length - cappedBaselines.length;
    const sessions = Object.fromEntries(cappedBaselines.map((entry) => [entry.sessionId, entry.lastSeq]));
    const sequence = records.reduce<number | undefined>((maximum, record) => Math.max(maximum ?? record.sequence, record.sequence), undefined);
    if (droppedCount > 0) {
      // Older sessions are evicted from the signed cursor; the renderer's
      // persisted `harness:session-cursors` map still covers them on reconnect.
      return sequence === undefined ? {} : { sequence };
    }
    return { ...(sequence === undefined ? {} : { sequence }), ...(Object.keys(sessions).length ? { sessions } : {}) };
  }

  private resumeToken(cursor: HarnessResumeCursor, clientIdentity?: string): string | undefined {
    const secret = this.config.resumeTokenSecret ?? this.config.authToken;
    if (!secret) return undefined;
    return issueHarnessResumeToken(secret, this.config.resumeTokenIdentity ?? harnessRpcIdentity(this.config.authToken), cursor, 24 * 60 * 60 * 1000, Date.now(), clientIdentity);
  }

  private async sendResume(downlink: Downlink): Promise<void> {
    const cursor = await this.resumeCursor();
    const token = this.resumeToken(cursor, downlink.clientIdentity);
    if (!token || downlink.socket.readyState !== WebSocket.OPEN) return;
    this.send(downlink, { frame: { type: "connection/resume", token, cursor }, rpcId: RpcId(`resume-${Date.now()}`) });
  }

  private async sendResumeSse(downlink: SseDownlink): Promise<void> {
    const cursor = await this.resumeCursor();
    const token = this.resumeToken(cursor, downlink.clientIdentity);
    if (!token || downlink.closed || downlink.response.writableEnded) return;
    this.sendSse(downlink, { frame: { type: "connection/resume", token, cursor }, rpcId: RpcId(`resume-${Date.now()}`) });
  }

  private sessionBaselinesFromEvents(): Array<{ sessionId: string; lastSeq: number }> {
    const baselines = new Map<string, number>();
    for (const record of this.config.agent.pluginEvents({ limit: 2000 })) {
      const sessionId = recordSessionId(record);
      if (!sessionId) continue;
      baselines.set(sessionId, Math.max(baselines.get(sessionId) ?? -1, recordSessionSequence(record)));
    }
    return [...baselines.entries()].map(([sessionId, lastSeq]) => ({ sessionId, lastSeq }));
  }
}

export async function startHarnessServer(config: HarnessServerConfig): Promise<{ server: HarnessServer; address: HarnessServerAddress }> {
  const server = new HarnessServer(config);
  const address = await server.start();
  return { server, address };
}
