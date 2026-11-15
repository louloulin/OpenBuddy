import { afterEach, describe, expect, test } from 'bun:test'

import { createPushWatchers } from '../src/push/watchers.js'
import { Store } from '../src/store.js'
import {
  AGENT_TOKEN,
  authHeader,
  enrollDesktop,
  pairDevice,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

/**
 * Push delivery for a shared gateway.
 *
 * Two accounts, two computers, and one relay that records what it receives.
 * The rule these tests defend: a notification belongs to the sessions of one
 * desktop and reaches only that desktop's phones — never the other user's.
 */

let harness: Harness | null = null
const servers: Array<{ stop: (force?: boolean) => void }> = []

afterEach(() => {
  harness?.close()
  harness = null
  for (const server of servers.splice(0)) server.stop(true)
})

/** A webhook endpoint that records every notification body it receives. */
function relayServer() {
  const received: Array<Record<string, unknown>> = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      received.push(await req.json() as Record<string, unknown>)
      return Response.json({ ok: true })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/hook`, received }
}

async function registerPush(harness: Harness, deviceToken: string, url: string): Promise<void> {
  const response = await fetch(`${harness.url}/push/register`, {
    method: 'POST',
    headers: { ...authHeader(deviceToken), 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'webhook', token: url }),
  })
  expect(response.status).toBe(200)
}

async function connectAgent(harness: Harness, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
    headers: { authorization: `Bearer ${token}` },
  })
  socket.onmessage = () => undefined
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('agent failed to open'))
  })
  return socket
}

describe('notification scoping', () => {
  test('a desktop notification reaches only that desktop\'s phones', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })
    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)

    const aliceRelay = relayServer()
    const bobRelay = relayServer()
    await registerPush(harness, alicePhone.deviceToken, aliceRelay.url)
    await registerPush(harness, bobPhone.deviceToken, bobRelay.url)

    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(aliceDesktop.agentToken), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 'alice-session' }),
    })
    expect(response.status).toBe(200)
    const report = await response.json() as { report: { considered: number; delivered: number } }
    expect(report.report).toMatchObject({ considered: 1, delivered: 1 })

    expect(aliceRelay.received).toHaveLength(1)
    expect(aliceRelay.received[0]).toMatchObject({ kind: 'approval', sessionId: 'alice-session' })
    // Bob's phone heard nothing about Alice's session.
    expect(bobRelay.received).toHaveLength(0)
  })

  test('an agent cannot notify another desktop\'s device by id', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)

    const bobRelay = relayServer()
    await registerPush(harness, bobPhone.deviceToken, bobRelay.url)

    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(aliceDesktop.agentToken), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1', deviceId: bobPhone.deviceId }),
    })

    expect(response.status).toBe(404)
    expect(bobRelay.received).toHaveLength(0)
  })

  test('an agent may name one of its own devices', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const phone = await provisionDevice(harness, alice.token, desktop.desktop.id)
    const relay = relayServer()
    await registerPush(harness, phone.deviceToken, relay.url)

    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(desktop.agentToken), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'done', sessionId: 's1', deviceId: phone.deviceId }),
    })

    expect(response.status).toBe(200)
    expect(relay.received).toHaveLength(1)
  })

  test('the legacy shared agent cannot page a desktop-bound device by id', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const phone = await provisionDevice(harness, alice.token, desktop.desktop.id)

    const relay = relayServer()
    await registerPush(harness, phone.deviceToken, relay.url)

    // The shared agent is the desktop of the shared route only. Naming a
    // device that belongs to somebody else's computer is not its to page.
    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(AGENT_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1', deviceId: phone.deviceId }),
    })

    expect(response.status).toBe(404)
    expect(relay.received).toHaveLength(0)
  })

  test('the legacy shared agent still pages the shared route\'s phones', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const phone = await pairDevice(harness)

    const relay = relayServer()
    await registerPush(harness, phone.deviceToken, relay.url)

    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(AGENT_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1', deviceId: phone.deviceId }),
    })

    expect(response.status).toBe(200)
    expect(relay.received).toHaveLength(1)
  })

  test('the admin token still reaches every registration', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })
    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)

    const aliceRelay = relayServer()
    const bobRelay = relayServer()
    await registerPush(harness, alicePhone.deviceToken, aliceRelay.url)
    await registerPush(harness, bobPhone.deviceToken, bobRelay.url)

    const { ADMIN_TOKEN } = await import('./helpers.js')
    const response = await fetch(`${harness.url}/admin/push/test`, {
      method: 'POST',
      headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1' }),
    })

    expect(response.status).toBe(200)
    expect(aliceRelay.received).toHaveLength(1)
    expect(bobRelay.received).toHaveLength(1)
  })

  test('an unknown publisher is refused', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader('dsk_unknown_secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1' }),
    })
    expect(response.status).toBe(401)
  })
})

describe('per-desktop watchers', () => {
  test('a watcher exists per desktop with registrations, and only while online', () => {
    const store = new Store(':memory:')
    try {
      const user = store.createUser({
        id: 'user-1',
        email: 'a@example.com',
        passwordHash: 'hash',
        displayName: null,
      })
      const online = store.upsertDesktop({
        userId: user.id,
        installationId: 'machine-online',
        name: 'Online',
        platform: 'darwin',
        tokenHash: 'h1',
      })
      const offline = store.upsertDesktop({
        userId: user.id,
        installationId: 'machine-offline',
        name: 'Offline',
        platform: 'darwin',
        tokenHash: 'h2',
      })
      for (const desktop of [online, offline]) {
        const device = store.upsertDesktopDevice({
          userId: user.id,
          desktopId: desktop.id,
          installationId: `phone-${desktop.id}`,
          name: 'Phone',
          platform: 'android',
          tokenHash: 'h',
          scopesJson: '["sessions:read"]',
        })
        store.upsertPushRegistration(
          {
            deviceId: device!.id,
            provider: 'webhook',
            token: `https://example.com/${desktop.id}`,
            platform: 'android',
          },
          Date.now(),
        )
      }

      const hub = {
        isOnline: (id: string) => id === online.id,
        legacyConnected: false,
      } as never
      const watchers = createPushWatchers({
        store,
        hub,
        upstreamUrl: 'http://127.0.0.1:1',
        legacyEnabled: false,
        onEvents: () => undefined,
        onError: () => undefined,
      })
      try {
        watchers.sync()
        // Only the online desktop is polled; the offline one costs nothing.
        expect(watchers.watched()).toEqual([online.id])
      } finally {
        watchers.stop()
      }
    } finally {
      store.close()
    }
  })

  test('a watcher goes away with its registration', () => {
    const store = new Store(':memory:')
    try {
      const user = store.createUser({
        id: 'user-1',
        email: 'a@example.com',
        passwordHash: 'hash',
        displayName: null,
      })
      const desktop = store.upsertDesktop({
        userId: user.id,
        installationId: 'machine',
        name: 'Machine',
        platform: 'darwin',
        tokenHash: 'h',
      })
      const device = store.upsertDesktopDevice({
        userId: user.id,
        desktopId: desktop.id,
        installationId: 'phone',
        name: 'Phone',
        platform: 'android',
        tokenHash: 'h',
        scopesJson: '["sessions:read"]',
      })
      store.upsertPushRegistration(
        {
          deviceId: device!.id,
          provider: 'webhook',
          token: 'https://example.com/hook',
          platform: 'android',
        },
        Date.now(),
      )

      const hub = { isOnline: () => true, legacyConnected: false } as never
      const watchers = createPushWatchers({
        store,
        hub,
        upstreamUrl: 'http://127.0.0.1:1',
        legacyEnabled: false,
        onEvents: () => undefined,
        onError: () => undefined,
      })
      try {
        watchers.sync()
        expect(watchers.size()).toBe(1)
        store.deleteDevicePushRegistrations(device!.id)
        watchers.sync()
        expect(watchers.size()).toBe(0)
      } finally {
        watchers.stop()
      }
    } finally {
      store.close()
    }
  })
})

describe('desktop presence', () => {
  test('an agent reconnect keeps its registrations deliverable', async () => {
    harness = startGateway({ webhookAllowCleartext: true, pushWatch: false })
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const phone = await provisionDevice(harness, alice.token, desktop.desktop.id)
    const relay = relayServer()
    await registerPush(harness, phone.deviceToken, relay.url)

    const socket = await connectAgent(harness, desktop.agentToken)
    socket.close()
    await Bun.sleep(20)
    expect(harness.gateway.hub.isOnline(desktop.desktop.id)).toBe(false)

    const response = await fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: { ...authHeader(desktop.agentToken), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval', sessionId: 's1' }),
    })
    // Push does not depend on the agent socket: it is the gateway's own send.
    expect(response.status).toBe(200)
    expect(relay.received).toHaveLength(1)
  })
})
