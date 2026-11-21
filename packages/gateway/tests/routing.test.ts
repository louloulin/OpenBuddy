import { afterEach, describe, expect, test } from 'bun:test'

import {
  ADMIN_TOKEN,
  authHeader,
  enrollDesktop,
  pairDevice,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

/**
 * Multi-desktop routing.
 *
 * Two accounts, two computers, one gateway. The rule these tests defend is the
 * only one that makes a shared gateway safe: a phone reaches the desktop it was
 * paired with, and nothing else — not another user's desktop, not the gateway's
 * own upstream, and not a sibling computer on the same account.
 */

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

/** Connects a desktop agent and answers every tunneled HTTP request with `body`. */
async function connectAgent(url: string, token: string, body: string): Promise<WebSocket> {
  const socket = new WebSocket(`${url.replace('http', 'ws')}/relay/agent`, {
    headers: { authorization: `Bearer ${token}` },
  })
  sockets.push(socket)
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    const frame = JSON.parse(event.data) as { t?: string; id?: string }
    if (frame.t !== 'http_req' || !frame.id) return
    socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status: 200, headers: { 'content-type': 'application/json' } }))
    socket.send(JSON.stringify({ t: 'http_chunk', id: frame.id, data: Buffer.from(body, 'utf8').toString('base64') }))
    socket.send(JSON.stringify({ t: 'http_end', id: frame.id }))
  }
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('agent failed to open'))
  })
  return socket
}

async function waitForOnline(gateway: Harness, desktopId: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (gateway.gateway.hub.isOnline(desktopId)) return
    await Bun.sleep(10)
  }
  throw new Error(`desktop ${desktopId} never came online`)
}

describe('the version endpoint', () => {
  test('answers unauthenticated with a version and the wire protocol', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string; protocol: number }
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
    expect(body.protocol).toBe(1)
  })
})

