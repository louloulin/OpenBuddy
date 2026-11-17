import { describe, expect, it } from 'vitest'

import { checkNewSession, newSessionCwd, workspaceChoices } from '../new-session'

describe('newSessionCwd', () => {
  it('prefers the current working directory', () => {
    expect(newSessionCwd({ cwd: '/Users/me/work', inbox: '/Users/me/inbox' })).toBe('/Users/me/work')
  })

  it('falls back to the inbox when cwd is absent', () => {
    expect(newSessionCwd({ inbox: '/Users/me/inbox' })).toBe('/Users/me/inbox')
    expect(newSessionCwd({ cwd: '', inbox: '/Users/me/inbox' })).toBe('/Users/me/inbox')
  })

  it('rejects relative paths and NUL bytes', () => {
    expect(newSessionCwd({ cwd: 'work' })).toBeNull()
    expect(newSessionCwd({ cwd: '/a\0b' })).toBeNull()
    expect(newSessionCwd({ cwd: 42 })).toBeNull()
    expect(newSessionCwd(null)).toBeNull()
  })
})

describe('checkNewSession', () => {
  it('passes with a usable directory and a ready auth state', () => {
    expect(checkNewSession({ cwd: '/w', ok: true })).toEqual({ ok: true, cwd: '/w' })
  })

  it('explains a missing directory before anything else', () => {
    expect(checkNewSession({ ok: false })).toMatchObject({ ok: false, reason: expect.stringContaining('工作目录') })
  })

  it('explains that no model is configured', () => {
    expect(checkNewSession({ cwd: '/w', ok: false })).toMatchObject({ ok: false, reason: expect.stringContaining('模型') })
  })
})

describe('workspaceChoices', () => {
  const workspaces = [
    { cwd: '/w/a', sessionCount: 3, lastTitle: '周报' },
    { cwd: '/w/a', sessionCount: 1 },
    { cwd: 'relative/dir' },
    { cwd: '/w/b' },
  ]

  it('puts the current directory first and de-dupes', () => {
    expect(workspaceChoices('/w/a', workspaces).map(row => row.cwd)).toEqual(['/w/a', '/w/b'])
  })

  it('labels the current directory and describes workspaces', () => {
    const rows = workspaceChoices('/w/a', workspaces)
    expect(rows[0]!.detail).toBe('桌面当前目录')
    const described = workspaceChoices(null, [{ cwd: '/w/c', sessionCount: 2, lastTitle: '评审' }])
    expect(described[0]!.detail).toBe('评审 · 2 个会话')
  })

  it('rejects relative paths and honours the cap', () => {
    expect(workspaceChoices(null, [{ cwd: 'x' }, { cwd: '/ok' }]).map(row => row.cwd)).toEqual(['/ok'])
    const many = Array.from({ length: 20 }, (_, i) => ({ cwd: `/w/${i}` }))
    expect(workspaceChoices(null, many, 5)).toHaveLength(5)
  })
})
