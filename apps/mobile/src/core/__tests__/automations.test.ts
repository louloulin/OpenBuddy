import { describe, expect, it } from 'vitest'

import { promptPreview, scheduleLabel, toAutomations, toggledStatus } from '../automations'

describe('toAutomations', () => {
  it('reads the snapshot the desktop sends', () => {
    expect(toAutomations({
      automations: [
        { id: 'auto-1', name: '每日晨报', prompt: '整理今天的日程', status: 'ACTIVE', nextRunAt: '2026-11-18T01:00:00.000Z' },
        { id: 'auto-2', name: '', prompt: '', status: 'PAUSED' },
      ],
    })).toEqual([
      { id: 'auto-1', name: '每日晨报', prompt: '整理今天的日程', status: 'ACTIVE', nextRunAt: '2026-11-18T01:00:00.000Z', lastRunAt: undefined, scheduleType: undefined },
      { id: 'auto-2', name: '未命名任务', prompt: '', status: 'PAUSED', nextRunAt: undefined, lastRunAt: undefined, scheduleType: undefined },
    ])
  })

  it('survives a bare array or junk', () => {
    expect(toAutomations([{ id: 'a' }])).toHaveLength(1)
    expect(toAutomations(null)).toEqual([])
    expect(toAutomations({ automations: 'nope' })).toEqual([])
  })

  it('drops rows without an id', () => {
    expect(toAutomations({ automations: [{ name: '没有 id' }] })).toEqual([])
  })
})

describe('scheduleLabel', () => {
  it('says nothing for a paused task (the card carries the badge)', () => {
    expect(scheduleLabel({ id: 'a', name: 'x', prompt: '', status: 'PAUSED' })).toBe('')
  })

  it('says waiting when there is no next run', () => {
    expect(scheduleLabel({ id: 'a', name: 'x', prompt: '', status: 'ACTIVE' })).toBe('等待调度')
  })

  it('names the next run', () => {
    const label = scheduleLabel({
      id: 'a', name: 'x', prompt: '', status: 'ACTIVE', nextRunAt: '2026-11-18T01:00:00.000Z',
    })
    expect(label).toContain('下次')
  })
})

describe('promptPreview', () => {
  it('flattens the prompt to one line and truncates it', () => {
    const automation = { id: 'a', name: 'x', prompt: '第一行\n第二行   第三行', status: 'ACTIVE' as const }
    expect(promptPreview(automation)).toBe('第一行 第二行 第三行')
    expect(promptPreview({ ...automation, prompt: 'x'.repeat(100) }, 10)).toBe('xxxxxxxxx…')
    expect(promptPreview({ ...automation, prompt: '  ' })).toBe('')
  })
})

describe('toggledStatus', () => {
  it('flips the status', () => {
    expect(toggledStatus({ id: 'a', name: 'x', prompt: '', status: 'ACTIVE' })).toBe('PAUSED')
    expect(toggledStatus({ id: 'a', name: 'x', prompt: '', status: 'PAUSED' })).toBe('ACTIVE')
  })
})
