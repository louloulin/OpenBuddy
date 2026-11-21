import { describe, expect, it } from 'vitest'

import { toSessionList } from '../session-list'

describe('toSessionList', () => {
  it('reads the real host shape (sessionId + ISO date + cwd)', () => {
    expect(toSessionList([
      { sessionId: 's1', title: '重构网关', updatedAt: '2026-11-17T10:00:00.000Z', cwd: '/w/a', pinned: true, archived: false },
    ])).toEqual([
      { id: 's1', title: '重构网关', updatedAt: Date.parse('2026-11-17T10:00:00.000Z'), pinned: true, archived: false, cwd: '/w/a' },
    ])
  })

  it('still accepts the test-host shape (id + epoch)', () => {
    expect(toSessionList([{ id: 's2', updatedAt: 123 }], 999)[0])
      .toMatchObject({ id: 's2', title: '未命名会话', updatedAt: 123, pinned: false, archived: false })
  })

  it('drops duplicates and rows without an id, and sorts pinned/newest first', () => {
    const rows = toSessionList([
      { id: 'a', updatedAt: 1 },
      { id: 'a', updatedAt: 99 },
      { id: 'b', updatedAt: 2, pinned: true },
      { name: '没有 id' },
      null,
    ], 0)
    expect(rows.map(row => row.id)).toEqual(['b', 'a'])
    expect(rows[0]?.updatedAt).toBe(2)
  })

  it('falls back to now for a broken date', () => {
    expect(toSessionList([{ id: 'x', updatedAt: 'not-a-date' }], 77)[0]?.updatedAt).toBe(77)
  })
})
