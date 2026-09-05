import { webContents, type BrowserWindow, type WebContents } from "electron";
import { createMainLogger } from "@openbuddy/logging-main";

const moduleLogger = createMainLogger({ name: "pi-bridge-send-safe" });

const SAFE_CHANNEL_PREFIX = "safe::";
const DEFAULT_THROTTLE_MS = 30_000;
const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_STARTUP_DELAY_MS = 5_000;
const BROADCAST_CHANNEL = "electron-bridge-status";
const UNAVAILABLE_CHANNEL = "bridge:unavailable";

let unavailableThrottleState: { lastReason: string; lastAt: number } | null = null;

export interface SendSafeOptions {
  traceId?: string;
}

export interface BridgeStatusPayload {
  available: boolean;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  lastUpdated: number;
}

export function sendSafe(
  win: BrowserWindow | null | undefined,
  channel: string,
  payload: unknown,
  opts: SendSafeOptions = {},
): boolean {
  if (!win) {
    moduleLogger.warn({ channel, traceId: opts.traceId, reason: "null-window" }, "sendSafe skipped");
    return false;
  }
  if (win.isDestroyed()) {
    moduleLogger.warn({ channel, traceId: opts.traceId, reason: "window-destroyed" }, "sendSafe skipped");
    return false;
  }
  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) {
    moduleLogger.warn({ channel, traceId: opts.traceId, reason: "webcontents-destroyed" }, "sendSafe skipped");
    return false;
  }
  try {
    contents.send(channel, payload);
    return true;
  } catch (error) {
    moduleLogger.warn({ channel, traceId: opts.traceId, err: String(error) }, "sendSafe threw");
    return false;
  }
}

