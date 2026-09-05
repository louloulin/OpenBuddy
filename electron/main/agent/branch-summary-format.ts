/**
 * Branch-summary text formatter — converts the messages returned by
 * pi SDK's `prepareBranchEntries(...)` into a short, deterministic summary
 * string suitable for writing into a `branch_summary` entry.
 *
 * We deliberately do NOT call pi's LLM-backed `generateBranchSummary`
 * here: that helper requires a model + API key, which OpenBuddy's
 * agent-host has not yet plumbed. Until then this helper keeps the
 * `branch_summary` entry populated with the right shape so downstream
 * tooling (search, telemetry, file-tracking) has a stable artifact.
 */
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