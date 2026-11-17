import { describe, expect, it } from 'vitest'

import { batchSummary, toggleSelection } from '../batch'

describe('batch selection', () => {
  it('toggles without duplicating and keeps order', () => {
    expect(toggleSelection([], 'a')).toEqual(['a'])
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('summarises clean and partial runs', () => {
    expect(batchSummary('已归档', { ok: ['a', 'b', 'c'], failed: [] })).toBe('已归档 3 个')
    expect(batchSummary('已删除', { ok: ['a'], failed: [{ id: 'b', reason: 'offline' }] })).toBe('已删除 1 个，1 个失败')
    expect(batchSummary('已删除', { ok: [], failed: [{ id: 'b', reason: 'offline' }] })).toBe('已删除失败 1 个')
  })
})
