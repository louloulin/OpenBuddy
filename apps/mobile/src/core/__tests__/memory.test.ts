import { describe, expect, it } from 'vitest'

import type { MemoryEntry } from '@openbuddy/protocol/dto'
import { groupMemory, memoryDir, memoryPreview, memoryTitle, validateMemoryDraft } from '../memory'

const entry = (scope: string, path: string, content = ''): MemoryEntry => ({
  scope,
  path,
  content,
  size: content.length,
})

describe('groupMemory', () => {
  it('puts global first and sorts each group by path', () => {
    const groups = groupMemory([
      entry('workspace', 'b.md'),
      entry('global', 'z.md'),
      entry('workspace', 'a.md'),
      entry('global', 'a.md'),
    ])
    expect(groups.map(group => group.scope)).toEqual(['global', 'workspace'])
    expect(groups[0]!.title).toBe('全局记忆')
    expect(groups[0]!.entries.map(item => item.path)).toEqual(['a.md', 'z.md'])
    expect(groups[1]!.entries.map(item => item.path)).toEqual(['a.md', 'b.md'])
  })

  it('omits scopes with no entries and keeps unknown ones', () => {
    const groups = groupMemory([entry('team', 'x.md')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.scope).toBe('team')
    expect(groups[0]!.title).toBe('team')
  })

  it('returns nothing for an empty list', () => {
    expect(groupMemory([])).toEqual([])
  })
})

describe('memory titles and previews', () => {
  it('strips the extension and keeps the folder aside', () => {
    expect(memoryTitle('MEMORY.md')).toBe('MEMORY')
    expect(memoryTitle('daily/2026-11-17.md')).toBe('2026-11-17')
    expect(memoryDir('MEMORY.md')).toBeNull()
    expect(memoryDir('daily/2026-11-17.md')).toBe('daily')
  })

  it('skips headings and strips list/emphasis markers', () => {
    expect(memoryPreview('# 偏好\n\n- **回答** 用中文')).toBe('回答 用中文')
    expect(memoryPreview('# 只有标题\n')).toBe('')
    expect(memoryPreview('> 引用的一句')).toBe('引用的一句')
    expect(memoryPreview('1. 第一条')).toBe('第一条')
  })

  it('truncates with an ellipsis', () => {
    expect(memoryPreview('一二三四五六七八九十', 6)).toBe('一二三四五…')
  })
})

describe('validateMemoryDraft', () => {
  it('accepts a relative markdown path', () => {
    expect(validateMemoryDraft('MEMORY.md', 'hi')).toEqual({ ok: true })
    expect(validateMemoryDraft('daily/2026-11-17.md', '')).toEqual({ ok: true })
  })

  it('rejects absolute, escaping, non-markdown and exotic names', () => {
    expect(validateMemoryDraft('', 'x')).toMatchObject({ ok: false })
    expect(validateMemoryDraft('/etc/passwd.md', 'x')).toMatchObject({ ok: false })
    expect(validateMemoryDraft('../secret.md', 'x')).toMatchObject({ ok: false })
    expect(validateMemoryDraft('notes.txt', 'x')).toMatchObject({ ok: false })
    expect(validateMemoryDraft('中文.md', 'x')).toMatchObject({ ok: false })
    expect(validateMemoryDraft('a b.md', 'x')).toMatchObject({ ok: false })
  })

  it('rejects oversized content', () => {
    expect(validateMemoryDraft('big.md', 'x'.repeat(512 * 1024 + 1))).toMatchObject({ ok: false })
  })
})
