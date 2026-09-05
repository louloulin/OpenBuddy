/**
 * eventStreamGrace.ts — Phase R3.0 (pi-web-alignment).
 *
 * Tracks activity on the pi event stream. If the stream goes silent for
 * longer than `EVENT_STREAM_IDLE_GRACE_MS` (30 s — pi-web parity) while
 * the agent should be producing output, we assume the connection is dead
 * and trigger a resubscribe via the provided callback.
 *
 * Generation counter prevents stale grace timers from firing after a
 * newer generation has been started (e.g. on session switch / agent
 * resubscribe). Each `startGrace()` call bumps the generation; the
 * timeout closure checks the captured generation before invoking the
 * callback.
 */
import { useCallback, useEffect, useRef } from "react";

export const EVENT_STREAM_IDLE_GRACE_MS = 30_000;

export interface UseEventStreamGraceOptions {
  /** True while the agent should be producing events (e.g. streaming). */
  active: boolean;
  /** Called when the grace timer expires without activity. */
  onExpire: (reason: "grace-expired") => void;
}

export interface EventStreamGraceHandle {
  /** Record that an event arrived — resets the grace timer. */
  recordActivity: () => void;
  /** Manually start the grace timer (e.g. on prompt send). */
  startGrace: () => void;
  /** Stop the grace timer (e.g. on completion or user cancel). */
  stopGrace: () => void;
}

/**
 * useEventStreamGrace — owner of the idle-grace timer. Pure, no React
 * state — the consumer reads the return value's methods.
 *
 * The implementation uses a monotonic `generationRef` so that any
 * previously-armed timer that hasn't fired is invalidated when a newer
 * grace period starts. This mirrors the
 * `eventStreamGraceGenerationRef` pattern in pi-web.
 */
export function useEventStreamGrace({
  active,
  onExpire,
}: UseEventStreamGraceOptions): EventStreamGraceHandle {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const stopGrace = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Bump the generation so any pending closure invalidates itself.
    generationRef.current += 1;
  }, []);

  const startGrace = useCallback(() => {
    stopGrace();
    const myGen = generationRef.current;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Generation check — if a newer grace started, ignore this expired one.
      if (myGen !== generationRef.current) return;
      if (!activeRef.current) return;
      onExpireRef.current("grace-expired");
    }, EVENT_STREAM_IDLE_GRACE_MS);
  }, [stopGrace]);

  const recordActivity = useCallback(() => {
    if (timerRef.current === null) return;
    // Re-arm the timer with a fresh generation so any in-flight closure
    // invalidates itself.
    startGrace();
  }, [startGrace]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      stopGrace();
    };
  }, [stopGrace]);

  // Auto-stop when active flips false.
  useEffect(() => {
    if (!active) stopGrace();
  }, [active, stopGrace]);

  return { recordActivity, startGrace, stopGrace };
}