import { afterEach, describe, expect, test } from 'bun:test'

import { createDeviceRelay, isRelayablePath } from '../src/relay/deviceRelay.js'
import { ADMIN_TOKEN, AGENT_TOKEN, authHeader, pairDevice, startGateway, type Harness } from './helpers.js'

type Frame = Record<string, unknown>

/** Drives a relay socket by hand, the way the phone's native service does. */
class RelaySocket {
  readonly frames: Frame[] = []
  private readonly waiters = new Set<() => void>()

  constructor(readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      this.frames.push(JSON.parse(event.data) as Frame)
      for (const wake of this.waiters) wake()
      this.waiters.clear()
    }
  }

  static async connect(url: string, token?: string): Promise<RelaySocket> {
    const socket = new WebSocket(token ? `${url}?token=${encodeURIComponent(token)}` : url)
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('relay socket failed to open'))
    })
    return new RelaySocket(socket)
  }

  /** The credential in the handshake, the way a current client presents it. */
  static async connectWithProtocol(url: string, token: string): Promise<RelaySocket> {
    const socket = new WebSocket(url, [token])
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('relay socket failed to open'))
    })
    return new RelaySocket(socket)
  }

  send(frame: Frame): void {
    this.socket.send(JSON.stringify(frame))
  }

  request(id: string, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): void {
    this.send({
      t: 'http_req',
      id,
      method: init.method ?? 'GET',
      path,
      headers: init.headers ?? {},
      ...(init.body ? { body: Buffer.from(init.body, 'utf8').toString('base64') } : {}),
    })
  }

  async waitForEnd(id: string, timeoutMs = 3000): Promise<Frame[]> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const end = this.frames.findIndex(frame => frame.t === 'http_end' && frame.id === id)
      const failed = this.frames.findIndex(frame => frame.t === 'http_error' && frame.id === id)
      if (failed !== -1 && (end === -1 || failed < end)) return this.frames.slice(0, failed + 1)
      if (end !== -1) return this.frames.slice(0, end + 1)
      await new Promise<void>((resolve) => {
        this.waiters.add(resolve)
        setTimeout(resolve, 20)
      })
    }
    throw new Error(`relay request ${id} did not finish`)
  }

  bodyOf(id: string): string {
    return this.frames
      .filter(frame => frame.t === 'http_chunk' && frame.id === id)
      .map(frame => Buffer.from(String(frame.data), 'base64').toString('utf8'))
      .join('')
  }

  headOf(id: string): Frame {
    const head = this.frames.find(frame => frame.t === 'http_head' && frame.id === id)
    if (!head) throw new Error(`no head for ${id}`)
    return head
  }
}

describe('isRelayablePath', () => {
  test('the session API and proxy are relayable', () => {
    expect(isRelayablePath('/api/sessions')).toBe(true)
    expect(isRelayablePath('/api/sessions/s1/messages?limit=5')).toBe(true)
    expect(isRelayablePath('/proxy/v1/messages')).toBe(true)
    expect(isRelayablePath('/v1/messages')).toBe(true)
  })

  test('admin, pairing, push, and the relay itself are not', () => {
    for (const path of [
      '/admin/devices',
      '/admin/push/test',
      '/pair/start',
      '/pair/claim',
      '/push/register',
      '/relay/device',
      '/relay/agent',
      '/health',
      // A bare collection is not a prefix match; only real sub-resources are.
      '/api',
      '/administrator',
    ]) {
      expect(isRelayablePath(path)).toBe(false)
    }
  })

  test('dot segments and escapes cannot walk out of the allowlist', () => {
    // The request the gateway rebuilds is the resolved URL, so a raw prefix
    // match used to say yes to paths that land somewhere else entirely.
    for (const path of [
      '/api/../push/register',
      '/api/../auth/login',
      '/api/%2e%2e/push/register',
      '/api/..%2f..%2fadmin/health',
      '/api/sessions/../../admin/devices',
      '/api\\..\\push/register',
      '/api/%2e%2e%2f%2e%2e/admin/audit',
    ]) {
      expect(isRelayablePath(path), path).toBe(false)
    }
    // Percent-encoded characters that decode harmlessly stay relayable.
    expect(isRelayablePath('/api/sessions/a%20b')).toBe(true)
  })
})

