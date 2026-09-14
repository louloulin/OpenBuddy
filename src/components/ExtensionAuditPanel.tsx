/**
 * ExtensionAuditPanel — display-only consumer of `useExtensionAuditPanel()`
 * (plan4.5 §A).
 *
 * Renders the latest extension-policy report as:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ Extension Audit · last updated 2026-09-13 02:00 UTC    │
 *   │                                                        │
 *   │  1 allowed   1 denied   1 needs-review   4 decisions   │
 *   │                                                        │
 *   │  pi-sketchy       [deny]         not allowlisted       │
 *   │  pi-untested      [needs-review] manual review         │
 *   │  pi-mcp-adapter   [allow]        allowlisted            │
 *   │  openbuddy-...    [allow]        builtin                │
 *   │                                          [Clear log]   │
 *   └────────────────────────────────────────────────────────┘
 *
 * Design constraints (mirrors `StatusPill.tsx`):
 *   - Display-only: no store writes, no timers, no IPC callbacks.
 *   - All state derivation lives in the hook (the panel just renders).
 *   - Action rows are visually tagged via `data-action="allow|deny|needs-review"`
 *     so CSS can tone them (deny = red, needs-review = amber, allow = neutral).
 */
export interface ExtensionPolicyEditorProps {
  initial?: { allowlistPackageNames: string[]; denylistPackageNames: string[] };
  onSaved?: (policy: { allowlistPackageNames: string[]; denylistPackageNames: string[] }) => void;
}

export function ExtensionPolicyEditor({ initial, onSaved }: ExtensionPolicyEditorProps) {
  const [allowlist, setAllowlist] = useState(initial?.allowlistPackageNames.join("\n") ?? "");
  const [denylist, setDenylist] = useState(initial?.denylistPackageNames.join("\n") ?? "");
  const [status, setStatus] = useState<string>("");
  const save = async () => {
    const parse = (value: string) => [...new Set(value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean))];
    try {
      const result = await extensionPolicySave({ allowlistPackageNames: parse(allowlist), denylistPackageNames: parse(denylist) });
      setStatus("Policy refreshed");
      onSaved?.(result.policy);
    } catch {
      setStatus("Unable to refresh policy");
    }
  };
  return <div className="extension-policy-editor" data-testid="extension-policy-editor">
    <label>Allowlist packages<textarea value={allowlist} onChange={(event) => setAllowlist(event.target.value)} /></label>
    <label>Denylist packages<textarea value={denylist} onChange={(event) => setDenylist(event.target.value)} /></label>
    <button type="button" onClick={save}>Save and refresh</button>
    {status && <output role="status">{status}</output>}
  </div>;
}
import { memo, useMemo, useState } from "react";
import { extensionPolicySave } from "../lib/agent/pi-client";
import { useExtensionAuditPanel } from "../hooks/useExtensionAuditPanel";
import type { ExtensionAuditDecision } from "../lib/agent/extension-audit-event-parser";

export interface ExtensionAuditPanelProps {
  /**
   * Optional override for the hook result. When omitted the panel reads
   * from `useExtensionAuditPanel()`. Useful for tests + Storybook
   * snapshots that want to pin the panel to a deterministic state.
   */
  hookResult?: ReturnType<typeof useExtensionAuditPanel>;
  /** Additional class names appended to the root `<section>`. */
  className?: string;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "awaiting first report";
  // Keep the format stable so SSR + CSR don't disagree on the initial
  // paint (the hook is empty until the first event arrives).
  return `last updated ${iso}`;
}

function actionLabel(action: ExtensionAuditDecision["action"]): string {
  switch (action) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "needs-review":
      return "needs-review";
    default:
      return action;
  }
}

function ExtensionAuditPanelInner({
  hookResult,
  className,
}: ExtensionAuditPanelProps) {
  const hook = useExtensionAuditPanel();
  const { reports, summary, clear } = hookResult ?? hook;
  const latestReport = useMemo(() => {
    if (reports.length === 0) return null;
    // Reports arrive in insertion order; the last one is the most recent.
    return reports[reports.length - 1];
  }, [reports]);
  const hasReports = latestReport !== null;

  return (
    <section
      className={`extension-audit-panel${className ? ` ${className}` : ""}`}
      data-testid="extension-audit-panel"
      data-report-count={reports.length}
      aria-live="polite"
      aria-atomic="false"
    >
      <header className="extension-audit-panel__header">
        <h3 className="extension-audit-panel__title">Extension Audit</h3>
        <span
          className="extension-audit-panel__timestamp"
          data-testid="extension-audit-timestamp"
        >
          {formatTimestamp(summary.latest)}
        </span>
      </header>

      {hasReports && latestReport ? (
        <>
          <dl className="extension-audit-panel__summary" data-testid="extension-audit-summary">
            <div className="extension-audit-panel__metric" data-tone="allow">
              <dt>Allowed</dt>
              <dd data-testid="extension-audit-allowed">{summary.totalAllowed}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="deny">
              <dt>Denied</dt>
              <dd data-testid="extension-audit-denied">{summary.totalDenied}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="needs-review">
              <dt>Needs review</dt>
              <dd data-testid="extension-audit-needs-review">
                {summary.totalNeedsReview}
              </dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="resolves">
              <dt>Resolves</dt>
              <dd data-testid="extension-audit-resolves">{summary.reports}</dd>
            </div>
            <div className="extension-audit-panel__metric" data-tone="total">
              <dt>Decisions</dt>
              <dd data-testid="extension-audit-last-decision-count">
                {summary.lastDecisionCount}
              </dd>
            </div>
          </dl>

          <ul
            className="extension-audit-panel__rows"
            data-testid="extension-audit-rows"
          >
            {latestReport.decisions.map((decision) => (
              <li
                key={`${decision.id}::${decision.packageName ?? ""}`}
                className="extension-audit-panel__row"
                data-testid="extension-audit-row"
                data-decision-id={decision.id}
                data-action={decision.action}
              >
                <span className="extension-audit-panel__row-id">{decision.id}</span>
                <span
                  className="extension-audit-panel__action"
                  data-testid={`extension-audit-action-${decision.action}`}
                >
                  {actionLabel(decision.action)}
                </span>
                <span className="extension-audit-panel__reason">{decision.reason}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="extension-audit-panel__clear"
            data-testid="extension-audit-clear"
            onClick={() => clear()}
          >
            Clear log
          </button>
        </>
      ) : (
        <p
          className="extension-audit-panel__empty"
          data-testid="extension-audit-empty"
        >
          {`Extension Audit panel awaiting the first pi/extension-policy-report from the agent host (${summary.reports} reports received so far).`}
        </p>
      )}
    </section>
  );
}

export const ExtensionAuditPanel = memo(ExtensionAuditPanelInner);
