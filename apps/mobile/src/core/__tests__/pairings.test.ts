import { describe, expect, it } from 'vitest'

import {
  findPairing, hostOf, makePairingRecord, pairingRecordId, removePairing, resolveActiveId, upsertPairing,
} from '../pairings'

const a = makePairingRecord({ gatewayUrl: 'https://a.test', deviceToken: 'tok-a-123456', deviceName: '书房' }, 100)
const b = makePairingRecord({ gatewayUrl: 'https://b.test', deviceToken: 'tok-b-123456', deviceName: '办公室' }, 200)

describe('pairing records', () => {
  it('uses the device name, else the host', () => {
    expect(a.label).toBe('书房')
    expect(makePairingRecord({ gatewayUrl: 'https://c.test:8787/x', deviceToken: 't' }, 1).label).toBe('c.test:8787')
    expect(hostOf('not a url')).toBe('not a url')
  })

  it('keys a pairing stably', () => {
    expect(pairingRecordId('https://a.test', 'abcdefghijkl')).toBe('https://a.test#abcdefghijkl')
    expect(a.id).toBe(pairingRecordId('https://a.test', 'tok-a-123456'))
  })

  it('upserts, dedupes and orders by recent use', () => {
    const list = upsertPairing(upsertPairing([], a), b)
    expect(list.map(item => item.label)).toEqual(['办公室', '书房'])
    const touched = upsertPairing(list, { ...a, lastUsedAt: 300 })
    expect(touched.map(item => item.id)).toEqual([a.id, b.id])
    expect(touched).toHaveLength(2)
  })

  it('removes and resolves the active pairing', () => {
    const list = [b, a]
    expect(removePairing(list, b.id).map(item => item.id)).toEqual([a.id])
    expect(resolveActiveId(list, a.id)).toBe(a.id)
    expect(resolveActiveId(list, 'gone')).toBe(b.id)
    expect(resolveActiveId([], 'x')).toBeUndefined()
    expect(findPairing(list, b.id)?.gatewayUrl).toBe('https://b.test')
  })
})
