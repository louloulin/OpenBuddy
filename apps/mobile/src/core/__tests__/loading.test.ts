import { describe, expect, it } from 'vitest'

import {
  LOADING_TIPS,
  PREPARING_DURATION_MS,
  PREPARING_TEXT,
  REQUESTING_TEXT,
  TIP_INITIAL_DELAY_MS,
  TIP_ROTATION_INTERVAL_MS,
  nextTip,
} from '../loading'

describe('loading wording', () => {
  it('names both phases of the wait', () => {
    expect(PREPARING_TEXT).toBe('准备中')
    expect(REQUESTING_TEXT).toBe('等待模型响应')
  })

  it('keeps the desktop timing so the two surfaces feel the same', () => {
    expect(PREPARING_DURATION_MS).toBe(1200)
    expect(TIP_INITIAL_DELAY_MS).toBe(3500)
    expect(TIP_ROTATION_INTERVAL_MS).toBe(9000)
  })

  it('has a non-empty tip pool', () => {
    expect(LOADING_TIPS.length).toBeGreaterThan(5)
    expect(new Set(LOADING_TIPS).size).toBe(LOADING_TIPS.length)
  })
})

describe('nextTip', () => {
  it('never repeats the previous tip', () => {
    for (let index = 0; index < 50; index += 1) {
      const first = nextTip(LOADING_TIPS, null)
      const second = nextTip(LOADING_TIPS, first)
      expect(second).not.toBe(first)
    }
  })

  it('handles a one-entry pool', () => {
    expect(nextTip(['只有一个'], null)).toBe('只有一个')
    expect(nextTip(['只有一个'], '只有一个')).toBe('只有一个')
  })

  it('returns an empty string for an empty pool', () => {
    expect(nextTip([], null)).toBe('')
  })
})
