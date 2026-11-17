import { afterEach, describe, expect, test } from 'bun:test'

import { agentRelayUrl, createAgentClient, type AgentClient } from '../src/agent.js'
import {
  ADMIN_TOKEN,
  AGENT_TOKEN,
  collect,
  pairDevice,
  startGateway,
  waitForOpen,
  type Harness,
} from './helpers.js'

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

async function until(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('condition not met in time')
}

function startAgent(harness: Harness): AgentClient {
  return createAgentClient({
    gatewayUrl: `${harness.url.replace(/^http/, 'ws')}/relay/agent`,
    agentToken: AGENT_TOKEN,
    // The gateway itself cannot reach this address (upstreamUrl points at a
    // closed port), so anything that succeeds proves the tunnel was used.
    getLocalServerUrl: () => harness.upstream.url,
    reconnect: false,
    log: () => {},
  })
}

describe('agent tunnel', () => {
  test('the tunnel endpoint hangs off a gateway base path', () => {
    expect(agentRelayUrl('https://gw.example.com', '/relay/agent', 'tok'))
      .toBe('https://gw.example.com/relay/agent?token=tok')
    expect(agentRelayUrl('https://gw.example.com/openbuddy/', '/relay/agent', 'tok', { omitToken: true }))
      .toBe('https://gw.example.com/openbuddy/relay/agent')
  })

  test('serves HTTP through the outbound desktop connection', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const agent = startAgent(harness)
    try {
      await until(() => harness!.gateway.hub.connected)
      const device = await pairDevice(harness)

      const res = await fetch(`${harness.url}/api/sessions`, {
        headers: { authorization: `Bearer ${device.deviceToken}` },
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ sessions: [{ id: 's1' }] })

      const health = await fetch(`${harness.url}/admin/health`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })
      expect(await health.json()).toMatchObject({ agentConnected: true })
    } finally {
      agent.close()
    }
  })

  /**
   * The app gates every request on `/health` answering `status: 'ok'` with a
   * JSON content type. A gateway that answers in its own shape instead is
   * treated as unreachable — the shell retries thirty times and then tells the
   * user the address is down, even though it is right there.
   */
  test('health answers the readiness contract the app checks', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const res = await fetch(`${harness.url}/health`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })

  test('streams SSE chunks through the tunnel', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const agent = startAgent(harness)
    try {
      await until(() => harness!.gateway.hub.connected)
      const device = await pairDevice(harness, { scopes: ['proxy'] })

      const res = await fetch(`${harness.url}/proxy/v1/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${device.deviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [] }),
      })
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain('message_start')
      expect(text).toContain('content_block_delta')
    } finally {
      agent.close()
    }
  })

  test('relays websocket frames through the tunnel', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const agent = startAgent(harness)
    const phone = new WebSocket(`${harness.url.replace(/^http/, 'ws')}/ws/tunnel-1`)
    // Arm the collectors before any await: the socket can open while we are
    // still awaiting the pair/agent handshake.
    const collector = collect(phone)
    const opened = waitForOpen(phone)
    try {
      await until(() => harness!.gateway.hub.connected)
      const device = await pairDevice(harness)
      await opened
      phone.send(JSON.stringify({ type: 'auth', token: device.deviceToken }))

      expect(await collector.waitFor(1)).toEqual(['welcome'])
      phone.send('through-the-tunnel')
      expect(await collector.waitFor(2)).toEqual(['welcome', 'echo:through-the-tunnel'])
    } finally {
      phone.close()
      agent.close()
    }
  })

  /**
   * A frame that arrives before the tunnel is open must not take the agent
   * down.
   *
   * The gateway opens the tunnel the moment the client connects, and the
   * client's first frame is forwarded right away — before the local socket
   * finished its handshake. Writing to a socket that is still connecting
   * throws, and an uncaught throw ends the agent, so every tunnel the agent was
   * serving died with it.
   *
   * A stand-in gateway makes the race certain: it sends the open and the frame
   * in one go, so the agent sees the frame while the local socket is still
   * connecting.
   */
  test('a frame that arrives before the tunnel is open does not kill the agent', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const upstream = harness.upstream
    const frames: string[] = []

    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          // The open and the frame arrive together, so the agent has not
          // finished the local handshake when it reads the frame.
          ws.send(JSON.stringify({ t: 'ws_open', id: 'tunnel-1', path: '/ws/session-1' }))
          ws.send(JSON.stringify({ t: 'ws_msg', id: 'tunnel-1', text: 'early-frame' }))
        },
        message(ws, message) {
          frames.push(typeof message === 'string' ? message : '[binary]')
        },
      },
    })

    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'agt_stand_in',
      getLocalServerUrl: () => upstream.url,
      reconnect: false,
      log: () => {},
    })

    try {
      await until(() => frames.some((frame) => frame.includes('echo:early-frame')), 5000)
      // The agent is still running: the frame was held, not dropped.
      expect(agent.connected()).toBe(true)
    } finally {
      agent.close()
      stand.stop(true)
    }
  })
})

describe('agent for a managed desktop', () => {
  /** A stand-in gateway that records how each dial presented its credential. */
  function fakeGateway(options: { legacy?: boolean } = {}): {
    port: number
    dials: Array<{ url: string; protocol: string | null }>
    stop: () => void
  } {
    const dials: Array<{ url: string; protocol: string | null }> = []
    const server = Bun.serve<{ reject: boolean }>({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        const protocol = req.headers.get('sec-websocket-protocol')
        dials.push({ url: req.url, protocol })
        // A gateway predating subprotocol auth reads only the query token: it
        // cannot see the header, so a dial that carries none is unauthorized.
        const token = new URL(req.url).searchParams.get('token')
        const reject = Boolean(options.legacy && !token)
        if (srv.upgrade(req, { data: { reject } })) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          if ((ws.data as { reject: boolean }).reject) ws.close(4401, 'unauthorized')
        },
        message() {},
      },
    })
    return { port: server.port!, dials, stop: () => server.stop(true) }
  }

  test('the desktop credential travels in the websocket handshake, not the URL', async () => {
    // A URL outlives its request in access logs and histories, so the token
    // rides Sec-WebSocket-Protocol: bun and node clients accept a gateway
    // that echoes no protocol back.
    const gateway = fakeGateway()
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${gateway.port}/relay/agent`,
      agentToken: 'dsk_desktop_one_secret',
      getLocalServerUrl: () => 'http://127.0.0.1:1',
      reconnect: false,
      log: () => {},
    })
    try {
      await until(() => gateway.dials.length > 0, 5000)
      const dial = new URL(gateway.dials[0]!.url)
      expect(dial.pathname).toBe('/relay/agent')
      expect(dial.searchParams.get('token')).toBeNull()
      expect(gateway.dials[0]!.protocol).toBe('dsk_desktop_one_secret')
    } finally {
      agent.close()
      gateway.stop()
    }
  })

  test('an older gateway falls back to the deprecated query token', async () => {
    const gateway = fakeGateway({ legacy: true })
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${gateway.port}/relay/agent`,
      agentToken: 'dsk_desktop_old_gateway',
      getLocalServerUrl: () => 'http://127.0.0.1:1',
      log: () => {},
    })
    try {
      // The first dial carries no token at all; after the 4401 the agent
      // downgrades once and reconnects with the query string.
      await until(() => gateway.dials.some(dial => new URL(dial.url).searchParams.get('token')), 10_000)
      const first = new URL(gateway.dials[0]!.url)
      expect(first.searchParams.get('token')).toBeNull()
      expect(gateway.dials[0]!.protocol).toBe('dsk_desktop_old_gateway')
      const fallback = gateway.dials.find(dial => new URL(dial.url).searchParams.get('token'))!
      expect(new URL(fallback.url).searchParams.get('token')).toBe('dsk_desktop_old_gateway')
    } finally {
      agent.close()
      gateway.stop()
    }
  }, 15_000)

  test('a bare gateway URL gets the relay path appended', async () => {
    const gateway = fakeGateway()
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${gateway.port}`,
      agentToken: 'dsk_desktop_two_secret',
      getLocalServerUrl: () => 'http://127.0.0.1:1',
      reconnect: false,
      log: () => {},
    })
    try {
      await until(() => gateway.dials.length > 0, 5000)
      expect(new URL(gateway.dials[0]!.url).pathname).toBe('/relay/agent')
    } finally {
      agent.close()
      gateway.stop()
    }
  })

  test('the desktop credential is added to local requests', async () => {
    // The gateway forwards its own upstream token, which the desktop does not
    // accept. The agent replaces it with the sidecar's local credential.
    const seen: Array<string | null> = []
    const local = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        seen.push(req.headers.get('authorization'))
        return Response.json({ ok: true })
      },
    })
    const received: string[] = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/sessions', headers: { authorization: 'Bearer gateway-upstream-token' } }))
        },
        message(ws, message) {
          if (typeof message === 'string') received.push(message)
        },
      },
    })

    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_desktop_three_secret',
      getLocalServerUrl: () => `http://127.0.0.1:${local.port}`,
      localAccessToken: 'local-sidecar-secret',
      reconnect: false,
      log: () => {},
    })

    try {
      await until(() => received.some((frame) => frame.includes('"http_end"')), 5000)
      expect(seen).toEqual(['Bearer local-sidecar-secret'])
    } finally {
      agent.close()
      stand.stop(true)
      local.stop(true)
    }
  })

  test('the local server may restart on another port without re-dialing', async () => {
    const first = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json({ from: 'first' }) })
    const second = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json({ from: 'second' }) })
    let current = `http://127.0.0.1:${first.port}`
    const bodies: string[] = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/x', headers: {} }))
          setTimeout(() => ws.send(JSON.stringify({ t: 'http_req', id: 'r2', method: 'GET', path: '/x', headers: {} })), 120)
        },
        message(ws, message) {
          if (typeof message !== 'string') return
          const frame = JSON.parse(message) as { t: string; id: string; data?: string }
          if (frame.t !== 'http_chunk') return
          bodies.push(`${frame.id}:${Buffer.from(frame.data!, 'base64').toString('utf8')}`)
        },
      },
    })

    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_desktop_four_secret',
      getLocalServerUrl: () => current,
      reconnect: false,
      log: () => {},
    })

    try {
      await until(() => bodies.length >= 1, 5000)
      expect(bodies[0]).toBe('r1:{"from":"first"}')
      // The sidecar restarted on a new port; the same tunnel follows it.
      current = `http://127.0.0.1:${second.port}`
      await until(() => bodies.length >= 2, 5000)
      expect(bodies[1]).toBe('r2:{"from":"second"}')
    } finally {
      agent.close()
      stand.stop(true)
      first.stop(true)
      second.stop(true)
    }
  })

  test('a stopped local server answers with an error instead of hanging', async () => {
    const received: string[] = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/x', headers: {} }))
        },
        message(ws, message) {
          if (typeof message === 'string') received.push(message)
        },
      },
    })

    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_desktop_five_secret',
      getLocalServerUrl: () => null,
      reconnect: false,
      log: () => {},
    })

    try {
      await until(() => received.some((frame) => frame.includes('http_error')), 5000)
      expect(received.some((frame) => frame.includes('local server is not running'))).toBe(true)
    } finally {
      agent.close()
      stand.stop(true)
    }
  })
})