/** Polls a condition so a test does not race a background timer. */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(5)
  }
  throw new Error('condition not met before the deadline')
}

/** The smallest thing that can stand in for the desktop agent on the tunnel. */
function answerAsAgent(socket: WebSocket, body: string): void {
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    const frame = JSON.parse(event.data) as { t?: string; id?: string }
    if (frame.t !== 'http_req' || !frame.id) return
    const id = frame.id
    socket.send(JSON.stringify({ t: 'http_head', id, status: 200, headers: { 'content-type': 'application/json' } }))
    socket.send(JSON.stringify({ t: 'http_chunk', id, data: Buffer.from(body, 'utf8').toString('base64') }))
    socket.send(JSON.stringify({ t: 'http_end', id }))
  }
}

describe('device relay tunnel', () => {
  let harness: Harness
  afterEach(() => harness?.close())

  test('a relayed request runs through the real app with the socket\'s token', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/api/sessions')
      const frames = await relay.waitForEnd('r1')
      expect(frames.map(frame => frame.t)).toEqual(['http_head', 'http_chunk', 'http_end'])
      expect(relay.headOf('r1').status).toBe(200)
      const payload = JSON.parse(relay.bodyOf('r1')) as { sessions: unknown[]; gatewayDevice: string }
      expect(payload.sessions).toEqual([{ id: 's1' }])
      // The upstream sees the phone's device id, injected by the gateway.
      expect(payload.gatewayDevice).toBe(device.deviceId)
    } finally {
      relay.socket.close()
    }
  })

  test('a relay socket authenticates from the handshake instead of the URL', async () => {
    // The phone's native service presents the token as the websocket protocol
    // so it never lands in a URL. The gateway echoes the protocol back, which
    // is what makes the handshake succeed for a browser or undici client.
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connectWithProtocol(
      `${harness.url.replace('http', 'ws')}/relay/device`,
      device.deviceToken,
    )
    try {
      relay.request('r1', '/api/sessions')
      await relay.waitForEnd('r1')
      expect(relay.headOf('r1').status).toBe(200)
      expect((JSON.parse(relay.bodyOf('r1')) as { gatewayDevice: string }).gatewayDevice).toBe(device.deviceId)
    } finally {
      relay.socket.close()
    }
  })

  test('a supplied-but-wrong credential is final even in the handshake', async () => {    harness = startGateway()
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/device`, ['dvc_bogus_token'])
    const closed = await new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code)
      socket.onerror = () => resolve(-1)
      setTimeout(() => resolve(-1), 3000)
    })
    expect(closed).toBe(4401)
  })

  test('the relayed client cannot supply its own identity', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/api/headers', {
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          'x-admin-token': ADMIN_TOKEN,
          'x-gateway-device': 'someone-else',
        },
      })
      await relay.waitForEnd('r1')
      const { headers } = JSON.parse(relay.bodyOf('r1')) as { headers: Record<string, string> }
      // The client's claims are dropped outright, and the upstream identity is
      // the phone's — never the admin token the LAN client tried to assert.
      expect(headers.authorization).toBeUndefined()
      expect(headers['x-admin-token']).toBeUndefined()
      expect(headers['x-gateway-device']).toBe(device.deviceId)
    } finally {
      relay.socket.close()
    }
  })

  test('a non-relayable path is refused before it reaches the app', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/admin/devices')
      const frames = await relay.waitForEnd('r1')
      expect(frames).toEqual([{ t: 'http_error', id: 'r1', message: 'path is not relayable' }])
    } finally {
      relay.socket.close()
    }
  })

  test('a POST body is forwarded and a write is authorized by scope', async () => {
    harness = startGateway()
    const device = await pairDevice(harness, { scopes: ['sessions:read'] })
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/api/sessions/s1/messages', { method: 'POST', body: '{"content":"hi"}' })
      await relay.waitForEnd('r1')
      // Read-only scopes cannot write, and the refusal comes from the same
      // handler a direct client would hit.
      expect(relay.headOf('r1').status).toBe(403)
    } finally {
      relay.socket.close()
    }
  })

  test('a revoked device loses its relay on the next request', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/api/sessions')
      await relay.waitForEnd('r1')
      expect(relay.headOf('r1').status).toBe(200)

      // The socket authenticated once at upgrade; revocation closes it instead
      // of leaving it streaming until the client felt like reconnecting.
      const closed = new Promise<number>((resolve) => {
        relay.socket.onclose = event => resolve(event.code)
      })
      await fetch(`${harness.url}/admin/devices/${device.deviceId}/revoke`, {
        method: 'POST',
        headers: authHeader(ADMIN_TOKEN),
      })
      expect(await closed).toBe(4403)
    } finally {
      relay.socket.close()
    }
  })

  test('an unauthenticated socket is closed', async () => {
    harness = startGateway()
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/device?token=dvc_nope_nope`)
    const code = await new Promise<number>((resolve) => {
      socket.onclose = event => resolve(event.code)
      socket.onerror = () => resolve(-1)
    })
    expect(code).toBe(4401)
  })

  test('a socket that authenticates by first frame is accepted', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/device`)
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('open failed'))
    })
    const relay = new RelaySocket(socket)
    relay.send({ type: 'auth', token: device.deviceToken })
    relay.request('r1', '/api/sessions')
    await relay.waitForEnd('r1')
    expect(relay.headOf('r1').status).toBe(200)
    relay.socket.close()
  })

  test('health counts an attached relay', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as { relaySockets: number }
      expect(health.relaySockets).toBe(1)
    } finally {
      relay.socket.close()
    }
  })
})

describe('device relay in isolation', () => {
  test('a streaming body is forwarded while it is still open, not buffered', async () => {
    // A stream the test drives by hand: each part is only written once the
    // previous one has already been observed on the wire.
    let push!: (text: string) => void
    let finish!: () => void
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = text => controller.enqueue(encoder.encode(text))
        finish = () => controller.close()
      },
    })
    const seen: Frame[] = []
    const relay = createDeviceRelay({
      app: { fetch: () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) } as never,
      deviceToken: 'dvc_x_y',
      maxBodyBytes: 1024,
      emit: frame => { seen.push(frame) },
    })
    const chunks = () => seen.filter(frame => frame.t === 'http_chunk').length

    relay.receive(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/sessions' }))
    await waitFor(() => seen.some(frame => frame.t === 'http_head'))
    expect(chunks()).toBe(0)

    push('event: message_start\n\n')
    await waitFor(() => chunks() === 1)
    // The head and the first chunk are already on the wire while the response
    // is still open: an SSE turn cannot be buffered until the answer is done.
    expect(seen.some(frame => frame.t === 'http_end')).toBe(false)

    push('event: content_block_delta\n\n')
    await waitFor(() => chunks() === 2)
    finish()
    await waitFor(() => seen.some(frame => frame.t === 'http_end'))
    relay.close()
  })

  test('an abort cancels the in-flight request without an error frame', async () => {
    const seen: Frame[] = []
    const app = {
      fetch: (request: Request) => new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    }
    const relay = createDeviceRelay({
      app: app as never,
      deviceToken: 'dvc_x_y',
      maxBodyBytes: 1024,
      emit: frame => { seen.push(frame) },
    })
    relay.receive(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/sessions' }))
    relay.receive(JSON.stringify({ t: 'http_abort', id: 'r1' }))
    await Bun.sleep(20)
    expect(seen).toEqual([])
    relay.close()
  })

  test('an oversized body is refused before the app sees it', async () => {
    const seen: Frame[] = []
    const relay = createDeviceRelay({
      app: { fetch: () => Response.json({ ok: true }) } as never,
      deviceToken: 'dvc_x_y',
      maxBodyBytes: 4,
      emit: frame => { seen.push(frame) },
    })
    relay.receive(JSON.stringify({
      t: 'http_req',
      id: 'r1',
      method: 'POST',
      path: '/api/sessions',
      body: Buffer.from('way too long').toString('base64'),
    }))
    await Bun.sleep(20)
    expect(seen).toEqual([{ t: 'http_error', id: 'r1', message: 'request body too large' }])
    relay.close()
  })

  test('an app that throws becomes an error frame, not a dropped socket', async () => {
    const seen: Frame[] = []
    const relay = createDeviceRelay({
      app: { fetch: () => { throw new Error('handler exploded') } } as never,
      deviceToken: 'dvc_x_y',
      maxBodyBytes: 1024,
      emit: frame => { seen.push(frame) },
    })
    relay.receive(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/sessions' }))
    await Bun.sleep(20)
    expect(seen).toEqual([{ t: 'http_error', id: 'r1', message: 'handler exploded' }])
    relay.close()
  })

  test('the relay key stops at the phone and never reaches the gateway', async () => {
    // x-relay-key is the phone's LAN gate. The gateway has no use for it, and
    // forwarding it would hand a LAN credential to the desktop.
    let seenAuthorization: string | null = null
    let seenRelayKey: string | null = null
    const app = {
      fetch: (request: Request) => {
        seenAuthorization = request.headers.get('authorization')
        seenRelayKey = request.headers.get('x-relay-key')
        return Response.json({ ok: true })
      },
    }
    const relay = createDeviceRelay({
      app: app as never,
      deviceToken: 'dvc_real_token',
      maxBodyBytes: 1024,
      emit: () => {},
    })
    relay.receive(JSON.stringify({
      t: 'http_req',
      id: 'r1',
      method: 'GET',
      path: '/api/sessions',
      headers: { 'x-relay-key': 'stolen-key-should-not-travel' },
    }))
    await Bun.sleep(20)
    expect<string | null>(seenRelayKey).toBeNull()
    expect<string | null>(seenAuthorization).toBe('Bearer dvc_real_token')
    relay.close()
  })
})

describe('relay and direct access agree', () => {
  let harness: Harness
  afterEach(() => harness?.close())

  test('the same request through a relay and directly returns the same body', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const direct = await (await fetch(`${harness.url}/api/sessions`, {
      headers: authHeader(device.deviceToken),
    })).json() as { sessions: unknown[] }

    const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
    try {
      relay.request('r1', '/api/sessions')
      await relay.waitForEnd('r1')
      expect(JSON.parse(relay.bodyOf('r1'))).toEqual(direct)
    } finally {
      relay.socket.close()
    }
  })

  test('a device relay works while a desktop agent holds the tunnel', async () => {
    // A gateway with both an agent and a relay attached must keep them apart:
    // the agent carries the upstream hop, the relay carries the LAN hop.
    harness = startGateway()
    try {
      const agent = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
        headers: { authorization: `Bearer ${AGENT_TOKEN}` },
      })
      answerAsAgent(agent, JSON.stringify({ sessions: [{ id: 'via-agent' }] }))
      await new Promise<void>((resolve, reject) => {
        agent.onopen = () => resolve()
        agent.onerror = () => reject(new Error('agent failed to open'))
      })

      const device = await pairDevice(harness)
      const relay = await RelaySocket.connect(`${harness.url.replace('http', 'ws')}/relay/device`, device.deviceToken)
      try {
        relay.request('r1', '/api/sessions')
        await relay.waitForEnd('r1')
        expect(relay.headOf('r1').status).toBe(200)
        // The LAN request went phone → gateway → agent tunnel → desktop.
        expect(JSON.parse(relay.bodyOf('r1'))).toEqual({ sessions: [{ id: 'via-agent' }] })
        const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as {
          agentConnected: boolean
          relaySockets: number
        }
        expect(health.agentConnected).toBe(true)
        expect(health.relaySockets).toBe(1)
      } finally {
        relay.socket.close()
        agent.close()
      }
    } finally {
      harness.close()
    }
  })
})
