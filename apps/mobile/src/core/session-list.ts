/**
 * Normalising `agent_list_sessions` (20261115-mobile.md §4.2, v3 C5).
 *
 * The host answers with `{ sessionId, title, updatedAt: ISO, cwd, pinned,
 * archived }`; the phone's cache uses `id` and epoch milliseconds. Old test
 * hosts send `{ id, updatedAt: number }`, so both shapes are accepted here and
 * nothing else in the app has to know which desktop answered.
 */

export type SessionListRow = {
  id: string
  title: string
  updatedAt: number
  pinned: boolean
  archived: boolean
  cwd?: string
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function millis(value: unknown, now: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return now
}

export function toSessionList(raw: unknown, now = Date.now()): SessionListRow[] {
  if (!Array.isArray(raw)) return []
  const rows: SessionListRow[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = text(record.sessionId) ?? text(record.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    rows.push({
      id,
      title: text(record.title) ?? '未命名会话',
      updatedAt: millis(record.updatedAt, now),
      pinned: record.pinned === true,
      archived: record.archived === true,
      cwd: text(record.cwd),
    })
  }
  // The sidebar order: pinned first, newest first.
  return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}
