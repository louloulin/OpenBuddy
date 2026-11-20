import { describe, expect, it } from 'vitest'

import { problemFor, problemText } from '../problem'

describe('problemFor', () => {
  // Every string here is copied from the gateway / bridge source, so the table
  // is checked against what those layers actually send.
  it('names the desktop being offline and keeps it actionable', () => {
    expect(problemFor(new Error('desktop offline'))).toMatchObject({ kind: 'offline' })
    expect(problemText('desktop offline')).toContain('电脑不在线')
  })

  it('separates a slow desktop from a dead one', () => {
    expect(problemFor('upstream unavailable').kind).toBe('upstream')
    expect(problemText('http_502')).toContain('稍后重试')
  })

  it('treats a revoked token as an auth problem, not a generic failure', () => {
    expect(problemFor('unauthorized').kind).toBe('auth')
    expect(problemFor('http_401').kind).toBe('auth')
    expect(problemText(new Error('invalid token'))).toContain('重新配对')
  })

  it('recognises a running turn as "queued", not as an error', () => {
    expect(problemFor('agent_busy').kind).toBe('busy')
    expect(problemText('会话忙碌')).toContain('排队')
  })

  it('recognises a phone with no network', () => {
    expect(problemFor(new TypeError('Failed to fetch')).kind).toBe('network')
    expect(problemFor('Network request failed').kind).toBe('network')
  })

  it('flags an older desktop that lacks the command', () => {
    expect(problemFor('unknown command: agent_export_html').kind).toBe('unsupported')
  })

  it('never shows an unmapped English sentence to the user', () => {
    expect(problemText('ECONNRESET at 0x1f')).toBe('操作没有完成，稍后再试。')
    expect(problemText('')).toBe('操作没有完成，稍后再试。')
  })

  it('keeps a message that is already Chinese', () => {
    expect(problemText('电脑上没有这个文件')).toBe('电脑上没有这个文件')
  })

  it('maps rate limiting and generic server errors by status', () => {
    expect(problemText('http_429')).toContain('太频繁')
    expect(problemText('http_503')).toContain('稍后重试')
  })
})

describe('problemFor — the CORS false alarm', () => {
  // Found on a real production build: pairing from the phone failed with
  // 「手机连不上网络」 while the network was fine — the gateway had refused the
  // origin. Chromium reports both as `Failed to fetch`.
  it('blames the gateway origin, not the radio, when CORS is the cause', () => {
    expect(problemFor('Access to fetch at … has been blocked by CORS policy').kind).toBe('blocked')
    expect(problemText('No Access-Control-Allow-Origin header is present')).toContain('网关不允许这个来源')
  })

  it('still blames the radio for a genuine dead network', () => {
    expect(problemFor(new TypeError('Failed to fetch')).kind).toBe('network')
  })
})
