/**
 * extension-audit-accumulator.ts — minimal pure subscriber that filters
 * the `openbuddy://plugin-event` stream for `pi/extension-policy-report`
 * events and exposes them as a renderable log (plan4.5 §A, closes the
 * policy-report → renderer gap identified in audit round 10).
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
  parseExtensionAuditReport,
  summarizeExtensionAuditReports,
  type ExtensionAuditReport,
  type ExtensionAuditSummary,
} from "./extension-audit-event-parser";

/** Minimal event shape — mirrors OpenBuddyPluginEvent. */
export interface ExtensionAuditPluginEvent {
  type: string;
  payload: unknown;
  timestamp?: string;
}

export type ExtensionAuditListener = (
  report: ExtensionAuditReport,
  receivedAt: string,
) => void;
export type ExtensionAuditUnlisten = () => void;

export interface ExtensionAuditAccumulator {
  /** Push one event into the accumulator. Returns true when accepted. */
  handle(event: ExtensionAuditPluginEvent): boolean;
  /** Read-only snapshot of all parsed reports in arrival order. */
  snapshot(): ExtensionAuditReport[];
  /** Aggregate summary (counts from the latest report + total reports). */
  summary(): ExtensionAuditSummary;
  /** Forget all reports. */
  clear(): void;
  /** Subscribe to parsed reports. Returns an unlisten fn. */
  subscribe(listener: ExtensionAuditListener): ExtensionAuditUnlisten;
}

export function createExtensionAuditAccumulator(): ExtensionAuditAccumulator {
  const log: ExtensionAuditReport[] = [];
  const listeners = new Set<ExtensionAuditListener>();
  return {
    handle(event) {
      if (!event || typeof event !== "object") return false;
      if (event.type !== "pi/extension-policy-report") return false;
      const parsed = parseExtensionAuditReport(event.payload);
      if (!parsed) return false;
      log.push(parsed);
      const receivedAt =
        typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
      for (const listener of listeners) {
        try {
          listener(parsed, receivedAt);
        } catch {
          // Defensive: a buggy listener must not break the stream.
        }
      }
      return true;
    },
    snapshot() {
      return [...log];
    },
    summary() {
      return summarizeExtensionAuditReports(log);
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
