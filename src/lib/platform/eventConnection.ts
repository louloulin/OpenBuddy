/**
 * eventConnection.ts — Phase R3.0 (pi-web-alignment).
 *
 * Connection lifecycle + reconnect logic for the Electron IPC event stream.
 *
 * pi-web uses `EventSource` (HTTP SSE) over `fetch`, with a reconnect
 * loop driven by the EventSource `onerror` handler. OpenBuddy uses
 * `window.api.listen()` over Electron IPC, which doesn't auto-reconnect
 * — if the main-process subscriber is disposed (e.g. window reload,
 * agent-died recovery, profile swap) the renderer must re-subscribe
 * manually or it will miss all subsequent `pi://*` events.
 *
 * This module provides:
 *   - `AgentEventConnection` — pure-async, zero-React class that owns
 *     the current `unlisten` handle and the reconnect timer.
 *   - `EVENT_STREAM_READY_TIMEOUT_MS` — 60 s readiness timeout (matches
 *     pi-web parity; longer than SSE because IPC startup includes the
 *     piInit bootstrap which can take 30+ s on cold start).
 *   - `EVENT_STREAM_RECONNECT_DELAY_MS` — 1 s back-off before each retry
 *     (matches pi-web parity).
 *
 * The existing `useAgentSession` hook subscribes once on mount and
 * handles its own `agent-died` resubscribe via the `resubscribe()`
 * return value. The connection class is exposed for callers that want
 * to drive their own reconnect policy — for example, an outer wrapper
 * that watches the bridge availability flag and reconnects when it
 * flaps.
 *
 * Tests live in `__tests__/eventConnection.test.ts`.
 */

import { listen, type UnlistenFn } from "@/lib/platform/electron-api";
import { isElectronBridgeUnavailable } from "@/lib/platform/electron-api";

export type AgentEventConnectionStatus = "ready" | "ready_timeout" | "startup_error" | "closed";

export class AgentEventConnectionError extends Error {
  readonly status: AgentEventConnectionStatus;
  constructor(status: AgentEventConnectionStatus, message?: string) {
    super(
      message ??
        (status === "ready_timeout"
          ? "Timed out starting the agent session. Please try again."
          : "Failed to connect to the agent event stream. Please try again."),
    );
    this.name = "AgentEventConnectionError";
    this.status = status;
  }
}

export interface AgentEventConnectionOptions {
  /** Subscribe to `pi://update` events. Called with each event payload. */
  onEvent: (event: unknown) => void;
  /** True while the caller wants the connection maintained. */
  shouldMaintain: () => boolean;
  /** Max ms to wait for the first event before declaring ready_timeout. */
  readinessTimeoutMs: number;
  /** Delay between reconnect attempts. */
  reconnectDelayMs: number;
  /** Optional callback for unexpected (non-recoverable) errors. */
  onUnexpectedError?: (error: unknown) => void;
}

/** pi-web parity. */
export const EVENT_STREAM_READY_TIMEOUT_MS = 60_000;
/** pi-web parity. */
export const EVENT_STREAM_RECONNECT_DELAY_MS = 1_000;

interface Connection {
  unlisten: UnlistenFn | null;
  ready: boolean;
}

/**
 * AgentEventConnection — owns the current `unlisten` handle and reconnects
 * on transient failures. Mirrors pi-web's EventSource wrapper, but adapted
 * for Electron's `listen()` IPC bridge.
 */
export class AgentEventConnection {
  private current: Connection | null = null;
  private retry: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
  private retryGeneration = 0;

  constructor(private readonly options: AgentEventConnectionOptions) {}

  /** True while a connection is open. */
  get isConnected(): boolean {
    return this.current !== null && this.current.ready;
  }

  /**
   * Ensure the connection is open. Idempotent — calling repeatedly is safe.
   * Returns the unlisten handle so callers can manually disconnect.
   */
  async ensureConnected(): Promise<UnlistenFn> {
    if (this.current && this.current.ready) return this.current.unlisten!;
    if (!this.options.shouldMaintain()) {
      throw new AgentEventConnectionError("closed", "Caller opted out of the connection.");
    }
    return this.open();
  }

  /** Tear down the connection + cancel any pending reconnect. */
  close(): void {
    this.stopRetrying();
    if (this.current) {
      try {
        this.current.unlisten?.();
      } catch {
        /* noop */
      }
      this.current = null;
    }
  }

  /** Schedule a reconnect after `reconnectDelayMs`. */
  scheduleRetry(): void {
    this.stopRetrying();
    const myGen = this.retryGeneration;
    this.retry.timer = setTimeout(() => {
      this.retry.timer = null;
      if (myGen !== this.retryGeneration) return;
      if (!this.options.shouldMaintain()) return;
      try {
        void this.open().catch((err) => {
          if (isElectronBridgeUnavailable(err)) {
            this.options.onUnexpectedError?.(err);
            return;
          }
          if (err instanceof AgentEventConnectionError && err.status === "startup_error") {
            this.options.onUnexpectedError?.(err);
            return;
          }
          // Transient — try again.
          this.scheduleRetry();
        });
      } catch (e) {
        this.options.onUnexpectedError?.(e);
      }
    }, this.options.reconnectDelayMs);
  }

  private stopRetrying(): void {
    if (this.retry.timer !== null) {
      clearTimeout(this.retry.timer);
      this.retry.timer = null;
    }
    this.retryGeneration += 1;
  }

  private async open(): Promise<UnlistenFn> {
    this.close();
    let ready = false;
    let unlisten: UnlistenFn | null = null;
    const conn: Connection = { unlisten: null, ready: false };

    const readyTimer = setTimeout(() => {
      if (!ready) {
        // Best-effort tear-down so the dangling IPC handle doesn't leak.
        try {
          unlisten?.();
        } catch {
          /* noop */
        }
        if (this.current === conn) this.current = null;
        throw new AgentEventConnectionError("ready_timeout");
      }
    }, this.options.readinessTimeoutMs);

    try {
      unlisten = await listen("pi://update", (event: unknown) => {
        const payload = (event as { payload?: unknown } | undefined)?.payload ?? event;
        if (!ready) {
          ready = true;
          conn.ready = true;
          clearTimeout(readyTimer);
        }
        try {
          this.options.onEvent(payload);
        } catch (err) {
          this.options.onUnexpectedError?.(err);
        }
      });
      conn.unlisten = unlisten;
      this.current = conn;
      return unlisten;
    } catch (err) {
      clearTimeout(readyTimer);
      if (isElectronBridgeUnavailable(err)) {
        throw new AgentEventConnectionError("closed", String(err));
      }
      throw new AgentEventConnectionError("startup_error", String(err));
    }
  }
}