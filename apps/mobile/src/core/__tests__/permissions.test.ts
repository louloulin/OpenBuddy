import { describe, expect, it } from 'vitest'

import { permissionRuleLabel, permissionRuleSummary, permissionRules } from '../permissions'

describe('permissionRules', () => {
  it('normalizes the desktop list and drops malformed entries', () => {
    expect(permissionRules([
      { action: 'allow', tool: 'bash', pattern: 'git ' },
      { action: 'deny', tool: 'any' },
      { action: 'bogus', tool: 'bash' },
      { action: 'allow' },
      { action: 'ask', tool: 'edit', pattern: '/etc' },
      null,
      'nope',
    ])).toEqual([
      { action: 'allow', tool: 'bash', pattern: 'git ' },
      { action: 'deny', tool: 'any' },
      { action: 'ask', tool: 'edit', pattern: '/etc' },
    ])
  })

  it('returns an empty list for a non-array payload', () => {
    expect(permissionRules(undefined)).toEqual([])
    expect(permissionRules({})).toEqual([])
  })
})

describe('permissionRuleLabel', () => {
  it('includes the pattern only when present', () => {
    expect(permissionRuleLabel({ action: 'allow', tool: 'bash', pattern: 'git ' })).toBe('允许 bash · git ')
    expect(permissionRuleLabel({ action: 'deny', tool: 'any' })).toBe('拒绝 any')
    expect(permissionRuleLabel({ action: 'ask', tool: 'edit' })).toBe('询问 edit')
  })
})

describe('permissionRuleSummary', () => {
  it('counts by action and explains the empty case', () => {
    expect(permissionRuleSummary([])).toContain('没有自定义规则')
    expect(permissionRuleSummary([
      { action: 'allow', tool: 'bash' },
      { action: 'allow', tool: 'read' },
      { action: 'deny', tool: 'any' },
    ])).toBe('3 条 · 允许 2 · 拒绝 1')
    expect(permissionRuleSummary([
      { action: 'ask', tool: 'edit' },
    ])).toBe('1 条 · 允许 0 · 拒绝 0 · 询问 1')
  })
})
