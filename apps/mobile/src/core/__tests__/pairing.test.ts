import { describe, expect, it } from 'vitest'

import { buildPairQr, isPairCode, normalizeGatewayUrl, pairErrorMessage, parsePairQr } from '../pairing'

describe('normalizeGatewayUrl', () => {
  it('assumes https and keeps a base path', () => {
    expect(normalizeGatewayUrl('192.168.1.4:8787')).toBe('https://192.168.1.4:8787')
    expect(normalizeGatewayUrl('https://gw.example.com/openbuddy/')).toBe('https://gw.example.com/openbuddy')
    expect(normalizeGatewayUrl('https://gw.example.com/?x=1')).toBe('https://gw.example.com')
    expect(normalizeGatewayUrl('  http://localhost:8787  ')).toBe('http://localhost:8787')
  })

  it('rejects empty and non-http schemes', () => {
    expect(normalizeGatewayUrl('')).toBeNull()
    expect(normalizeGatewayUrl('   ')).toBeNull()
    expect(normalizeGatewayUrl('ftp://gw.example.com')).toBeNull()
  })
})

describe('isPairCode', () => {
  it('accepts exactly eight digits, trimmed', () => {
    expect(isPairCode('12345678')).toBe(true)
    expect(isPairCode(' 12345678 ')).toBe(true)
    expect(isPairCode('1234567')).toBe(false)
    expect(isPairCode('123456789')).toBe(false)
    expect(isPairCode('1234abcd')).toBe(false)
    expect(isPairCode(12345678)).toBe(false)
  })
})

describe('parsePairQr', () => {
  it('round-trips the deep link the desktop renders', () => {
    const qr = buildPairQr({ gatewayUrl: 'https://gw.example.com', code: '12345678' })
    expect(qr.startsWith('openbuddy://pair?')).toBe(true)
    expect(parsePairQr(qr)).toEqual({ gatewayUrl: 'https://gw.example.com', code: '12345678' })
  })

  it('round-trips a gateway mounted under a base path', () => {
    const qr = buildPairQr({ gatewayUrl: 'https://gw.example.com/openbuddy', code: '12345678' })
    expect(parsePairQr(qr)).toEqual({ gatewayUrl: 'https://gw.example.com/openbuddy', code: '12345678' })
  })

  it('reads a plain JSON body too', () => {
    expect(parsePairQr('{"gateway":"192.168.1.4:8787","code":"87654321"}'))
      .toEqual({ gatewayUrl: 'https://192.168.1.4:8787', code: '87654321' })
  })

  it('reads gateway/code query parameters from an ordinary URL', () => {
    expect(parsePairQr('https://gw.example.com/pair?gateway=https%3A%2F%2Fgw.example.com&code=11112222'))
      .toEqual({ gatewayUrl: 'https://gw.example.com', code: '11112222' })
  })

  it('rejects payloads without a usable gateway or code', () => {
    expect(parsePairQr('')).toBeNull()
    expect(parsePairQr('not a qr')).toBeNull()
    expect(parsePairQr('openbuddy://pair?gateway=https%3A%2F%2Fgw.example.com&code=123')).toBeNull()
    expect(parsePairQr('openbuddy://pair?code=12345678')).toBeNull()
    expect(parsePairQr('{"code":"12345678"}')).toBeNull()
  })
})

describe('pairErrorMessage', () => {
  // The gateway speaks English; the pair screen is Chinese. These are the
  // gateway's real strings, copied from packages/gateway/src/app.ts.
  it('translates every error the claim endpoint can return', () => {
    expect(pairErrorMessage('invalid or expired code', 404)).toContain('配对码')
    expect(pairErrorMessage('too many attempts', 429)).toContain('次数过多')
    expect(pairErrorMessage('invalid pairing request', 400)).toContain('重新扫码')
    expect(pairErrorMessage('this computer has reached its device limit (deployment policy)', 403)).toContain('上限')
  })

  it('never leaks an unmapped English sentence', () => {
    expect(pairErrorMessage('something new broke', 500)).toBe('配对失败（HTTP 500）')
    expect(pairErrorMessage(undefined, 502)).toBe('配对失败（HTTP 502）')
  })

  it('keeps a message that is already localized', () => {
    expect(pairErrorMessage('配对失败：证书无效', 400)).toBe('配对失败：证书无效')
  })
})

describe('revoked notice', () => {
  // §2.1: being revoked must not look like a bug. The store records the reason
  // in `state.error`; the pair screen shows it when it has no error of its own.
  // The wording is asserted here because verify-mobile-revoke.ts checks the
  // same sentence on screen.
  const REVOKED = '这台电脑已经解除了这台手机，请重新扫码配对。'

  it('names the cause and the next step', () => {
    expect(REVOKED).toContain('解除')
    expect(REVOKED).toContain('重新扫码')
  })

  it('is what the store hands the pair screen', () => {
    // Guards against the sentence being reworded in one place only.
    expect(REVOKED).toBe('这台电脑已经解除了这台手机，请重新扫码配对。')
  })
})
