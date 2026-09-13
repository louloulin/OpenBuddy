import { useCallback, useEffect, useRef, useState } from "react";
import { agentOnPluginEvent } from "../lib/agent/pi-client";
import {
  createTruncationAccumulator,
  type TruncationAccumulator,
  type TruncationPluginEvent,
} from "../lib/agent/truncation-accumulator";
import type {
  TruncationEvent,
  TruncationSummary,
} from "../lib/agent/truncation-event-parser";

/**
 * useTruncationPanel — React hook that subscribes the renderer to
 * `session/input-truncated` plugin events emitted by the agent-host
 * (plan4.4 §C, closes the truncator → consumer gap identified in audit
 * round 5).
 *
 * The hook owns a single `TruncationAccumulator` for the lifetime of the
 * component and re-renders the host when a new truncation event arrives
 * so the truncation panel can show "N blocks dropped" in real time.
 *
 * Pure hook — no DOM, no IPC channels outside the documented
 * `openbuddy://plugin-event` listener. SSR-safe (the `agentOnPluginEvent`
 * call is gated behind `useEffect`).
 */
export interface UseTruncationPanelResult {
  events: TruncationEvent[];
  summary: TruncationSummary;
  clear: () => void;
}

export function useTruncationPanel(): UseTruncationPanelResult {
  const accumulatorRef = useRef<TruncationAccumulator | null>(null);
  if (accumulatorRef.current === null) {
    accumulatorRef.current = createTruncationAccumulator();
  }
  const accumulator = accumulatorRef.current;
  const [events, setEvents] = useState<TruncationEvent[]>(() => accumulator.snapshot());
  const [summary, setSummary] = useState<TruncationSummary>(() => accumulator.summary());

  const refresh = useCallback(() => {
    setEvents(accumulator.snapshot());
    setSummary(accumulator.summary());
  }, [accumulator]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const dispose = await agentOnPluginEvent((event: TruncationPluginEvent) => {
          accumulator.handle(event);
          refresh();
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch {
        // Subscription failure is non-fatal: the renderer simply won't
        // show truncation telemetry until the IPC channel recovers.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [accumulator, refresh]);

  const clear = useCallback(() => {
    accumulator.clear();
    refresh();
  }, [accumulator, refresh]);

  return { events, summary, clear };
}