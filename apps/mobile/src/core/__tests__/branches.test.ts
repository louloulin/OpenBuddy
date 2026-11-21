import { describe, expect, it } from 'vitest'

import type { BranchTree } from '@openbuddy/protocol/branches'
import {
  branchLabel,
  branchTurns,
  checkpointAction,
  checkpointLabel,
  checkpointTitle,
  restoreHash,
  toCheckpoints,
  toRewindPoints,
} from '../branches'

const tree: BranchTree = {
  sessionId: 's1',
  leafId: 'leaf-3',
  turns: [
    {
      entryId: 'u1', timestamp: 1, index: 1, total: 3,
      siblings: [
        { entryId: 'a1', leafId: 'leaf-1', timestamp: 1, preview: '第一版提问', files: [] },
        { entryId: 'a2', leafId: 'leaf-2', timestamp: 2, preview: '第二版提问', files: [] },
        { entryId: 'a3', leafId: 'leaf-3', timestamp: 3, preview: '第三版提问', files: [] },
      ],
    },
    { entryId: 'u2', timestamp: 4, index: 0, total: 1, siblings: [] },
  ],
}

describe('branchTurns / branchLabel', () => {
  it('keeps only turns that have siblings', () => {
    expect(branchTurns(tree).map(turn => turn.entryId)).toEqual(['u1'])
    expect(branchTurns(null)).toEqual([])
    expect(branchTurns({ sessionId: 's', leafId: null, turns: [] })).toEqual([])
  })

  it('renders position and the preview of the current version', () => {
    expect(branchLabel(tree.turns[0]!)).toBe('2/3 · 第二版提问')
  })

  it('truncates a long preview', () => {
    const long = { ...tree.turns[0]!, siblings: [{ entryId: 'a', leafId: 'l', timestamp: 1, preview: '一二三四五六七八九十', files: [] }] }
    expect(branchLabel(long, 6)).toBe('2/3 · 一二三四五…')
  })

  it('falls back to the position when there is no preview', () => {
    const empty = { ...tree.turns[0]!, siblings: [{ entryId: 'a', leafId: 'l', timestamp: 1, preview: '   ', files: [] }] }
    expect(branchLabel(empty)).toBe('2/3')
  })
})

describe('toRewindPoints', () => {
  it('drops malformed rows and sorts by index', () => {
    expect(toRewindPoints([
      { entryId: 'b', index: 2, preview: 'second' },
      { entryId: 'a', index: 0, preview: 'first' },
      { index: 5, preview: 'no id' },
      null,
    ]).map(point => point.entryId)).toEqual(['a', 'b'])
    expect(toRewindPoints('nope')).toEqual([])
  })
})

describe('toCheckpoints', () => {
  const record = (over: Record<string, unknown> = {}) => ({
    id: 'c1', path: 'src/a.ts', before: 'h1', after: 'h2', at: 1_700_000_000_000, source: 'tool', ...over,
  })

  it('sorts newest first and normalises unknown sources', () => {
    const list = toCheckpoints([
      record({ id: 'old', at: 1_000, path: 'a.ts' }),
      record({ id: 'new', at: 2_000, path: 'b.ts', source: 'mystery' }),
    ])
    expect(list.map(item => item.id)).toEqual(['new', 'old'])
    expect(list[0]!.source).toBe('tool')
  })

  it('rejects rows without id/path/time and accepts a null before-hash', () => {
    expect(toCheckpoints([record({ id: undefined }), record({ path: '' }), record({ at: 'x' })])).toEqual([])
    expect(toCheckpoints([record({ before: null })])[0]!.before).toBeNull()
  })

  it('labels source and action, and hands restore the before-hash', () => {
    const [created] = toCheckpoints([record({ before: null })])
    expect(checkpointAction(created!)).toBe('恢复到「文件不存在」')
    expect(restoreHash(created!)).toBeNull()

    const changed = toCheckpoints([record()])[0]!
    expect(checkpointAction(changed)).toBe('恢复到修改前')
    expect(restoreHash(changed)).toBe('h1')
    expect(checkpointLabel(changed)).toMatch(/^工具写入 · \d\d:\d\d$/)

    const skipped = toCheckpoints([record({ skipped: 'too_large' })])[0]!
    expect(checkpointAction(skipped)).toBe('文件过大，未保存内容')
  })

  it('keeps the file name for the row title', () => {
    expect(checkpointTitle('src/features/a.ts')).toBe('a.ts')
    expect(checkpointTitle('a.ts')).toBe('a.ts')
  })
})
