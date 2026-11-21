import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, authHeader, pairDevice, startGateway, type Harness } from './helpers.js'

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

describe('pairing', () => {
  test('requires the admin token to mint a code', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/pair/start`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('pairs a device and issues a working scoped token', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    expect(device.deviceToken).toStartWith('dvc_')
    expect(device.scopes).toEqual(['sessions:read', 'sessions:write', 'approve'])

    const res = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(device.deviceToken) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sessions: [{ id: 's1' }] })
  })

  test('consumes the code exactly once', async () => {
    harness = startGateway()
    const start = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    const { code } = await start.json() as { code: string }
    const claim = () => fetch(`${harness!.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'Phone', platform: 'ios' }),
    })

    expect((await claim()).status).toBe(200)
    expect((await claim()).status).toBe(404)
  })

  test('rejects an expired code', async () => {
    harness = startGateway({ pairTtlMs: 1 })
    const start = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    const { code } = await start.json() as { code: string }
    await Bun.sleep(10)

    const res = await fetch(`${harness!.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'Phone', platform: 'ios' }),
    })
    expect(res.status).toBe(404)
  })

  test('rate limits claim attempts per client', async () => {
    harness = startGateway({ claimLimitPerMinute: 2 })
    const claim = () => fetch(`${harness!.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '00000000', deviceName: 'Phone', platform: 'ios' }),
    })

    expect((await claim()).status).toBe(404)
    expect((await claim()).status).toBe(404)
    expect((await claim()).status).toBe(429)
  })

  test('codes are eight digits, so a code is not a pin', async () => {
    harness = startGateway()
    const start = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    const { code } = await start.json() as { code: string }
    expect(code).toMatch(/^\d{8}$/)
    // The claim route accepts the shape it mints, and only that shape.
    expect((await fetch(`${harness.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code.slice(0, 6), deviceName: 'Phone' }),
    })).status).toBe(400)
  })

  test('rotated forwarding headers cannot mint fresh claim buckets', async () => {
    harness = startGateway({ claimLimitPerMinute: 3 })
    const claimWith = (xff: string) => fetch(`${harness!.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
      body: JSON.stringify({ code: '12345678', deviceName: 'Phone' }),
    })

    // The header is only an address when a trusted proxy is configured; here
    // every call comes from the same socket, so the limit answers.
    expect((await claimWith('10.0.0.1')).status).toBe(404)
    expect((await claimWith('10.0.0.2')).status).toBe(404)
    expect((await claimWith('10.0.0.3')).status).toBe(404)
    expect((await claimWith('10.0.0.4')).status).toBe(429)
    expect((await claimWith('10.0.0.5')).status).toBe(429)
  })

  test('a trusted proxy may key the claim limit on forwarding headers', async () => {
    harness = startGateway({ claimLimitPerMinute: 2, trustProxy: true })
    const claimWith = (xff: string) => fetch(`${harness!.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
      body: JSON.stringify({ code: '12345678', deviceName: 'Phone' }),
    })

    // Two attempts from one client exhaust that client's bucket…
    expect((await claimWith('10.0.0.1')).status).toBe(404)
    expect((await claimWith('10.0.0.1')).status).toBe(404)
    expect((await claimWith('10.0.0.1')).status).toBe(429)
    // …while another client behind the same proxy is untouched.
    expect((await claimWith('10.0.0.2')).status).toBe(404)
  })

  test('an oversized claim body is refused before it is buffered', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '12345678', deviceName: 'Phone', pad: 'x'.repeat(1024 * 1024 + 1) }),
    })
    expect(res.status).toBe(413)
  })

  test('filters unknown scopes instead of granting them', async () => {
    harness = startGateway()
    const start = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ scopes: ['sessions:read', 'root'] }),
    })
    expect((await start.json() as { scopes: string[] }).scopes).toEqual(['sessions:read'])
  })

  test('revocation takes effect immediately', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const revoke = await fetch(`${harness.url}/admin/devices/${device.deviceId}/revoke`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    expect(revoke.status).toBe(200)

    const res = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(device.deviceToken) })
    expect(res.status).toBe(401)
  })

  test('lists devices and audit events for the admin', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const devices = await fetch(`${harness.url}/admin/devices`, { headers: authHeader(ADMIN_TOKEN) })
    const { devices: list } = await devices.json() as { devices: Array<{ id: string }> }
    expect(list.map(item => item.id)).toContain(device.deviceId)

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader(ADMIN_TOKEN) })
    const { audit: events } = await audit.json() as { audit: Array<{ action: string }> }
    expect(events.some(event => event.action === 'device_paired')).toBe(true)
  })
})
