import { useCallback, useEffect, useRef, useState } from "react";
import { agentOnPluginEvent } from "../lib/agent/pi-client";
import {
  createExtensionAuditAccumulator,
  type ExtensionAuditAccumulator,
  type ExtensionAuditPluginEvent,
} from "../lib/agent/extension-audit-accumulator";
import type {
  ExtensionAuditReport,
  ExtensionAuditSummary,
} from "../lib/agent/extension-audit-event-parser";

/**
 * useExtensionAuditPanel — React hook that subscribes the renderer to
 * `pi/extension-policy-report` plugin events emitted by the agent-host
 * (plan4.5 §A, closes the policy-report → renderer gap identified in
 * audit round 10).
 *
 * The hook owns a single `ExtensionAuditAccumulator` for the lifetime of
 * the component and re-renders the host when a new policy report arrives
 * so the Extension Audit panel can show "N allowed · M denied · K
 * needs-review" in real time.
 *
 * Pure hook — no DOM, no IPC channels outside the documented
 * `openbuddy://plugin-event` listener. SSR-safe (the `agentOnPluginEvent`
 * call is gated behind `useEffect`).
 */
export interface UseExtensionAuditPanelResult {
  reports: ExtensionAuditReport[];
  summary: ExtensionAuditSummary;
  clear: () => void;
}

export function useExtensionAuditPanel(): UseExtensionAuditPanelResult {
  const accumulatorRef = useRef<ExtensionAuditAccumulator | null>(null);
  if (accumulatorRef.current === null) {
    accumulatorRef.current = createExtensionAuditAccumulator();
  }
  const accumulator = accumulatorRef.current;
  const [reports, setReports] = useState<ExtensionAuditReport[]>(() => accumulator.snapshot());
  const [summary, setSummary] = useState<ExtensionAuditSummary>(() => accumulator.summary());

  const refresh = useCallback(() => {
    setReports(accumulator.snapshot());
    setSummary(accumulator.summary());
  }, [accumulator]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const dispose = await agentOnPluginEvent((event: ExtensionAuditPluginEvent) => {
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
        // show extension audit telemetry until the IPC channel recovers.
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

  return { reports, summary, clear };
}
