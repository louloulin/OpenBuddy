import { describe, expect, test } from 'bun:test'

import { slidingWindow } from '../src/rateLimit.js'

describe('sliding window limiter', () => {
  test('enforces the limit inside the window', () => {
    const limiter = slidingWindow(2)
    expect(limiter.allow('ip')).toBe(true)
    expect(limiter.allow('ip', Date.now() + 1)).toBe(true)
    expect(limiter.allow('ip', Date.now() + 2)).toBe(false)
  })

  test('a key recovers once its hits leave the window', () => {
    const limiter = slidingWindow(1, 60_000)
    expect(limiter.allow('ip', 0)).toBe(true)
    expect(limiter.allow('ip', 30_000)).toBe(false)
    expect(limiter.allow('ip', 60_001)).toBe(true)
  })

  test('keys are independent', () => {
    const limiter = slidingWindow(1)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
  })

  test('expired keys are swept once the map grows past the threshold', () => {
    const limiter = slidingWindow(1, 60_000, 8)
    for (let i = 0; i < 20; i += 1) limiter.allow(`expired-${i}`, 0)
    expect(limiter.size()).toBe(20)

    // A public gateway sees millions of short-lived IPs; without the sweep
    // every one of them would sit in the map forever.
    limiter.allow('fresh', 61_000)
    expect(limiter.size()).toBe(1)
    expect(limiter.allow('fresh', 61_001)).toBe(false)
  })

  test('a key with a fresh hit survives the sweep', () => {
    const limiter = slidingWindow(10, 60_000, 4)
    for (let i = 0; i < 10; i += 1) limiter.allow(`expired-${i}`, 0)
    limiter.allow('fresh', 30_000)
    limiter.allow('trigger', 61_000)
    expect(limiter.size()).toBe(2)
    expect(limiter.allow('fresh', 61_001)).toBe(true)
  })

  test('sweep reports how many keys were dropped', () => {
    const limiter = slidingWindow(1, 60_000)
    for (let i = 0; i < 5; i += 1) limiter.allow(`expired-${i}`, 0)
    limiter.allow('fresh', 30_000)
    expect(limiter.sweep(61_000)).toBe(5)
    expect(limiter.size()).toBe(1)
  })
})
