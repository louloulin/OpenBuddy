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

/** A slug that survives iOS/Android share sheets, with a stable fallback. */
export function slugTitle(title: string, fallback: string): string {
  const slug = title
    // Keep letters from any script (CJK included) and digits.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || fallback.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'session'
}

/** `20261117-0905`, local time. */
export function timestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** A filename that survives iOS/Android share sheets. */
export function exportFilename(title: string, sessionId: string, now = new Date()): string {
  return `openbuddy-${slugTitle(title, sessionId)}-${timestamp(now)}.jsonl`
}

/** Non-empty JSONL lines, shown next to the export action. */
export function jsonlEntryCount(content: string): number {
  return content.split('\n').filter(line => line.trim().length > 0).length
}
