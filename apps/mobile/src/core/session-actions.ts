/**
 * Managing sessions from the phone (20261115-mobile.md §4.2 P0 "会话管理").
 *
 * The desktop sidebar owns pinning, renaming, archiving and deleting; the phone
 * gets the same actions through the mapped IPC commands. This module is the
 * pure half: which actions a session offers, which command each one uses, and
 * how the list groups once archived rows are folded away. Kept out of the
 * screen so the rules are testable without a renderer.
 */

import type { CachedSession } from '../db/cache'
import { projectLabelFor, type ProjectRef } from './projects'

export type SessionActionKey = 'pin' | 'unpin' | 'rename' | 'archive' | 'unarchive' | 'delete'

export type SessionAction = {
  key: SessionActionKey
  label: string
  /** The desktop command the action drives. */
  command: string
  destructive?: boolean
}

export type SessionFlags = Pick<CachedSession, 'pinned' | 'archived'>

/** Longest title the phone will send; the desktop's own limit is looser. */
export const MAX_TITLE_LENGTH = 60

/**
 * Normalises a title typed on the phone: newlines and tabs become spaces,
 * runs of spaces collapse, and empty input is refused. Over-long titles are
 * truncated rather than rejected so a paste cannot silently do nothing.
 */
export function cleanSessionTitle(raw: string): string | null {
  const title = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!title) return null
  return title.length > MAX_TITLE_LENGTH ? title.slice(0, MAX_TITLE_LENGTH) : title
}

/**
 * The actions to show for one session, filtered by what the host advertises.
 * Order mirrors the desktop menu: pin, rename, archive, then the destructive
 * delete last so a thumb reaching for "归档" does not land on "删除".
 */
export function sessionActions(
  session: SessionFlags,
  can: (command: string) => boolean,
): SessionAction[] {
  const actions: SessionAction[] = []
  if (can('agent_set_session_pinned')) {
    actions.push(session.pinned
      ? { key: 'unpin', label: '取消置顶', command: 'agent_set_session_pinned' }
      : { key: 'pin', label: '置顶', command: 'agent_set_session_pinned' })
  }
  if (can('agent_rename_session')) {
    actions.push({ key: 'rename', label: '重命名', command: 'agent_rename_session' })
  }
  if (can('agent_set_session_archived')) {
    actions.push(session.archived
      ? { key: 'unarchive', label: '取消归档', command: 'agent_set_session_archived' }
      : { key: 'archive', label: '归档', command: 'agent_set_session_archived' })
  }
  if (can('agent_delete_session')) {
    actions.push({ key: 'delete', label: '删除', command: 'agent_delete_session', destructive: true })
  }
  return actions
}

export type SessionLabelRow = {
  kind: 'label'
  id: string
  title: string
  /** Session rows behind this label (project sections show it). */
  count?: number
  collapsible?: boolean
  collapsed?: boolean
}

export type SessionRow =
  | SessionLabelRow
  | { kind: 'session'; id: string; session: CachedSession }

export type GroupOptions = {
  /** `projects_snapshot` rows: non-pinned sessions are folded by their cwd. */
  projects?: readonly ProjectRef[]
  /** Label ids the user folded away. */
  collapsed?: readonly string[]
}

/**
 * Pinned first, then the rest; archived rows are folded behind a count unless
 * the caller asked to show them. The cached order is already
 * `pinned DESC, updated_at DESC`, so each bucket keeps its incoming order.
 *
 * When the list carries workspace roots, non-pinned sessions are grouped by
 * project (C5); without any cwd the older two-bucket layout is kept.
 */
export function groupSessions(
  sessions: readonly CachedSession[],
  showArchived = false,
  options: GroupOptions = {},
): SessionRow[] {
  const active = sessions.filter(session => !session.archived)
  const archived = sessions.filter(session => session.archived)
  const pinned = active.filter(session => session.pinned)
  const rest = active.filter(session => !session.pinned)
  const collapsed = new Set(options.collapsed ?? [])

  const rows: SessionRow[] = []
  if (pinned.length) {
    rows.push({ kind: 'label', id: 'label:pinned', title: '置顶会话' })
    for (const session of pinned) rows.push({ kind: 'session', id: session.id, session })
  }
  if (rest.length) {
    if (rest.some(session => session.cwd)) {
      const buckets = new Map<string, CachedSession[]>()
      for (const session of rest) {
        const title = projectLabelFor(session.cwd, options.projects ?? [])
        const bucket = buckets.get(title)
        if (bucket) bucket.push(session)
        else buckets.set(title, [session])
      }
      for (const [title, items] of buckets) {
        const id = `label:project:${title}`
        const folded = collapsed.has(id)
        rows.push({ kind: 'label', id, title, count: items.length, collapsible: true, collapsed: folded })
        if (!folded) for (const session of items) rows.push({ kind: 'session', id: session.id, session })
      }
    } else {
      rows.push({ kind: 'label', id: 'label:recent', title: pinned.length ? '其他会话' : '最近会话' })
      for (const session of rest) rows.push({ kind: 'session', id: session.id, session })
    }
  }
  if (showArchived && archived.length) {
    rows.push({ kind: 'label', id: 'label:archived', title: '已归档' })
    for (const session of archived) rows.push({ kind: 'session', id: session.id, session })
  }
  return rows
}

export function archivedCount(sessions: readonly CachedSession[]): number {
  return sessions.filter(session => session.archived).length
}
