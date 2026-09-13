/**
 * openbuddy-compaction-settings.ts — custom pi compaction strategy (plan4.4 §A).
 *
 * Why: pi-agent-core exports `DEFAULT_COMPACTION_SETTINGS` (a baseline
 * `CompactionSettings` instance used by the harness) plus a pure-function
 * `shouldCompact(contextTokens, contextWindow, settings)` decision helper.
 * OpenBuddy wants different defaults than the bare SDK because:
 *
 *   1. We reserve more tokens for the summarizer — the renderer-side
 *      document truncator (`document-truncator.ts`) consumes ~24_000 chars
 *      (~6_000 tokens at the 4-char heuristic) of a user prompt for
 *      `<document>` blocks. The compaction reserve must exceed that so
 *      we never feed the summarizer a prompt that just got truncated.
 *
 *   2. We keep more recent tokens — workbuddy users iterate quickly
 *      between turns; dropping the last 1-2 turns when context overflows
 *      is jarring, so we retain a larger recent window.
 *
 *   3. We freeze the default tuning object so renderer + agent-host share
 *      the same anchor; runtime mutation is impossible without going
 *      through `buildOpenbuddyCompactionSettings()`.
 *
 * The module is pure (no side effects, no Electron deps) so vitest can run
 * the test suite without booting pi upstream.
 */
import { DEFAULT_COMPACTION_SETTINGS, type CompactionSettings } from "@earendil-works/pi-agent-core";

/**
 * OpenBuddy-side overrides for the pi compaction decision. Mirrors the
 * fields of `CompactionSettings` that we want to tune; unknown fields on
 * pi upstream flow through unchanged so future SDK additions stay
 * available to consumers that read the merged result.
 */
export interface OpenbuddyCompactionTuning {
  /** Mirrors `CompactionSettings.enabled`. */
  enabled: boolean;
  /** Mirrors `CompactionSettings.reserveTokens`. */
  reserveTokens: number;
  /** Mirrors `CompactionSettings.keepRecentTokens`. */
  keepRecentTokens: number;
}

/**
 * Default OpenBuddy tuning anchor. Calibrated against:
 *   - `document-truncator.ts::DEFAULT_TRUNCATION_OPTIONS.maxChars = 24_000`
 *     (which costs ~6_000 tokens at the conservative 4-char heuristic)
 *   - `agent-host.ts::contextWindow = 128_000` default
 *
 * `reserveTokens = 16_000` leaves the summarizer ~4_000 tokens of prompt
 * overhead plus 6_000 of headroom for the document truncator to keep
 * operating. `keepRecentTokens = 96_000` retains ~75% of the 128k context
 * window for recent turns, which keeps 2-3 chat turns plus 1 large
 * attachment in working memory when the trigger fires.
 *
 * Frozen so any accidental mutation throws (TypeError in strict mode)
 * rather than silently drifting the global anchor.
 */
export const DEFAULT_OPENBUDDY_COMPACTION_SETTINGS: OpenbuddyCompactionTuning = Object.freeze({
  enabled: true,
  reserveTokens: 16_000,
  keepRecentTokens: 96_000,
});

/**
 * Sanitize a candidate number: replace NaN / negative / non-finite inputs
 * with `fallback`. Keeps the factory total so callers never get a broken
 * CompactionSettings even if they hand us a corrupt tuning payload.
 */
function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Build a `CompactionSettings` instance for the agent-host's context-guard
 * extension. Returns a merged record so the result satisfies pi's
 * `shouldCompact()` signature (it accepts any object with the three
 * documented fields).
 *
 * The merging strategy is "pi default → OpenBuddy default → caller override",
 * so any field pi adds in the future is preserved automatically unless we
 * explicitly override it here.
 */
export function buildOpenbuddyCompactionSettings(
  tuning: Partial<OpenbuddyCompactionTuning> = {},
): CompactionSettings {
  const merged: OpenbuddyCompactionTuning = {
    enabled: safeBoolean(
      tuning.enabled,
      DEFAULT_OPENBUDDY_COMPACTION_SETTINGS.enabled,
    ),
    reserveTokens: safeNumber(
      tuning.reserveTokens,
      DEFAULT_OPENBUDDY_COMPACTION_SETTINGS.reserveTokens,
    ),
    keepRecentTokens: safeNumber(
      tuning.keepRecentTokens,
      DEFAULT_OPENBUDDY_COMPACTION_SETTINGS.keepRecentTokens,
    ),
  };
  // Round reserveTokens to the nearest 1_000 so the value is stable across
  // test runs and easy to compare against the JSON baseline report.
  const reserveTokens = Math.max(1_000, Math.round(merged.reserveTokens / 1_000) * 1_000);
  return {
    ...DEFAULT_COMPACTION_SETTINGS,
    enabled: merged.enabled,
    reserveTokens,
    keepRecentTokens: merged.keepRecentTokens,
  };
}