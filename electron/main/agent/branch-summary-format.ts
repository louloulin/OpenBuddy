/**
 * Branch-summary text formatter — converts the messages returned by
 * pi SDK's `prepareBranchEntries(...)` into a short, deterministic summary
 * string suitable for writing into a `branch_summary` entry.
 *
 * Round 30 (G5 PR 1): pi's LLM-backed `generateBranchSummary` is wired in
 * via `formatBranchSummaryWithPi` and routed by `formatBranchSummary`.
 * The deterministic text formatter stays as the offline fallback (no model
 * or no API credentials → text path).
 */
import {
  type BranchSummaryResult,
  type Model,
  generateBranchSummary,
  prepareBranchEntries,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

/**
 * Default `reserveTokens` for `prepareBranchEntries` + `generateBranchSummary`.
 *
 * Chosen to match the prior OpenBuddy rewind budget. Pi's SDK walks entries
 * newest-first until this budget is exhausted, then hands the survivor list
 * to the LLM. 8_000 tokens fits ~50 turns of typical agent conversation
 * before compaction is required, which keeps rewind-time summaries short
 * without losing the branch's recent intent.
 *
 * Centralised so `formatBranchSummaryWithPi`, `formatBranchSummary`, and
 * `session-store.rewindSession` all share the same default. Round 31 (G5
 * PR 2) hoisted this from three duplicate literals to one named export.
 */
export const DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS = 8_000;

export interface BranchSummaryMessage {
  role?: string;
  content?: unknown;
}

export function textOfBranchSummaryMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null)
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Format a short, deterministic text summary from `prepareBranchEntries`
 * output (chronological `AgentMessage[]`). Returns null when nothing
 * usable survives the token budget.
 *
 * Conventions:
 *  - user messages are quoted with `>` and capped at 200 chars
 *  - assistant/system messages are capped at 400 chars
 *  - the joined result is capped at 1200 chars total so it fits
 *    comfortably inside `branch_summary.summary`
 *
 * This is the offline fallback when pi's LLM-backed generator is not
 * available (no model set, no API key, or `signal` already aborted).
 */
export function formatBranchSummaryText(
  messages: readonly BranchSummaryMessage[],
  options: { maxTotal?: number; maxUser?: number; maxAssistant?: number } = {},
): string | null {
  const maxTotal = options.maxTotal ?? 1200;
  const maxUser = options.maxUser ?? 200;
  const maxAssistant = options.maxAssistant ?? 400;
  const lines: string[] = [];
  for (const message of messages) {
    const text = textOfBranchSummaryMessageContent(message.content).trim();
    if (!text) continue;
    lines.push(message.role === "user" ? `> ${text.slice(0, maxUser)}` : text.slice(0, maxAssistant));
  }
  if (lines.length === 0) return null;
  return lines.join("\n").slice(0, maxTotal);
}

/**
 * Options for the pi-backed `generateBranchSummary` path.
 *
 * - `model` is required; pi's Model carries provider auth via env or runtime.
 * - `signal` is required; pass a per-rewind `AbortController.signal` so the
 *   LLM call does not block indefinitely.
 * - `reserveTokens` defaults to `DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS` to
 *   match the prior `prepareBranchEntries(entries, 8_000)` budget used by the
 *   rewind path. Pi's SDK picks `entries` newest-first until the budget is
 *   exhausted, then hands the survivor list to the LLM.
 * - `customInstructions` is optional; if set, it's appended to pi's default
 *   prompt unless `replaceInstructions` is true.
 */
export interface FormatBranchSummaryWithPiOptions {
  model: Model<any>;
  signal: AbortSignal;
  reserveTokens?: number;
  customInstructions?: string;
  replaceInstructions?: boolean;
}

/**
 * Run pi's LLM-backed `generateBranchSummary` against a SessionEntry[] and
 * return its summary string. Returns null when:
 *  - the call throws (offline, auth failure, provider error)
 *  - pi returns an aborted/error result
 *  - pi returns an empty summary
 *
 * This wrapper never throws — the caller can blindly treat `null` as
 * "no summary available" and fall back to the text formatter.
 */
export async function formatBranchSummaryWithPi(
  entries: readonly SessionEntry[],
  options: FormatBranchSummaryWithPiOptions,
): Promise<string | null> {
  const entriesArr = entries as SessionEntry[];
  try {
    const result: BranchSummaryResult = await generateBranchSummary(entriesArr, {
      model: options.model,
      signal: options.signal,
      reserveTokens: options.reserveTokens ?? DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
      customInstructions: options.customInstructions,
      replaceInstructions: options.replaceInstructions,
    });
    if (result.aborted || result.error) return null;
    const summary = result.summary?.trim();
    return summary ? summary : null;
  } catch {
    // Swallow — caller decides whether to fall back.
    return null;
  }
}

/**
 * Round 30 router: pick the pi path when a model is provided, else use the
 * deterministic text formatter. Returns null only when both paths produce
 * no usable output.
 *
 * The rewind path passes `state.model` directly, so any value other than
 * `undefined` opts the call into pi's LLM summarizer. When `signal` is
 * already aborted, the router returns null immediately (no work happens).
 */
export async function formatBranchSummary(
  entries: readonly SessionEntry[],
  options: {
    model?: Model<any> | undefined;
    signal: AbortSignal;
    reserveTokens?: number;
    customInstructions?: string;
    maxTotal?: number;
    maxUser?: number;
    maxAssistant?: number;
  },
): Promise<string | null> {
  if (options.signal.aborted) return null;
  if (options.model) {
    const piSummary = await formatBranchSummaryWithPi(entries, {
      model: options.model,
      signal: options.signal,
      reserveTokens: options.reserveTokens,
      customInstructions: options.customInstructions,
    });
    if (piSummary) return piSummary;
    // Fall through to text fallback if pi returned null.
  }
  // Text fallback uses `prepareBranchEntries`'s messages output.
  const prepared = prepareBranchEntries(
    entries as SessionEntry[],
    options.reserveTokens ?? DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
  );
  return formatBranchSummaryText(prepared.messages, {
    maxTotal: options.maxTotal,
    maxUser: options.maxUser,
    maxAssistant: options.maxAssistant,
  });
}