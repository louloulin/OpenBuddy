import { describe, expect, it } from 'vitest'

import { bumpUnread, clearUnread, shouldMarkUnread, totalUnread, UNREAD_CAP, unreadLabel } from '../unread'
import type { CachedSession } from '../../db/cache'

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

describe('shouldMarkUnread', () => {
  it('counts a settle for a session that is not open', () => {
    expect(shouldMarkUnread('s1', null)).toBe(true)
    expect(shouldMarkUnread('s1', 's2')).toBe(true)
  })

  it('ignores the session the user is looking at', () => {
    expect(shouldMarkUnread('s1', 's1')).toBe(false)
  })

  it('needs a session id', () => {
    expect(shouldMarkUnread(undefined, null)).toBe(false)
  })
})

describe('bumpUnread', () => {
  it('adds one mark per settled turn', () => {
    expect(bumpUnread(session({ id: 's1' })).unread).toBe(1)
    expect(bumpUnread(session({ id: 's1', unread: 4 })).unread).toBe(5)
  })

  it('stops at the cap', () => {
    expect(bumpUnread(session({ id: 's1', unread: UNREAD_CAP })).unread).toBe(UNREAD_CAP)
  })

  it('returns the same object when already at the cap', () => {
    const atCap = session({ id: 's1', unread: UNREAD_CAP })
    expect(bumpUnread(atCap)).toBe(atCap)
  })
})

describe('clearUnread / totalUnread / unreadLabel', () => {
  it('clears a row without touching the rest', () => {
    const row = session({ id: 's1', unread: 3, title: '周报' })
    expect(clearUnread(row)).toEqual({ ...row, unread: 0 })
    expect(clearUnread(session({ id: 's2' })).unread).toBe(0)
  })

  it('sums only positive counts', () => {
    expect(totalUnread([session({ id: 'a', unread: 2 }), session({ id: 'b' }), session({ id: 'c', unread: 1 })])).toBe(3)
    expect(totalUnread([])).toBe(0)
  })

  it('labels the badge, folding past the cap', () => {
    expect(unreadLabel(0)).toBe('')
    expect(unreadLabel(3)).toBe('3')
    expect(unreadLabel(120)).toBe('99+')
  })
})
