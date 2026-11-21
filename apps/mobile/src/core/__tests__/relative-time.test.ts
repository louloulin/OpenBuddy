import { describe, expect, it } from 'vitest'

import { relativeTime } from '../relative-time'

const NOW = Date.parse('2026-11-19T12:00:00Z')

describe('relativeTime', () => {
  it('counts minutes and hours', () => {
    expect(relativeTime(NOW - 20_000, NOW)).toBe('刚刚')
    expect(relativeTime(NOW - 3 * 60_000, NOW)).toBe('3 分钟前')
    expect(relativeTime(NOW - 5 * 3_600_000, NOW)).toBe('5 小时前')
  })

  it('counts days, then falls back to a date', () => {
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 天前')
    expect(relativeTime(Date.parse('2026-10-01T12:00:00Z'), NOW)).toBe('10/1')
  })

  it('accepts ISO strings and clamps clock skew', () => {
    expect(relativeTime(new Date(NOW - 90_000).toISOString(), NOW)).toBe('1 分钟前')
    expect(relativeTime(NOW + 60_000, NOW)).toBe('刚刚')
  })

  it('returns undefined for missing or invalid input', () => {
    expect(relativeTime(undefined, NOW)).toBeUndefined()
    expect(relativeTime(null, NOW)).toBeUndefined()
    expect(relativeTime('not-a-date', NOW)).toBeUndefined()
  })
})
