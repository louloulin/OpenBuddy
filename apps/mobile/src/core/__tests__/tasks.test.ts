import { describe, expect, it } from 'vitest'

import { elapsedLabel, runningCount, sessionTasks, taskLine } from '../tasks'
import type { RunningTask } from '../models'

const task = (overrides: Partial<RunningTask> & { id: string }): RunningTask => ({ ...overrides })

describe('sessionTasks', () => {
  it('keeps this session and host-wide rows', () => {
    const rows = [task({ id: 'a', sessionId: 's1' }), task({ id: 'b', sessionId: 's2' }), task({ id: 'c' })]
    expect(sessionTasks(rows, 's1').map(row => row.id)).toEqual(['a', 'c'])
    expect(runningCount(rows)).toBe(3)
  })
})

describe('elapsedLabel', () => {
  it('formats seconds, minutes and hours', () => {
    expect(elapsedLabel(1_000, 12_000)).toBe('11s')
    expect(elapsedLabel(0, 65_000)).toBe('1m 5s')
    expect(elapsedLabel(0, 3_700_000)).toBe('1h 1m')
  })

  it('is empty without a start or with a future start', () => {
    expect(elapsedLabel(undefined, 1000)).toBe('')
    expect(elapsedLabel(5000, 1000)).toBe('')
  })
})

describe('taskLine', () => {
  it('joins title, kind, elapsed and pending approvals', () => {
    expect(taskLine({ id: 't', title: '跑测试', kind: 'bash', startedAt: 0, pending: 1 }, 7000))
      .toBe('跑测试 · bash · 7s · 待确认 1')
  })

  it('falls back to the id', () => {
    expect(taskLine({ id: 'task-9' })).toBe('task-9')
  })
})
