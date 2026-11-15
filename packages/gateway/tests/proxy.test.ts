import { afterEach, describe, expect, test } from 'bun:test'

import { authHeader, pairDevice, startGateway, type Harness } from './helpers.js'

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

describe('http proxy', () => {
  test('forwards reads with the paired scope', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['sessions:read'] })

    const res = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(device.deviceToken) })
    expect(res.status).toBe(200)
    const body = await res.json() as { gatewayDevice: string }
    expect(body.gatewayDevice).toBe(device.deviceId)
    expect(harness.upstream.seen.at(-1)?.path).toBe('/api/sessions')
  })

  test('rejects writes without sessions:write', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['sessions:read'] })

    const res = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(403)
  })

  test('keeps proxy models behind the proxy scope', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['sessions:read'] })

    const denied = await fetch(`${harness.url}/proxy/v1/messages`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(denied.status).toBe(403)

    const allowed = await pairDevice(harness, { scopes: ['proxy'] })
    const res = await fetch(`${harness.url}/v1/messages`, {
      method: 'POST',
      headers: { ...authHeader(allowed.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(await res.text()).toContain('content_block_delta')
  })

  test('does not leak device credentials upstream', async () => {
    harness = startGateway({ upstreamToken: 'upstream-secret' })
    const device = await pairDevice(harness)

    const res = await fetch(`${harness.url}/api/headers`, { headers: authHeader(device.deviceToken) })
    const { headers } = await res.json() as { headers: Record<string, string> }
    expect(headers.authorization).toBe('Bearer upstream-secret')
    expect(headers['x-gateway-device']).toBe(device.deviceId)
    expect(headers['x-forwarded-proto']).toBe('http')
    expect(JSON.stringify(headers)).not.toContain(device.deviceToken)
  })

  test('keeps the client key and unknown anthropic headers off the upstream', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const res = await fetch(`${harness.url}/api/headers`, {
      headers: {
        ...authHeader(device.deviceToken),
        'x-api-key': 'sk-ant-client-secret',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-organization-id': 'org-attacker',
      },
    })
    const { headers } = await res.json() as { headers: Record<string, string> }
    // The desktop answers with the key it holds; the client's own key is its
    // business and never becomes the gateway's.
    expect(headers['x-api-key']).toBeUndefined()
    // The two Anthropic headers with real meaning still travel.
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31')
    // Any other anthropic-* header is a client steering the upstream account.
    expect(headers['anthropic-organization-id']).toBeUndefined()
  })

  test('streams SSE through without buffering', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const res = await fetch(`${harness.url}/proxy/v1/messages`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('message_start')
    expect(text).toContain('content_block_delta')
  })

  test('rejects bodies above the configured limit', async () => {
    harness = startGateway({ maxBodyBytes: 16 })
    const device = await pairDevice(harness)

    const res = await fetch(`${harness.url}/api/sessions`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(64) }),
    })
    expect(res.status).toBe(413)
  })

  test('rejects missing and revoked tokens', async () => {
    harness = startGateway()
    expect((await fetch(`${harness.url}/api/sessions`)).status).toBe(401)

    const device = await pairDevice(harness)
    await fetch(`${harness.url}/admin/devices/${device.deviceId}/revoke`, {
      method: 'POST',
      headers: authHeader('adm_test_admin'),
    })
    expect((await fetch(`${harness.url}/api/sessions`, { headers: authHeader(device.deviceToken) })).status).toBe(401)
  })
})
