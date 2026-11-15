import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, authHeader, collect, pairDevice, startGateway, waitForClose, waitForOpen, type Harness } from './helpers.js'

let harness: Harness | null = null
const sockets: WebSocket[] = []

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close()
    } catch {
      // already closed
    }
  }
  harness?.close()
  harness = null
})

function wsUrl(harness: Harness, path: string): string {
  return `${harness.url.replace(/^http/, 'ws')}${path}`
}

describe('websocket proxy', () => {
  test('authenticates with a query token and relays both directions', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const socket = new WebSocket(wsUrl(harness, `/ws/session-1?token=${encodeURIComponent(device.deviceToken)}&clientKind=full`))
    sockets.push(socket)
    const collector = collect(socket)
    await waitForOpen(socket)
    expect(await collector.waitFor(1)).toEqual(['welcome'])

    socket.send('hello')
    expect(await collector.waitFor(2)).toEqual(['welcome', 'echo:hello'])
    // The gateway must not leak its own credential into the upstream URL.
    expect(harness.upstream.seen.length).toBe(0)
  })

  test('authenticates a native client that carries the token in the Authorization header', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    // A native client keeps the credential in the header: the browser WebSocket
    // API cannot set headers, but React Native can, and putting a bearer token
    // in a URL leaks it into access logs and proxies.
    const socket = new WebSocket(wsUrl(harness, '/ws/session-header'), {
      headers: { authorization: `Bearer ${device.deviceToken}` },
    })
    sockets.push(socket)
    const collector = collect(socket)
    await waitForOpen(socket)
    expect(await collector.waitFor(1)).toEqual(['welcome'])

    socket.send('header-auth')
    expect(await collector.waitFor(2)).toEqual(['welcome', 'echo:header-auth'])
  })

  test('accepts an auth frame instead of a token in the URL', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const socket = new WebSocket(wsUrl(harness, '/ws/session-2'))
    sockets.push(socket)
    const collector = collect(socket)
    await waitForOpen(socket)
    socket.send(JSON.stringify({ type: 'auth', token: device.deviceToken }))

    expect(await collector.waitFor(1)).toEqual(['welcome'])
    socket.send('frame-auth')
    expect(await collector.waitFor(2)).toEqual(['welcome', 'echo:frame-auth'])
  })

  test('closes unauthorized sockets', async () => {
    harness = startGateway()
    const socket = new WebSocket(wsUrl(harness, '/ws/session-3?token=dvc_nope_bad'))
    sockets.push(socket)
    await waitForOpen(socket).catch(() => {})
    // A non-auth first frame is rejected immediately rather than waiting for
    // the 5s handshake timeout.
    socket.send('hello')
    expect(await waitForClose(socket)).toBe(4401)
  })

  test('rejects a device without sessions:read', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['proxy'] })

    const socket = new WebSocket(wsUrl(harness, `/ws/session-4?token=${encodeURIComponent(device.deviceToken)}`))
    sockets.push(socket)
    await waitForOpen(socket).catch(() => {})
    expect(await waitForClose(socket)).toBe(4403)
  })

  test('revoking the device closes a session bridge that already passed the handshake', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const socket = new WebSocket(wsUrl(harness, `/ws/session-5?token=${encodeURIComponent(device.deviceToken)}`))
    sockets.push(socket)
    const collector = collect(socket)
    await waitForOpen(socket)
    expect(await collector.waitFor(1)).toEqual(['welcome'])

    const closed = waitForClose(socket)
    await fetch(`${harness.url}/admin/devices/${device.deviceId}/revoke`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    // An authenticated-once socket used to keep streaming until the client
    // reconnected; the registry now ends it with the credential.
    expect(await closed).toBe(4403)
  })
})
