import { createMainLogger, withContext, type MainLogger } from "@openbuddy/logging-main";
import { type LogContext } from "@openbuddy/logging-shared";

export interface ContextEventSink {
  emit(event: string, ...args: unknown[]): unknown;
}

export type PiEventErrorHandler = (event: string, error: unknown) => void;

export interface SessionEventRecord {
  eventVersion?: 1;
  sequence: number;
  sessionSequence?: number;
  timestamp: string;
  type: string;
  sessionId?: string;
  payload: unknown;
}

export interface SessionEventLogQuery {
  sessionId?: string;
  sinceSequence?: number;
  limit?: number;
}

const defaultOnError: PiEventErrorHandler = (event, error) => {
  console.error(`[openbuddy] Cordis listener failed for ${event}`, error);
};

const DEFAULT_RING_LIMIT = 2000;

let bridgeLogger: MainLogger | null = null;
function getBridgeLogger(): MainLogger {
  if (bridgeLogger) return bridgeLogger;
  bridgeLogger = createMainLogger({
    serviceName: "openbuddy-pi-event-bridge",
    baseContext: { scope: "pi-event-bridge" },
  });
  return bridgeLogger;
}

function bridgeContext(event: string, traceId?: string): LogContext {
  const ctx: LogContext = { scope: "pi-event-bridge", eventName: event };
  if (traceId !== undefined) ctx.traceId = traceId;
  return ctx;
}

/**
 * Attach `traceId` to the trailing plain-object argument so downstream consumers
 * can correlate the emitted event with the originating IPC call.
 *
 * Only the LAST arg is decorated: Cordis event semantics pass the event payload
 * as the final spread argument, and the test contract expects the session ref
 * (when present) to remain free of trace metadata.
 */
function attachTraceIdToEventArg(args: readonly unknown[], traceId: string): readonly unknown[] {
  const lastIndex = args.length - 1;
  if (lastIndex < 0) return args;
  const last = args[lastIndex];
  if (!last || typeof last !== "object" || Array.isArray(last)) return args;
  const next = args.slice();
  next[lastIndex] = { ...(last as Record<string, unknown>), traceId };
  return next;
}

export function emitContextEvent(
  context: ContextEventSink | null | undefined,
  event: string,
  args: readonly unknown[],
  traceId?: string,
  onError: PiEventErrorHandler = defaultOnError,
): void {
  if (!context) return;
  const logger = getBridgeLogger();
  const finalArgs = traceId === undefined ? args : attachTraceIdToEventArg(args, traceId);
  try {
    context.emit(event, ...finalArgs);
    withContext(logger, bridgeContext(event, traceId)).debug(
      { msg: "bridge.emit.ok", argCount: finalArgs.length },
      `emitted ${event}`,
    );
  } catch (error) {
    withContext(logger, bridgeContext(event, traceId)).error(
      { msg: "bridge.emit.failed" },
      `emit failed for ${event}`,
    );
    onError(event, error);
  }
}

/** Mirror one Pi session event onto the DeepSeek Harness-style event surface. */
export function emitPiSessionEvent(
  context: ContextEventSink | null | undefined,
  session: unknown,
  event: { type: string; [key: string]: unknown },
  traceId?: string,
  onError: PiEventErrorHandler = defaultOnError,
): void {
  emitContextEvent(context, "session/event", [session, event], traceId, onError);
  emitContextEvent(context, `pi/${event.type}`, [event], traceId, onError);
}

/**
 * In-memory ring buffer that replaces the legacy JSONL-backed session event
 * log. It accumulates the most recent `maxEntries` session/plugin events
 * emitted from main so the renderer can fetch a snapshot via the
 * `agent:event-log` IPC without going through SQLite or a JSONL mirror.
 *
 * Events flow in from two producers:
 *   1. `session.subscribe((event) => bridge.appendFromSession(event))` — pi
 *      AgentSession events captured at the bridge boundary.
 *   2. `emitPluginEvent(...)` — synthesized plugin lifecycle events that the
 *      renderer still wants to replay on startup.
 *
 * The buffer is process-local; persistence is the responsibility of the
 * downstream SQLite stores (session catalog, plugin-state, etc.). When main
 * exits the buffer is dropped.
 */
export class PiSessionEventBridge {
  private readonly maxEntries: number;
  private readonly entries: SessionEventRecord[] = [];
  private nextSequence = 0;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_RING_LIMIT));
  }

  /** Append an event produced by `session.subscribe`. */
  appendFromSession(event: { type: string; [key: string]: unknown }): SessionEventRecord {
    const sequence = this.allocateSequence();
    const record: SessionEventRecord = {
      eventVersion: 1,
      sequence,
      timestamp: new Date().toISOString(),
      type: event.type,
      payload: event,
    };
    this.pushBounded(record);
    return record;
  }

  /**
   * Append a plugin lifecycle event already shaped as a SessionEventRecord.
   * Preserves the caller-supplied sequence so the existing renderer ordering
   * stays monotonic with the previous on-disk log.
   */
  append(record: SessionEventRecord): void {
    this.pushBounded(record);
    this.nextSequence = Math.max(this.nextSequence, record.sequence);
  }

  snapshot(query: SessionEventLogQuery = {}): SessionEventRecord[] {
    const limit = query.limit === undefined
      ? this.maxEntries
      : Math.max(1, Math.min(this.maxEntries, Math.floor(query.limit)));
    return this.entries
      .filter((entry) => query.sessionId === undefined || entry.sessionId === query.sessionId)
      .filter((entry) => query.sinceSequence === undefined || entry.sequence > query.sinceSequence)
      .slice(-limit)
      .map((entry) => ({ ...entry }));
  }

  lastSequence(): number {
    return this.nextSequence;
  }

  /**
   * Async no-op kept for compatibility with the legacy `SessionEventLog.load()`
   * contract. The ring buffer is process-local; nothing is hydrated from disk
   * any more, so we simply return an empty snapshot.
   */
  async load(): Promise<SessionEventRecord[]> {
    return [];
  }

  /**
   * Async no-op kept for compatibility with the legacy `SessionEventLog.flush()`
   * contract. The bridge has no durable write queue to drain.
   */
  async flush(): Promise<void> {
    /* no durable writes to wait for */
  }

  clear(): void {
    this.entries.length = 0;
    this.nextSequence = 0;
  }

  private allocateSequence(): number {
    this.nextSequence += 1;
    return this.nextSequence;
  }

  private pushBounded(record: SessionEventRecord): void {
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }
}
