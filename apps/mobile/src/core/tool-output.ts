/**
 * Long tool output on a phone (20261117-mobile.md §4.3 tool card).
 *
 * A build log or a file dump can be hundreds of kilobytes, and the phone
 * renders a plain Text — enough to jank the list. The card shows the head of
 * the output plus a copy action for the whole thing.
 */

export const TOOL_OUTPUT_MAX = 4000

export type ClippedOutput = {
  /** What the card renders. */
  text: string
  truncated: boolean
  /** Length of the original output, for the "共 N 字符" note. */
  total: number
}

export function clipToolOutput(output: string, max = TOOL_OUTPUT_MAX): ClippedOutput {
  if (output.length <= max) return { text: output, truncated: false, total: output.length }
  // Cut on a line boundary when one is close, so the tail is not mid-token.
  const head = output.slice(0, max)
  const lastBreak = head.lastIndexOf('\n')
  const text = lastBreak > max * 0.6 ? head.slice(0, lastBreak) : head
  return { text, truncated: true, total: output.length }
}
