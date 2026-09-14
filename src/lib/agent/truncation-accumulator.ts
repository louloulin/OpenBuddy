/**
 * truncation-accumulator.ts — minimal pure subscriber that filters the
 * `openbuddy://plugin-event` stream for `session/input-truncated` events
 * and exposes them as a renderable list (plan4.4 §C).
 *
 * Why a dedicated module instead of inlining in a hook:
 *   - Pure: no React, no IPC, no Electron deps. Vitest covers it.
 *   - Reusable: the same accumulator can back a UI panel, a debug log,
 *     or a future telemetry sink without duplicating parsing logic.
 *   - Defensive: silently ignores unknown event types and malformed
 *     payloads so a corrupt future event from pi upstream never breaks
 *     the renderer.
 */
import {
  parseTruncationEvent,
  summarizeTruncationEvents,
  type TruncationEvent,
  type TruncationSummary,
} from "./truncation-event-parser";

/** Minimal event shape — mirrors OpenBuddyPluginEvent. */
export interface TruncationPluginEvent {
  type: string;
  payload: unknown;
  timestamp?: string;
}

export type TruncationListener = (event: TruncationEvent, receivedAt: string) => void;
export type TruncationUnlisten = () => void;

export interface TruncationAccumulator {
  /** Push one event into the accumulator. Filters by type + parses defensively. */
  handle(event: TruncationPluginEvent): void;
  /** Read-only snapshot of all parsed events in arrival order. */
  snapshot(): TruncationEvent[];
  /** Aggregate summary (dropped / totalChars / sessions) for the current log. */
  summary(): TruncationSummary;
  /** Forget all events. */
  clear(): void;
  /** Subscribe to parsed events. Returns an unlisten fn. */
  subscribe(listener: TruncationListener): TruncationUnlisten;
}

export function createTruncationAccumulator(): TruncationAccumulator {
  const log: TruncationEvent[] = [];
  const listeners = new Set<TruncationListener>();
  return {
    handle(event) {
      if (!event || typeof event !== "object") return;
      if (event.type !== "session/input-truncated") return;
      const parsed = parseTruncationEvent(event.payload);
      if (!parsed) return;
      log.push(parsed);
      const receivedAt = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
      for (const listener of listeners) {
        try {
          listener(parsed, receivedAt);
        } catch {
          // Defensive: a buggy listener must not break the stream.
        }
      }
    },
    snapshot() {
      return [...log];
    },
    summary() {
      return summarizeTruncationEvents(log);
    },
    clear() {
      log.length = 0;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}