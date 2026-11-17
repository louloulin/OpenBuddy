/**
 * Session export (20261117-mobile.md C2).
 *
 * The desktop owns the transcript: `agent_export_jsonl` writes the current
 * branch to a JSONL file and returns its path, then `read_text_file` hands the
 * bytes back. The phone never builds JSONL itself — a second serializer would
 * drift from Pi's format. What the phone owns is the shareable filename and the
 * "too large to fetch" boundary.
 */

/** `packages/services/src/files/files.ts` appends this when the read hit maxBytes. */
const TRUNCATION_MARKER = '\n\n…(已截断，仅预览前部分内容)'

/** The host caps a single read at 16MB; a truncated JSONL must not be shared. */
export const MAX_EXPORT_BYTES = 16 * 1024 * 1024

export function isTruncatedRead(text: string): boolean {
  return text.endsWith(TRUNCATION_MARKER)
}

/**
 * A filename that survives iOS/Android share sheets: no path separators, no
 * control characters, and a stable fallback when the session has no title.
 */
export function exportFilename(title: string, sessionId: string, now = new Date()): string {
  const slug = title
    // Keep letters from any script (CJK included) and digits.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  const base = slug || sessionId.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'session'
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `openbuddy-${base}-${stamp}.jsonl`
}

/** Non-empty JSONL lines, shown next to the export action. */
export function jsonlEntryCount(content: string): number {
  return content.split('\n').filter(line => line.trim().length > 0).length
}