/**
// P2-07: Fast-path send for streaming deltas where we already have a
// validated WebContents reference and the window is alive. Skips the
// `isDestroyed()` double-check (one for BrowserWindow + one for
// WebContents) and the moduleLogger warn paths. Designed for the
// streaming hot path that calls ~60 times/sec; saves ~1-2µs per call
// (each isDestroyed is a system call into Chromium).
//
// Pre-conditions:
//   - caller has just confirmed win is alive in this microtask
//   - contents reference is stable for the call
//   - the caller is OK with send() throwing synchronously (it shouldn't
//     for normal IPC, but the slow path handles edge cases)
//
// Returns true on success; false if a synchronous throw occurred.
*/
export function sendSafeFast(contents: WebContents, channel: string, payload: unknown): boolean {
  try {
    contents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
}

export function sendSafeToContents(
  contents: WebContents | null | undefined,
  channel: string,
  payload: unknown,
  opts: SendSafeOptions = {},
): boolean {
  if (!contents) {
    moduleLogger.warn({ channel, traceId: opts.traceId, reason: "null-contents" }, "sendSafe skipped");
    return false;
  }
  if (contents.isDestroyed()) {
    moduleLogger.warn({ channel, traceId: opts.traceId, reason: "contents-destroyed" }, "sendSafe skipped");
    return false;
  }
  try {
    contents.send(channel, payload);
    return true;
  } catch (error) {
    moduleLogger.warn({ channel, traceId: opts.traceId, err: String(error) }, "sendSafe threw");
    return false;
  }
}

export interface SendSafeAllResult {
  sent: number;
  skipped: number;
}

export function sendSafeAll(
  channel: string,
  payload: unknown,
  opts: SendSafeOptions = {},
): SendSafeAllResult {
  const all = webContents.getAllWebContents();
  let sent = 0;
  let skipped = 0;
  for (const contents of all) {
    if (sendSafeToContents(contents, channel, payload, opts)) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

export function notifyBridgeUnavailable(
  reason: string,
  throttleMs: number = DEFAULT_THROTTLE_MS,
): boolean {
  const now = Date.now();
  if (unavailableThrottleState) {
    if (now - unavailableThrottleState.lastAt < throttleMs) {
      return false;
    }
  }
  unavailableThrottleState = { lastReason: reason, lastAt: now };
  const { sent } = sendSafeAll(UNAVAILABLE_CHANNEL, { reason, at: now });
  return sent > 0;
}

export function resetNotifyBridgeUnavailableForTests(): void {
  unavailableThrottleState = null;
}

// =============================================================================
// P0-03 — Streaming delta coalescer
// =============================================================================
//
// The Pi SDK emits one `assistantMessageEvent: text_delta` per token. Sending a
// full `pi://update` IPC per token produces ~50-150 IPC/sec during streaming,
// each carrying a structured-clone of `{ sessionId, type, content: [{type, text}] }`.
// PERFORMANCE.md commits to a 16ms coalesce window (matches one animation frame
// at 60fps) which collapses ~3 tokens per frame into one IPC.
//
// Behaviour:
//   - `enqueue(delta)` accumulates text. First token arms a 16ms setTimeout.
//   - On timeout, the buffer is flushed as a single IPC.
//   - If the buffer grows past `maxBufferBytes` (e.g. backpressure / large tool
//     result), flush eagerly to bound memory.
//   - `flush()` is also exposed for shutdown (e.g. `agent_end`) so we don't
//     drop trailing tokens.
//   - `dispose()` cancels the pending timer (no further IPC after window close).
//
// The renderer still receives a `pi://update` with `{ type: "agent_message_chunk",
// content: [{ type: "text", text: <accumulated> }] }` — same wire shape, just
// fewer events. ChatView's streaming reducer is unchanged; it appends to its
// current delta string regardless of how many tokens per IPC.
export interface StreamingCoalescer<T = unknown> {
  enqueue: (delta: string) => void;
  flush: () => void;
  dispose: () => void;
  /**
   * Update the per-flush context (e.g. sessionId can change between
   * turns / tool calls; the next emitted payload will use the new context).
   */
  setContext: (next: T) => void;
}

export interface StreamingCoalescerOptions<T> {
  /** Time window in ms before a pending buffer is flushed. Default 16. */
  windowMs?: number;
  /** Soft cap on buffer size — exceeding this flushes eagerly. Default 64KB. */
  maxBufferBytes?: number;
  /**
   * Called with the accumulated text + opaque session context.
   * Throwing here is logged but does not affect the coalescer.
   */
  emit: (accumulated: string, sessionContext: T) => void;
  /** Per-flush context carried through (e.g. sessionId, type tag, contents). */
  sessionContext: T;
}

/**
 * NOTE: currently has no production consumer — only `send-safe.test.ts`.
 *
 * Its one caller lived in `electron/main/ipc/index.ts`, coalescing assistant
 * `text_delta`s into 16ms batches. That caller was removed because Phase R3.0
 * had made it a *second* emitter alongside `handle-session-event.ts`: every
 * delta went out twice in two different wire shapes (the renderer rendered
 * "DIDIAG-OKAG-OK"), and reasoning deltas were misrouted onto the visible-text
 * channel. Deleting it also halved live-stream IPC traffic, so the perf win it
 * was originally added for had already been inverted.
 *
 * Kept rather than deleted because the mechanism is sound and tested, and the
 * obvious next consumer already exists: `tool_execution_update` forwards raw
 * `partialResult` payloads per tick with no batching. If that stays unbatched,
 * delete this and its tests instead of leaving tested-but-unused code around.
 */
export function createStreamingCoalescer<T>(
  options: StreamingCoalescerOptions<T>,
): StreamingCoalescer<T> {
  const windowMs = options.windowMs ?? 16;
  const maxBufferBytes = options.maxBufferBytes ?? 64 * 1024;
  const emit = options.emit;
  // Mutable holder so setContext() can update the value used by the next flush().
  const sessionContextHolder: { value: T } = { value: options.sessionContext };

  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!buffer) return;
    const out = buffer;
    buffer = "";
    emit(out, sessionContextHolder.value);
  };

  const enqueue = (delta: string) => {
    if (disposed || !delta) return;
    buffer += delta;
    if (buffer.length >= maxBufferBytes) {
      flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(flush, windowMs);
    }
  };

  const dispose = () => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    buffer = "";
  };

  const setContext = (next: T) => {
    sessionContextHolder.value = next;
  };

  return { enqueue, flush, dispose, setContext };
}

export interface BridgeStatusSnapshotProvider {
  (): BridgeStatusPayload;
}

export interface BridgeStatusBroadcaster {
  start(provider?: BridgeStatusSnapshotProvider): void;
  stop(): void;
  isRunning(): boolean;
}

export function createBridgeStatusBroadcaster(
  options: {
    intervalMs?: number;
    startupDelayMs?: number;
    channel?: string;
  } = {},
): BridgeStatusBroadcaster {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const startupDelayMs = options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
  const channel = options.channel ?? BROADCAST_CHANNEL;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let provider: BridgeStatusSnapshotProvider | null = null;
  let running = false;

  function broadcastOnce(): void {
    if (!provider) return;
    const payload = provider();
    sendSafeAll(channel, payload);
  }

  return {
    start(p: BridgeStatusSnapshotProvider = () => ({
      available: true,
      consecutiveFailures: 0,
      lastErrorMessage: null,
      lastUpdated: Date.now(),
    })) {
      if (running) return;
      running = true;
      provider = p;
      startupTimer = setTimeout(() => {
        startupTimer = null;
        broadcastOnce();
        timer = setInterval(broadcastOnce, intervalMs);
      }, startupDelayMs);
    },
    stop() {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      running = false;
      provider = null;
    },
    isRunning() {
      return running;
    },
  };
}

export const SAFE_BRIDGE_CONSTANTS = {
  DEFAULT_THROTTLE_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_STARTUP_DELAY_MS,
  BROADCAST_CHANNEL,
  UNAVAILABLE_CHANNEL,
  SAFE_CHANNEL_PREFIX,
} as const;
