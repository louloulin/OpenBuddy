/**
 * Quote-reply and edit-resend (20261117-mobile.md §4.2 「引用回复 / 编辑重发」).
 *
 * The contract has no quote field yet, and §13 decided the phone starts with a
 * plain text prefix: a `>` block the desktop and the model both understand.
 * Upgrading to `agent_send.quote` later only changes this module.
 */

/** One quoted line longer than this is folded into an ellipsis. */
export const QUOTE_LINE_MAX = 160

/** At most this many lines of the original go into the quote. */
export const QUOTE_LINES_MAX = 6

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A single-line preview for the composer strip. */
export function quotePreview(text: string, max = 90): string {
  const line = flatten(text)
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The quoted block itself: `> line` for at most six non-empty lines. */
export function quoteBlock(text: string): string[] {
  const lines = text
    .split('\n')
    .map(line => flatten(line))
    .filter(Boolean)
    .slice(0, QUOTE_LINES_MAX)
    .map(line => line.length > QUOTE_LINE_MAX ? `${line.slice(0, QUOTE_LINE_MAX - 1)}…` : line)
  return lines.map(line => `> ${line}`)
}

/** The reply body with the quote prefix, or the body alone when unquoted. */
export function withQuote(quote: string | null | undefined, body: string): string {
  const trimmed = body.trim()
  if (!quote) return trimmed
  const block = quoteBlock(quote)
  if (!block.length) return trimmed
  return trimmed ? `${block.join('\n')}\n\n${trimmed}` : block.join('\n')
}
