/**
 * AgentEventConnection — bridge lifecycle abstraction.
 *
 * Why this exists (Phase pi-web-alignment):
 *
 * pi-web sits behind an SSE EventSource — when the network drops or the
 * tab is backgrounded, the underlying stream closes and the connection
 * gracefully reconnects. OpenBuddy's renderer talks to a dedicated
 * Electron preload channel (`subscribePiEvents` → `window.api.events.on`
 * over IPC) which is *always on*, but the bridge itself can become
 * unhealthy in three observable ways:
 *
 *   1. `agent-died` fires when the main-process PiSession wrapper crashes.
 *   2. The preload module reloads (HMR / Electron reload) and the channel
 *      silently re-opens on a fresh socket.
 *   3. The user backgrounds the tab and the OS coalesces events; a burst
 *      of late events lands once the tab refocuses.
 *
 * The historical `useAgentSession` hook handles case 1 with a manual
 * `resubscribe` callable, but doesn't:
 *
 *   - Schedule a 30-second idle grace before tearing down the bridge, so
 *     extension-queued agent runs (which emit no `prompt_done` for the
 *     original `agent_end`) keep the SSE connection warm
 *   - Allocate a monotonic `runId` so late events from a finished prompt
 *     can't resurrect a stale streaming bubble
 *
 * This module exports the bridge contract used by the renderer. It
 * deliberately does NOT own a `useEffect` — the React shell decides
 * when to mount/unmount, but every consumer benefits from the same
 * lifecycle bookkeeping.
 */

import { isElectronBridgeUnavailable } from "@/lib/platform/electron-api";

/** Default grace window before tearing down the bridge after the last
 *  prompt_done / agent_settled event. Mirrors pi-web's
 *  `EVENT_STREAM_IDLE_GRACE_MS` (30s). Long enough for extension-queued
 *  follow-up runs that emit no prompt_done to keep the channel warm. */
export const DEFAULT_IDLE_GRACE_MS = 30_000;

export interface AgentEventConnectionOptions {
  /** Provider that subscribes to all pi events. The connection calls this
   *  exactly once per `ensureConnected` cycle and disposes the returned
   *  unlisten on `close()` or before a re-subscribe. */
  subscribe: () => Promise<() => void>;
  /** Optional callback fired when a re-subscribe cycle completes — useful
   *  for tests + telemetry. */
  onResubscribed?: () => void;
  /** Optional callback fired when the bridge closes for good after the
   *  idle grace timer elapses. */
  onClosed?: () => void;
  /** Override the idle grace window (default 30s). */
  idleGraceMs?: number;
}

export interface AgentEventConnection {
  /** Ensure the bridge is open. Idempotent — if already connected, this
   *  returns immediately. Otherwise it re-subscribes. The returned
   *  promise resolves once the subscribe completes (or rejects if the
   *  bridge is unavailable — caller's responsibility to handle). */
  ensureConnected(): Promise<void>;
  /** Signal that the agent is currently busy. Cancels any pending grace
   *  close and re-opens the bridge if it was previously torn down. */
  markBusy(): void;
  /** Signal that the agent has settled. Arms the idle grace timer; if no
   *  `markBusy()` arrives before the timer fires, the bridge is torn down
   *  and `onClosed` is fired. */
  markIdle(): void;
  /** Tear down the bridge immediately. Cancels any pending grace timer. */
  close(): void;
  /** Allocate the next run id. Every `prompt` call from the React shell
   *  bumps this so late SSE events can be ignored if they arrive after
   *  the run settled. */
  nextRunId(): number;
  /** True if the connection has ever been opened in this lifetime. */
  readonly hasConnected: boolean;
}

export function createAgentEventConnection(
  options: AgentEventConnectionOptions,
): AgentEventConnection {
  const idleGraceMs = options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
  let unlisten: (() => void) | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let _hasConnected = false;
  let _runId = 0;

  const cancelGrace = (): void => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  const closeNow = (): void => {
    cancelGrace();
    const handle = unlisten;
    unlisten = null;
    if (handle) {
      try {
        handle();
      } catch {
        /* noop */
      }
    }
  };

  const armGrace = (): void => {
    cancelGrace();
    if (!unlisten) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      closeNow();
      options.onClosed?.();
    }, idleGraceMs);
  };

  return {
    get hasConnected() {
      return _hasConnected;
    },

    async ensureConnected() {
      if (unlisten) return;
      try {
        const handle = await options.subscribe();
        unlisten = () => {
          try {
            handle();
          } catch {
            /* noop */
          }
        };
        _hasConnected = true;
        cancelGrace();
        options.onResubscribed?.();
      } catch (err) {
        if (isElectronBridgeUnavailable(err)) {
          throw err;
        }
        throw err;
      }
    },

    markBusy() {
      cancelGrace();
      if (!unlisten) {
        void this.ensureConnected().catch(() => {
          // Caller is expected to surface bridge errors separately.
        });
      }
    },

    markIdle() {
      if (!unlisten) return;
      armGrace();
    },

    close() {
      closeNow();
    },

    nextRunId() {
      _runId += 1;
      return _runId;
    },
  };
}

/** Predicate helper: returns `true` when any of the supplied signals is
 *  true. Useful for callers that need to combine "agent running", "bash
 *  running", "compacting", etc. into a single bridge-busy decision. */
export function anyBusy(...signals: boolean[]): boolean {
  return signals.some(Boolean);
}
