import { afterEach, describe, expect, test } from 'bun:test'

import { startGateway, type Harness } from './helpers.js'

let harness: Harness | null = null
afterEach(() => {
  harness?.close()
  harness = null
})

describe('cors', () => {
  test('a listed origin is allowed to read responses', async () => {
    harness = startGateway({ allowedOrigins: ['https://app.example.com'] })
    const res = await fetch(`${harness.url}/health`, {
      headers: { origin: 'https://app.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
  })

  test('an unknown origin gets no allow header, so a browser cannot read the answer', async () => {
    harness = startGateway({ allowedOrigins: ['https://app.example.com'] })
    const res = await fetch(`${harness.url}/health`, {
      headers: { origin: 'https://evil.example.net' },
    })
    // The body still answers (curl and SDKs never send an Origin), but the
    // missing header is what keeps a hostile web page from reading it.
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('origin matching is case-insensitive', async () => {
    harness = startGateway({ allowedOrigins: ['https://App.Example.com'] })
    const res = await fetch(`${harness.url}/health`, {
      headers: { origin: 'https://app.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
  })

  test('requests without an Origin header are unaffected', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/health`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('the default list covers the capacitor shell origins', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/health`, {
      headers: { origin: 'capacitor://localhost' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
  })

  test('preflight from a listed origin is answered', async () => {
    harness = startGateway({ allowedOrigins: ['https://app.example.com'] })
    const res = await fetch(`${harness.url}/api/sessions`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
