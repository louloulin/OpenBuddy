import { describe, expect, it } from 'vitest'

import { promptScopeLabel, skillScopeLabel, toPrompts, toSkills } from '../skills'

describe('toSkills', () => {
  it('normalizes names, scope, enabled and keeps optional fields', () => {
    expect(toSkills([
      { name: 'pdf', description: '读 PDF', scope: 'user', enabled: true, version: '1.2', market: true, displayName: 'PDF 助手' },
      { name: 'repo-skill', description: '项目技能', scope: 'repo' },
      { name: '', description: 'no name' },
      null,
      'x',
    ])).toEqual([
      { name: 'pdf', displayName: 'PDF 助手', description: '读 PDF', scope: 'user', enabled: true, version: '1.2', market: true },
      { name: 'repo-skill', description: '项目技能', scope: 'repo', enabled: true, market: false },
    ])
  })

  it('defaults enabled to true and drops malformed payloads', () => {
    expect(toSkills(undefined)).toEqual([])
    expect(toSkills({})).toEqual([])
    expect(toSkills([{ name: 'a' }])[0]).toMatchObject({ enabled: true, market: false, scope: 'user' })
  })
})

describe('toPrompts', () => {
  it('normalizes scope and optional hint', () => {
    expect(toPrompts([
      { name: 'summary', description: '总结', scope: 'global', argumentHint: '<dir>' },
      { name: 'ws', description: '项目指令', scope: 'workspace' },
      { nope: true },
    ])).toEqual([
      { name: 'summary', description: '总结', scope: 'global', argumentHint: '<dir>' },
      { name: 'ws', description: '项目指令', scope: 'workspace' },
    ])
  })

  it('returns empty for non-arrays', () => {
    expect(toPrompts(null)).toEqual([])
  })
})

describe('scope labels', () => {
  it('map user/repo and global/workspace to Chinese', () => {
    expect(skillScopeLabel('user')).toBe('全局')
    expect(skillScopeLabel('repo')).toBe('项目')
    expect(promptScopeLabel('global')).toBe('全局')
    expect(promptScopeLabel('workspace')).toBe('项目')
  })
})
