import { describe, expect, it } from 'vitest'

import {
  automationDraft, automationSavePayload, parseCwds, promptPreview, scheduleLabel,
  toAutomations, toggledStatus, validateAutomationDraft,
} from '../automations'

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

describe('automation draft (D3)', () => {
  it('prefills an existing task and leaves a new one empty', () => {
    expect(automationDraft({ id: 'a', name: '晨报', prompt: '整理', cwds: '/w', status: 'ACTIVE' }))
      .toEqual({ id: 'a', name: '晨报', prompt: '整理', cwds: '/w' })
    expect(automationDraft()).toEqual({ name: '', prompt: '', cwds: '' })
  })

  it('validates name, prompt and absolute workspaces', () => {
    expect(validateAutomationDraft({ name: '', prompt: 'x', cwds: '/w' })).toContain('名字')
    expect(validateAutomationDraft({ name: 'a', prompt: ' ', cwds: '/w' })).toContain('电脑做什么')
    expect(validateAutomationDraft({ name: 'a', prompt: 'x', cwds: '' })).toContain('工作目录')
    expect(validateAutomationDraft({ name: 'a', prompt: 'x', cwds: 'relative/dir' })).toContain('绝对路径')
    expect(validateAutomationDraft({ name: 'a', prompt: 'x', cwds: 'C:\\work' })).toBeNull()
    expect(validateAutomationDraft({ name: 'a', prompt: 'x', cwds: '/w' })).toBeNull()
  })

  it('dedupes workspaces and keeps the id for edits', () => {
    expect(parseCwds('/a, /b,\n/a')).toEqual(['/a', '/b'])
    expect(automationSavePayload({ id: 'a', name: ' 晨报 ', prompt: ' 整理 ', cwds: '/w, /w2, /w' }))
      .toEqual({ id: 'a', name: '晨报', prompt: '整理', cwds: '/w,/w2' })
    expect(automationSavePayload({ name: '新任务', prompt: '跑测试', cwds: '/w' }))
      .toEqual({ name: '新任务', prompt: '跑测试', cwds: '/w' })
  })
})
