import { describe, expect, it } from 'vitest'

import {
  LOCK_GRACE_MS, lockUnavailableReason, parseLockSetting, serializeLockSetting, shouldRelock,
} from '../app-lock'

describe('lock setting', () => {
  it('reads only the stored "on" flag', () => {
    expect(parseLockSetting('1')).toBe(true)
    expect(parseLockSetting('0')).toBe(false)
    expect(parseLockSetting(null)).toBe(false)
    expect(parseLockSetting(undefined)).toBe(false)
  })

  it('serialises both states', () => {
    expect(serializeLockSetting(true)).toBe('1')
    expect(serializeLockSetting(false)).toBe('0')
  })
})

describe('shouldRelock', () => {
  const now = 1_000_000

  it('does nothing when the lock is off', () => {
    expect(shouldRelock(false, now - 60_000, now)).toBe(false)
  })

  it('does nothing without a background mark', () => {
    expect(shouldRelock(true, null, now)).toBe(false)
  })

  it('lets a quick app switch through', () => {
    expect(shouldRelock(true, now - 5_000, now)).toBe(false)
  })

  it('locks after the grace window', () => {
    expect(shouldRelock(true, now - LOCK_GRACE_MS, now)).toBe(true)
    expect(shouldRelock(true, now - 10 * 60_000, now)).toBe(true)
  })

  it('honours a custom grace window', () => {
    expect(shouldRelock(true, now - 2_000, now, 1_000)).toBe(true)
  })
})

describe('lockUnavailableReason', () => {
  it('explains every unavailable state and stays silent when ready', () => {
    expect(lockUnavailableReason('ready')).toBeNull()
    for (const state of ['no-hardware', 'not-enrolled', 'unsupported'] as const) {
      expect(lockUnavailableReason(state)?.length).toBeGreaterThan(4)
    }
  })
})
