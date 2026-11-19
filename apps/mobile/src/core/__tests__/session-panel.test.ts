import { describe, expect, it } from 'vitest'

import {
  formatUsage,
  isThinkingLevel,
  nextThinkingLevel,
  resolveArtifactPath,
  thinkingLevelLabel,
  thinkingLevelPayload,
  toArtifacts,
  toExpertOptions,
} from '../session-panel'

describe('toExpertOptions', () => {
  it('keeps the experts the desktop offers', () => {
    expect(toExpertOptions([
      { id: 'e1', name: '架构师', description: '擅长系统设计' },
      { id: 'e2', name: '文档' },
    ])).toEqual([
      { id: 'e1', name: '架构师', description: '擅长系统设计', avatar: undefined },
      { id: 'e2', name: '文档', description: undefined, avatar: undefined },
    ])
  })

  it('falls back to the id when an expert has no name', () => {
    expect(toExpertOptions([{ id: 'e3' }])[0]).toMatchObject({ id: 'e3', name: 'e3' })
  })

  it('drops rows without an id and survives junk', () => {
    expect(toExpertOptions([{ name: '没有 id' }, null, 'nope'])).toEqual([])
    expect(toExpertOptions(undefined)).toEqual([])
    expect(toExpertOptions({})).toEqual([])
  })
})

describe('toArtifacts', () => {
  it('accepts plain paths and objects', () => {
    expect(toArtifacts(['/tmp/a.md', { path: '/tmp/b.png', kind: 'image', bytes: 12 }])).toEqual([
      { path: '/tmp/a.md', kind: undefined, bytes: undefined, updatedAt: undefined },
      { path: '/tmp/b.png', kind: 'image', bytes: 12, updatedAt: undefined },
    ])
  })

  it('ignores entries without a path', () => {
    expect(toArtifacts([{ kind: 'image' }, 42])).toEqual([])
  })
})

describe('formatUsage', () => {
  it('groups digits and adds a percentage', () => {
    expect(formatUsage({ used: 38_400, total: 200_000 })).toBe('38,400 / 200,000 · 19%')
  })

  it('handles zero total and missing numbers', () => {
    expect(formatUsage({ used: 5, total: 0 })).toBe('5 / 0')
    expect(formatUsage({ used: 5 })).toBeUndefined()
    expect(formatUsage()).toBeUndefined()
  })
})

describe('resolveArtifactPath', () => {
  it('joins workspace-relative paths onto the cwd', () => {
    expect(resolveArtifactPath('docs/plan/a.md', '/Users/me/work')).toBe('/Users/me/work/docs/plan/a.md')
    expect(resolveArtifactPath('./docs/a.md', '/Users/me/work/')).toBe('/Users/me/work/docs/a.md')
  })

  it('leaves absolute paths alone', () => {
    expect(resolveArtifactPath('/tmp/a.md', '/Users/me/work')).toBe('/tmp/a.md')
    expect(resolveArtifactPath('C:\\work\\a.md', '/Users/me/work')).toBe('C:\\work\\a.md')
  })

  it('passes through when there is no usable cwd', () => {
    expect(resolveArtifactPath('docs/a.md')).toBe('docs/a.md')
    expect(resolveArtifactPath('docs/a.md', 'relative/dir')).toBe('docs/a.md')
    expect(resolveArtifactPath('  ', '/Users/me')).toBe('')
  })
})

describe('thinking level', () => {
  it('accepts exactly the engine levels', () => {
    expect(isThinkingLevel('off')).toBe(true)
    expect(isThinkingLevel('xhigh')).toBe(true)
    expect(isThinkingLevel('max')).toBe(true)
    expect(isThinkingLevel('turbo')).toBe(false)
    expect(isThinkingLevel(undefined)).toBe(false)
  })

  it('builds the payload the command expects', () => {
    expect(thinkingLevelPayload('high')).toEqual({ level: 'high' })
    expect(thinkingLevelPayload('turbo')).toBeNull()
  })

  it('labels every level', () => {
    expect(thinkingLevelLabel('off')).toBe('关闭')
    expect(thinkingLevelLabel('max')).toBe('最高')
    expect(thinkingLevelLabel(undefined)).toBe('跟随桌面')
  })

  it('cycles through the scale and wraps', () => {
    expect(nextThinkingLevel(undefined)).toBe('medium')
    expect(nextThinkingLevel('medium')).toBe('high')
    expect(nextThinkingLevel('max')).toBe('off')
    expect(nextThinkingLevel('off')).toBe('minimal')
  })
})