describe('desktop-scoped routing', () => {
  test('each phone reaches its own desktop', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })

    const aliceDesktop = await enrollDesktop(harness, alice.token, {
      installationId: 'alice-laptop',
      name: 'Alice laptop',
    })
    const bobDesktop = await enrollDesktop(harness, bob.token, {
      installationId: 'bob-laptop',
      name: 'Bob laptop',
    })

    await connectAgent(harness.url, aliceDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'alice-session' }] }))
    await connectAgent(harness.url, bobDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'bob-session' }] }))
    await waitForOnline(harness, aliceDesktop.desktop.id)
    await waitForOnline(harness, bobDesktop.desktop.id)

    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)

    const aliceAnswer = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(alicePhone.deviceToken) })
    const bobAnswer = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(bobPhone.deviceToken) })

    expect(await aliceAnswer.json()).toEqual({ sessions: [{ id: 'alice-session' }] })
    expect(await bobAnswer.json()).toEqual({ sessions: [{ id: 'bob-session' }] })
    // Neither request reached the gateway's own upstream: routing is by agent.
    expect(harness.upstream.seen).toHaveLength(0)
  })

  test('a phone whose desktop is offline gets 503, not another desktop', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })

    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })
    await connectAgent(harness.url, bobDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'bob-session' }] }))
    await waitForOnline(harness, bobDesktop.desktop.id)

    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const response = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(alicePhone.deviceToken) })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'desktop_offline', desktopId: aliceDesktop.desktop.id })
    // Bob's agent was up the whole time, and still saw nothing.
    expect(harness.upstream.seen).toHaveLength(0)
  })

  test('an offline desktop does not fall back to the gateway upstream', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const phone = await provisionDevice(harness, alice.token, desktop.desktop.id)

    const response = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(phone.deviceToken) })
    expect(response.status).toBe(503)
    // The configured upstream would have answered happily; it must not be used.
    expect(harness.upstream.seen).toHaveLength(0)
  })

  test('a pairing code can name its desktop, and the phone then reads only it', async () => {
    // The QR flow mints a code from the desktop's own settings page. Before
    // this, every code-paired phone landed on the gateway's shared route, so
    // two users' phones read the same computer.
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })

    await connectAgent(harness.url, aliceDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'alice-session' }] }))
    await connectAgent(harness.url, bobDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'bob-session' }] }))
    await waitForOnline(harness, aliceDesktop.desktop.id)
    await waitForOnline(harness, bobDesktop.desktop.id)

    const alicePhone = await pairDevice(harness, { desktopId: aliceDesktop.desktop.id })
    const answer = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(alicePhone.deviceToken) })

    expect(await answer.json()).toEqual({ sessions: [{ id: 'alice-session' }] })
    // Neither agent's work crossed over, and the shared upstream was untouched.
    expect(harness.upstream.seen).toHaveLength(0)
  })

  test('a code for an unknown desktop is refused at mint time', async () => {
    harness = startGateway()
    const response = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ desktopId: 'no-such-desktop' }),
    })
    expect(response.status).toBe(404)
  })

  test('an operator can refuse the shared route so every code names a desktop', async () => {
    // A gateway serving several accounts must not mint a code whose device
    // would read whichever computer the gateway happens to share.
    harness = startGateway({ pairAllowsSharedRoute: false })
    const response = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('must name a desktop') })
  })

  test('the legacy agent token still serves devices paired with a code', async () => {
    harness = startGateway()
    const { AGENT_TOKEN } = await import('./helpers.js')
    await connectAgent(harness.url, AGENT_TOKEN, JSON.stringify({ sessions: [{ id: 'legacy-session' }] }))

    const legacyPhone = await pairDevice(harness)
    const response = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(legacyPhone.deviceToken) })

    expect(await response.json()).toEqual({ sessions: [{ id: 'legacy-session' }] })
    const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as {
      agentConnected: boolean
      agentLegacy: boolean
      desktopsOnline: number
    }
    expect(health.agentConnected).toBe(true)
    expect(health.agentLegacy).toBe(true)
    expect(health.desktopsOnline).toBe(0)
  })

  test('health counts enrolled desktops separately from the legacy agent', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const first = await enrollDesktop(harness, alice.token, { installationId: 'laptop-one' })
    const second = await enrollDesktop(harness, alice.token, { installationId: 'laptop-two' })
    await connectAgent(harness.url, first.agentToken, '{}')
    await waitForOnline(harness, first.desktop.id)

    const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as {
      agentConnected: boolean
      agentLegacy: boolean
      desktopsOnline: number
    }
    expect(health.agentConnected).toBe(true)
    expect(health.agentLegacy).toBe(false)
    expect(health.desktopsOnline).toBe(1)
    expect(harness.gateway.hub.isOnline(second.desktop.id)).toBe(false)
  })

  test('an agent token for another desktop cannot take over a socket', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })

    await connectAgent(harness.url, aliceDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'alice' }] }))
    await waitForOnline(harness, aliceDesktop.desktop.id)

    // Bob holds his own credential; attaching it does not disturb Alice's route.
    await connectAgent(harness.url, bobDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'bob' }] }))
    await waitForOnline(harness, bobDesktop.desktop.id)

    expect(harness.gateway.hub.isOnline(aliceDesktop.desktop.id)).toBe(true)
    expect(harness.gateway.hub.isOnline(bobDesktop.desktop.id)).toBe(true)

    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const answer = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(alicePhone.deviceToken) })
    expect(await answer.json()).toEqual({ sessions: [{ id: 'alice' }] })
  })

  test('a revoked desktop credential is refused', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })

    await fetch(`${harness.url}/desktops/${desktop.desktop.id}`, {
      method: 'DELETE',
      headers: authHeader(alice.token),
    })

    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
      headers: { authorization: `Bearer ${desktop.agentToken}` },
    })
    sockets.push(socket)
    const code = await new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code)
    })
    expect(code).toBe(4401)
  })

  test('two agents on one account stay separate', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const laptop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const studio = await enrollDesktop(harness, alice.token, { installationId: 'alice-studio' })

    await connectAgent(harness.url, laptop.agentToken, JSON.stringify({ sessions: [{ id: 'laptop' }] }))
    await connectAgent(harness.url, studio.agentToken, JSON.stringify({ sessions: [{ id: 'studio' }] }))
    await waitForOnline(harness, laptop.desktop.id)
    await waitForOnline(harness, studio.desktop.id)

    const laptopPhone = await provisionDevice(harness, alice.token, laptop.desktop.id, { installationId: 'phone-on-laptop' })
    const studioPhone = await provisionDevice(harness, alice.token, studio.desktop.id, { installationId: 'phone-on-studio' })

    expect(await (await fetch(`${harness.url}/api/sessions`, {
      headers: authHeader(laptopPhone.deviceToken),
    })).json()).toEqual({ sessions: [{ id: 'laptop' }] })
    expect(await (await fetch(`${harness.url}/api/sessions`, {
      headers: authHeader(studioPhone.deviceToken),
    })).json()).toEqual({ sessions: [{ id: 'studio' }] })
  })

  test('a desktop going away fails only its own in-flight requests', async () => {
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })

    // An agent that accepts the request and never answers.
    const silent = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
      headers: { authorization: `Bearer ${aliceDesktop.agentToken}` },
    })
    sockets.push(silent)
    silent.onmessage = () => undefined
    await new Promise<void>((resolve, reject) => {
      silent.onopen = () => resolve()
      silent.onerror = () => reject(new Error('agent failed to open'))
    })
    await connectAgent(harness.url, bobDesktop.agentToken, JSON.stringify({ sessions: [{ id: 'bob' }] }))
    await waitForOnline(harness, aliceDesktop.desktop.id)
    await waitForOnline(harness, bobDesktop.desktop.id)

    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const pending = fetch(`${harness.url}/api/sessions`, { headers: authHeader(alicePhone.deviceToken) })
      .then((response) => response.status)
      .catch(() => 0)

    await Bun.sleep(20)
    silent.close()

    expect(await pending).toBe(502)
    // Bob's desktop is unaffected.
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)
    const bobAnswer = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(bobPhone.deviceToken) })
    expect(await bobAnswer.json()).toEqual({ sessions: [{ id: 'bob' }] })
  })
})
