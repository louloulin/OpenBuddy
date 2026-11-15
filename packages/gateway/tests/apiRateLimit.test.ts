import { afterEach, describe, expect, test } from 'bun:test'

import { authHeader, pairDevice, startGateway, type Harness } from './helpers.js'

/**
 * The reverse proxy is the hot path of a gateway: every session list, every
 * message a phone sends, every poll of the live status goes through it. The
 * ceilings exist so one credential cannot be turned into a request amplifier;
 * they are deliberately loose enough that a busy client never notices them.
 */

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

describe('the reverse proxy rate limit', () => {
  test('a device that asks too often is told to slow down', async () => {
    harness = startGateway({ apiLimitPerMinute: 2 })
    const device = await pairDevice(harness)

    const call = () => fetch(`${harness!.url}/api/sessions`, { headers: authHeader(device.deviceToken) })
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(429)
  })

  test('one device cannot spend the budget of another device', async () => {
    harness = startGateway({ apiLimitPerMinute: 1 })
    const first = await pairDevice(harness)
    const second = await pairDevice(harness)

    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(first.deviceToken) })).status).toBe(200)
    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(second.deviceToken) })).status).toBe(200)
  })

  test('the address ceiling applies across devices', async () => {
    harness = startGateway({ apiIpLimitPerMinute: 2 })
    const first = await pairDevice(harness)
    const second = await pairDevice(harness)

    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(first.deviceToken) })).status).toBe(200)
    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(second.deviceToken) })).status).toBe(200)
    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(first.deviceToken) })).status).toBe(429)
  })

  test('an unauthenticated flood never consumes a device budget', async () => {
    harness = startGateway({ apiLimitPerMinute: 1 })
    const device = await pairDevice(harness)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fetch(`${harness!.url}/api/sessions`, { headers: authHeader('dvc_not-a-real-token') })
    }
    expect((await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(device.deviceToken) })).status).toBe(200)
  })

  test('the default ceiling leaves room for a busy client', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await fetch(`${harness!.url}/api/sessions`, { headers: authHeader(device.deviceToken) })
      expect(response.status).toBe(200)
    }
  })
})
