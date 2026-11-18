import { describe, expect, it } from 'vitest'

import { toNotifications } from '../notification-list'

describe('toNotifications', () => {
  it('normalises the desktop rows and sorts newest first', () => {
    const rows = toNotifications([
      { id: 'b', kind: 'approval', title: '需要批准', body: 'x', sessionId: 's1', read: false, at: '2026-11-18T10:00:00.000Z' },
      { id: 'a', kind: 'done', title: '已完成', at: 5, read: true },
    ], 1)
    expect(rows.map(row => row.id)).toEqual(['b', 'a'])
    expect(rows[0]).toMatchObject({ kind: 'approval', sessionId: 's1', read: false, at: Date.parse('2026-11-18T10:00:00.000Z') })
  })

  it('accepts the desktop numeric ids and ISO timestamps', () => {
    const rows = toNotifications([{
      id: 1_760_000_000_000, kind: 'approval', title: '需要批准', sessionId: 's1',
      read: false, at: '2026-11-18T10:00:00.000Z',
    }], 1)
    expect(rows[0]).toMatchObject({ id: '1760000000000', at: Date.parse('2026-11-18T10:00:00.000Z') })
  })

  it('falls back to a plain notice for unknown kinds and missing bodies', () => {
    expect(toNotifications([{ id: 'x', title: '标题', kind: 'weird' }], 9)[0])
      .toMatchObject({ kind: 'done', body: '', at: 9, read: false })
  })

  it('drops junk and duplicates, and caps the list', () => {
    expect(toNotifications([null, {}, { id: 'a' }, { title: 'no id' }])).toEqual([])
    expect(toNotifications([{ id: 'a', title: 'A' }, { id: 'a', title: 'A2' }])).toHaveLength(1)
    const many = Array.from({ length: 120 }, (_, index) => ({ id: `n${index}`, title: `T${index}` }))
    expect(toNotifications(many)).toHaveLength(100)
  })
})
