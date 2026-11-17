import { describe, expect, it } from 'vitest'

import { toLibrarySources } from '../library'

describe('toLibrarySources', () => {
  it('keeps the desktop rows', () => {
    expect(toLibrarySources([
      { id: '/w/docs', label: 'docs', path: '/w/docs', addedAt: '2026-11-17T00:00:00.000Z', kind: 'folder' },
    ])).toEqual([
      { id: '/w/docs', label: 'docs', path: '/w/docs', addedAt: '2026-11-17T00:00:00.000Z' },
    ])
  })

  it('derives a label and id when the desktop omits them', () => {
    expect(toLibrarySources([{ path: '/w/specs' }])[0]).toMatchObject({ id: '/w/specs', label: 'specs' })
    expect(toLibrarySources([{ path: '/' }])[0]?.label).toBe('/')
  })

  it('drops junk and non-arrays', () => {
    expect(toLibrarySources(null)).toEqual([])
    expect(toLibrarySources([null, 3, {}, { path: '' }])).toEqual([])
  })
})
