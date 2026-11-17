import { describe, expect, it } from 'vitest'

import { checkNewSession, newSessionCwd } from '../new-session'

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
