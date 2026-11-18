/**
 * The notifications the desktop already recorded (20261115-mobile.md §5.8).
 *
 * Push only covers what happens while the phone is away; opening the 通知 tab
 * has to show the backlog too, which `notification_list` provides. The rows
 * are normalised here so a schema drift on the desktop cannot crash the tab.
 */

import type { NotificationItem } from './models'

const KINDS = new Set(['approval', 'question', 'done', 'scheduled'])

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Desktop ids are numbers (`Date.now()`); push payload ids may be strings. */
function idOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return text(value)
}

function millis(value: unknown, now: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return now
}

export function toNotifications(raw: unknown, now = Date.now()): NotificationItem[] {
  if (!Array.isArray(raw)) return []
  const items: NotificationItem[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = idOf(record.id)
    const title = text(record.title)
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    const kind = typeof record.kind === 'string' && KINDS.has(record.kind) ? record.kind : 'done'
    items.push({
      id,
      kind: kind as NotificationItem['kind'],
      title,
      body: text(record.body) ?? '',
      sessionId: text(record.sessionId),
      requestId: text(record.requestId),
      read: record.read === true,
      at: millis(record.at ?? record.createdAt, now),
    })
  }
  return items.sort((a, b) => b.at - a.at).slice(0, 100)
}

/**
 * `notification_mark_read` takes the desktop's numeric id; a push-only row
 * (string id) has no backlog entry to mark.
 */
export function numericNotificationId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null
  const value = Number(id)
  return Number.isSafeInteger(value) ? value : null
}
