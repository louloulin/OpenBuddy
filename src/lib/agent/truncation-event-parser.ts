/**
 * truncation-event-parser.ts — renderer-side consumer for the
 * `session/input-truncated` plugin event emitted by
 * `electron/main/agent/host-modules/agent-prompt.ts` whenever the
 * document-block sliding-window truncator decides to drop middle blocks
 * (plan4.3 §3.6 → plan4.4 §C).
 *
 * The payload shape is the contract between main and renderer:
 *
 *   {
 *     sessionId: string,
 *     dropped:   number,           // number of document blocks removed
 *     totalChars: number,          // chars in the truncated text
 *     budget:    { maxChars, keepFirst, keepLast }
 *   }
 *
 * This module is pure: it validates + normalises the incoming payload so
 * the React-side hook + UI panel can trust the shape and never see a
 * malformed event. Defensive defaults + null-on-error so a corrupt
 * payload from a future pi extension version never crashes the renderer.
 */

export interface TruncationBudget {
  /** Total character budget for the joined document blocks. */
  maxChars: number;
  /** How many leading blocks were preserved. */
  keepFirst: number;
  /** How many trailing blocks were preserved. */
  keepLast: number;
}

export interface TruncationEvent {
  sessionId: string;
  /** Number of document blocks dropped during truncation. */
  dropped: number;
  /** Total chars in the joined (truncated) blocks. */
  totalChars: number;
  /** Budget that triggered the truncation decision. */
  budget: TruncationBudget;
}

export interface TruncationSummary {
  events: number;
  /** Sum of `dropped` across all parsed events. */
  dropped: number;
  /** Sum of `totalChars` across all parsed events. */
  totalChars: number;
  /** Number of distinct sessionIds that produced at least one event. */
  affectedSessions: number;
}

function isTruncationBudget(value: unknown): value is TruncationBudget {
  if (!value || typeof value !== "object") return false;
  const budget = value as Record<string, unknown>;
  return (
    typeof budget.maxChars === "number" && Number.isFinite(budget.maxChars) && budget.maxChars > 0 &&
    typeof budget.keepFirst === "number" && Number.isFinite(budget.keepFirst) && budget.keepFirst >= 0 &&
    typeof budget.keepLast === "number" && Number.isFinite(budget.keepLast) && budget.keepLast >= 0
  );
}

/**
 * Type guard — does the raw payload look like a `TruncationEvent`? Cheap
 * structural check used by the hook to filter the plugin event stream
 * before paying for full parsing.
 */
export function isTruncationEvent(value: unknown): value is TruncationEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" && candidate.sessionId.length > 0 &&
    typeof candidate.dropped === "number" && Number.isFinite(candidate.dropped) &&
    typeof candidate.totalChars === "number" && Number.isFinite(candidate.totalChars) &&
    typeof candidate.budget === "object" && isTruncationBudget(candidate.budget)
  );
}

/**
 * Parse + normalise a raw payload. Returns `null` for anything that is
 * not a structurally valid TruncationEvent. Normalises:
 *   - `dropped` and `totalChars` are rounded to integers (the wire format
 *     uses numbers but JS Number can drift with arithmetic on big inputs).
 */
export function parseTruncationEvent(value: unknown): TruncationEvent | null {
  if (!isTruncationEvent(value)) return null;
  if (value.dropped < 0 || value.totalChars < 0) return null;
  return {
    sessionId: value.sessionId,
    dropped: Math.round(value.dropped),
    totalChars: Math.round(value.totalChars),
    budget: {
      maxChars: value.budget.maxChars,
      keepFirst: value.budget.keepFirst,
      keepLast: value.budget.keepLast,
    },
  };
}

/**
 * Aggregate a list of parsed events into a single summary tile. Useful
 * for the truncation panel header (`N events · M blocks dropped · K
 * sessions affected`).
 *
 * Defensive: silently ignores malformed entries so a corrupt future event
 * can't poison the cumulative summary.
 */
export function summarizeTruncationEvents(
  events: readonly TruncationEvent[],
): TruncationSummary {
  const sessions = new Set<string>();
  let dropped = 0;
  let totalChars = 0;
  let validEvents = 0;
  for (const event of events) {
    if (!isTruncationEvent(event)) continue;
    sessions.add(event.sessionId);
    dropped += event.dropped;
    totalChars += event.totalChars;
    validEvents += 1;
  }
  return {
    events: validEvents,
    dropped,
    totalChars,
    affectedSessions: sessions.size,
  };
}