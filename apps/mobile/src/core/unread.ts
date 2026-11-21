/**
 * Session unread marks (20261115-mobile.md §4.2 P0 "会话列表 · 未读徽标").
 *
 * The desktop knows which conversation is on screen; the phone has the same
 * notion through `activeSessionId`. A turn that settles while the user is
 * somewhere else becomes one unread mark on that row, and opening the session
 * clears it. Counts are per settled turn, not per token: a ten-minute stream is
 * one unread conversation, which is what the row badge means everywhere else.
 */

import type { CachedSession } from '../db/cache'

/** Above this the badge reads "99+" so the row height never changes. */
export const UNREAD_CAP = 99

/** A settle belongs to the row only when a different session (or none) is open. */
export function shouldMarkUnread(sessionId: string | undefined, activeSessionId: string | null): boolean {
  return Boolean(sessionId) && sessionId !== activeSessionId
}

export function bumpUnread(session: CachedSession): CachedSession {
  const unread = Math.min(session.unread + 1, UNREAD_CAP)
  return unread === session.unread ? session : { ...session, unread }
}

export function clearUnread(session: CachedSession): CachedSession {
  return session.unread === 0 ? session : { ...session, unread: 0 }
}

export function totalUnread(sessions: readonly CachedSession[]): number {
  return sessions.reduce((sum, session) => sum + (session.unread > 0 ? session.unread : 0), 0)
}

export function unreadLabel(count: number): string {
  if (count <= 0) return ''
  return count > UNREAD_CAP ? '99+' : String(count)
}
