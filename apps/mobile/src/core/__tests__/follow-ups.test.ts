import { describe, expect, it } from 'vitest'

import { followUpsFor, MAX_FOLLOW_UPS } from '../follow-ups'

describe('followUpsFor', () => {
  it('has nothing to suggest for an empty answer', () => {
    expect(followUpsFor('')).toEqual([])
    expect(followUpsFor('   ')).toEqual([])
  })

  it('offers code follow-ups for a code answer', () => {
    const chips = followUpsFor('把这段抽出来：\n```ts\nconst x = 1\n```')
    expect(chips[0]).toBe('解释这段代码')
    expect(chips).toContain('补一个测试')
    expect(chips.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS)
  })

  it('offers risk follow-ups when the answer talks about failure', () => {
    expect(followUpsFor('这个改动的风险是回滚不方便。')[0]).toBe('展开风险')
  })

  it('offers a summary for a long prose answer', () => {
    expect(followUpsFor('好'.repeat(300))[0]).toBe('总结成三点')
  })

  it('always has a generic fallback and never duplicates', () => {
    const chips = followUpsFor('可以。')
    expect(chips).toEqual(['展开细节', '给出例子', '总结成要点'])
    expect(new Set(chips).size).toBe(chips.length)
  })

  it('orders specifics before the generic fallback', () => {
    const chips = followUpsFor('```ts\nconst a = 1\n```\n风险是回滚。')
    expect(chips[0]).toBe('解释这段代码')
    expect(chips.length).toBe(MAX_FOLLOW_UPS)
  })
})
