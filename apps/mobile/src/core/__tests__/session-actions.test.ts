import { describe, expect, it } from 'vitest'

import {
  archivedCount,
  cleanSessionTitle,
  groupSessions,
  MAX_TITLE_LENGTH,
  sessionActions,
} from '../session-actions'
import type { CachedSession } from '../../db/cache'

const all = () => true

function session(overrides: Partial<CachedSession> & { id: string }): CachedSession {
  return {
    title: overrides.id,
    updatedAt: 0,
    pinned: false,
    archived: false,
    preview: '',
    unread: 0,
    ...overrides,
  }
}

describe('cleanSessionTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanSessionTitle('  周报 \n 改写\t一下  ')).toBe('周报 改写 一下')
  })

  it('refuses empty input', () => {
    expect(cleanSessionTitle('')).toBeNull()
    expect(cleanSessionTitle('   \n\t ')).toBeNull()
  })

  it('truncates an over-long paste instead of silently doing nothing', () => {
    expect(cleanSessionTitle('x'.repeat(200))).toHaveLength(MAX_TITLE_LENGTH)
  })
})

describe('sessionActions', () => {
  it('offers pin, rename, archive and delete in that order', () => {
    expect(sessionActions({ pinned: false, archived: false }, all).map(action => action.key))
      .toEqual(['pin', 'rename', 'archive', 'delete'])
  })

  it('flips pin and archive labels for an already pinned/archived row', () => {
    expect(sessionActions({ pinned: true, archived: true }, all).map(action => action.key))
      .toEqual(['unpin', 'rename', 'unarchive', 'delete'])
  })

  it('marks delete as the only destructive action', () => {
    const actions = sessionActions({ pinned: false, archived: false }, all)
    expect(actions.filter(action => action.destructive).map(action => action.key)).toEqual(['delete'])
  })

  it('drops actions the host does not advertise', () => {
    const readOnly = (command: string) => command === 'agent_rename_session'
    expect(sessionActions({ pinned: false, archived: false }, readOnly))
      .toEqual([{ key: 'rename', label: '重命名', command: 'agent_rename_session' }])
  })
})

describe('groupSessions', () => {
  const sessions = [
    session({ id: 'p1', pinned: true, updatedAt: 3 }),
    session({ id: 'a1', archived: true, updatedAt: 2 }),
    session({ id: 'r1', updatedAt: 1 }),
  ]

  it('keeps pinned first and hides archived by default', () => {
    expect(groupSessions(sessions).map(row => row.id))
      .toEqual(['label:pinned', 'p1', 'label:recent', 'r1'])
  })

  it('shows archived rows behind their own label when asked', () => {
    expect(groupSessions(sessions, true).map(row => row.id))
      .toEqual(['label:pinned', 'p1', 'label:recent', 'r1', 'label:archived', 'a1'])
  })

  it('counts archived rows for the toggle', () => {
    expect(archivedCount(sessions)).toBe(1)
    expect(archivedCount([])).toBe(0)
  })
})
