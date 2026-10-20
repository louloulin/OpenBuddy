/**
 * extension-audit-event-parser.ts — renderer-side consumer for the
 * `pi/extension-policy-report` plugin event emitted by
 * `electron/main/agent/pi-extensions.ts::resolvePiExtensions` whenever
 * OpenBuddy resolves the active pi extension set (plan4.5 §A, closes
 * the policy-report → renderer gap identified in audit round 10).
 *
 * The payload shape is the contract between main and renderer:
 *
 *   {
 *     generatedAt: ISO8601 string,
 *     total:       number,        // total specs evaluated
 *     allowed:     number,        // action === "allow"
 *     denied:      number,        // action === "deny"
 *     needsReview: number,        // action === "needs-review"
 *     decisions: Array<{
 *       id: string,
 *       packageName?: string,
 *       builtIn?: boolean,
 *       action: "allow" | "deny" | "needs-review",
 *       reason: string,
 *     }>
 *   }
 *
 * This module is pure: it validates + normalises the incoming payload so
 * the React-side hook + Extension Audit panel can trust the shape and
 * never see a malformed event. Defensive defaults + null-on-error so a
 * corrupt payload from a future pi extension version never crashes the
 * renderer.
 */

export type ExtensionAuditAction = "allow" | "deny" | "needs-review";

export interface ExtensionAuditDecision {
  id: string;
  packageName?: string;
  builtIn?: boolean;
  action: ExtensionAuditAction;
  reason: string;
}

export interface ExtensionAuditReport {
  generatedAt: string;
  total: number;
  allowed: number;
  denied: number;
  needsReview: number;
  decisions: ExtensionAuditDecision[];
}

export interface ExtensionAuditSummary {
  /** ISO8601 timestamp of the most recent report, or null when no reports yet. */
  latest: string | null;
  /** Number of reports observed (each `resolvePiExtensions` call emits one). */
  reports: number;
  /** Allowed count from the most recent report. */
  totalAllowed: number;
  /** Denied count from the most recent report. */
  totalDenied: number;
  /** Needs-review count from the most recent report. */
  totalNeedsReview: number;
  /** Number of decisions in the most recent report. */
  lastDecisionCount: number;
}

const VALID_ACTIONS: readonly ExtensionAuditAction[] = ["allow", "deny", "needs-review"];

function isDecision(value: unknown): value is ExtensionAuditDecision {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.length === 0) return false;
  if (typeof d.action !== "string" || !VALID_ACTIONS.includes(d.action as ExtensionAuditAction)) return false;
  if (typeof d.reason !== "string") return false;
  if (d.packageName !== undefined && typeof d.packageName !== "string") return false;
  if (d.builtIn !== undefined && typeof d.builtIn !== "boolean") return false;
  return true;
}

/**
 * Type guard — does the raw payload look like a `ExtensionAuditReport`?
 * Cheap structural check used by the hook to filter the plugin event
 * stream before paying for full parsing.
 */
export function isExtensionAuditReport(value: unknown): value is ExtensionAuditReport {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.generatedAt !== "string" || r.generatedAt.length === 0) return false;
  if (typeof r.total !== "number" || !Number.isFinite(r.total) || r.total < 0) return false;
  if (typeof r.allowed !== "number" || !Number.isFinite(r.allowed) || r.allowed < 0) return false;
  if (typeof r.denied !== "number" || !Number.isFinite(r.denied) || r.denied < 0) return false;
  if (typeof r.needsReview !== "number" || !Number.isFinite(r.needsReview) || r.needsReview < 0) return false;
  if (!Array.isArray(r.decisions)) return false;
  // Every decision must have a valid action literal — `parseExtensionAuditReport`
  // is forgiving and skips malformed entries, but the type guard is strict so
  // a corrupt report cannot enter the renderer pipeline.
  for (const d of r.decisions) {
    if (!d || typeof d !== "object") return false;
    const decision = d as Record<string, unknown>;
    if (typeof decision.id !== "string" || decision.id.length === 0) return false;
    if (typeof decision.action !== "string" || !VALID_ACTIONS.includes(decision.action as ExtensionAuditAction)) return false;
    if (typeof decision.reason !== "string") return false;
  }
  return true;
}

/**
 * Parse + normalise a raw payload. Returns `null` for anything that is
 * not structurally valid at the top level. Normalises:
 *   - all counts are rounded to integers
 *   - per-spec decisions are filtered through `isDecision` so a single
 *     malformed entry can't poison the entire panel
 *   - invariant check: total === allowed + denied + needsReview
 *
 * Note: `parseExtensionAuditReport` is intentionally more forgiving than
 * `isExtensionAuditReport` — the type guard rejects any payload with a
 * single malformed decision, but the parser keeps well-formed decisions
 * so a corrupt future event degrades gracefully instead of erasing the
 * entire audit panel.
 */
export function parseExtensionAuditReport(value: unknown): ExtensionAuditReport | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.generatedAt !== "string" || r.generatedAt.length === 0) return null;
  if (typeof r.total !== "number" || !Number.isFinite(r.total) || r.total < 0) return null;
  if (typeof r.allowed !== "number" || !Number.isFinite(r.allowed) || r.allowed < 0) return null;
  if (typeof r.denied !== "number" || !Number.isFinite(r.denied) || r.denied < 0) return null;
  if (typeof r.needsReview !== "number" || !Number.isFinite(r.needsReview) || r.needsReview < 0) return null;
  const total = Math.round(r.total);
  const allowed = Math.round(r.allowed);
  const denied = Math.round(r.denied);
  const needsReview = Math.round(r.needsReview);
  if (allowed + denied + needsReview !== total) return null;
  const decisions: ExtensionAuditDecision[] = [];
  if (Array.isArray(r.decisions)) {
    for (const entry of r.decisions) {
      if (!isDecision(entry)) continue;
      decisions.push({
        id: entry.id,
        packageName: entry.packageName,
        builtIn: entry.builtIn,
        action: entry.action,
        reason: entry.reason,
      });
    }
  }
  return {
    generatedAt: r.generatedAt,
    total,
    allowed,
    denied,
    needsReview,
    decisions,
  };
}

/**
 * Aggregate a list of parsed reports into a single summary tile. Each
 * `resolvePiExtensions` call emits one report and a re-resolve
 * supersedes the previous one — so the renderer surfaces the LATEST
 * report's counters and the count of reports observed over the session
 * lifetime.
 *
 * Defensive: silently ignores malformed entries so a corrupt future event
 * can't poison the cumulative summary.
 */
export function summarizeExtensionAuditReports(
  reports: readonly ExtensionAuditReport[],
): ExtensionAuditSummary {
  let latest: ExtensionAuditReport | null = null;
  let valid = 0;
  for (const r of reports) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.generatedAt !== "string") continue;
    valid += 1;
    if (!latest || r.generatedAt > latest.generatedAt) {
      latest = r;
    }
  }
  if (!latest) {
    return {
      latest: null,
      reports: 0,
      totalAllowed: 0,
      totalDenied: 0,
      totalNeedsReview: 0,
      lastDecisionCount: 0,
    };
  }
  return {
    latest: latest.generatedAt,
    reports: valid,
    totalAllowed: latest.allowed,
    totalDenied: latest.denied,
    totalNeedsReview: latest.needsReview,
    // `total` is the authoritative decision count (per the wire contract),
    // not `decisions.length` — the latter may drop entries if a future
    // parser iteration decides to skip malformed ones.
    lastDecisionCount: latest.total,
  };
}
