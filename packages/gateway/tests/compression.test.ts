import { afterEach, describe, expect, test } from 'bun:test'

import { compressibleResponse, createAgentClient, type AgentClient } from '../src/agentCore.js'
import { AGENT_TOKEN, pairDevice, startGateway, startUpstream, type Harness, type Upstream } from './helpers.js'

/**
 * Compression across the desktop tunnel.
 *
 * The gateway cannot ask for a compressed upstream body: it has to stream SSE
 * frames back untouched, so it sends `accept-encoding: identity` and the agent
 * relays bytes. Every byte then costs 4/3 in base64 inside a JSON WebSocket
 * frame, and a session transcript is tens of megabytes of highly repetitive
 * JSON — measured through the live gateway, one 500 KB history page took
 * several seconds and a 3 MB one took six.
 *
 * So the agent compresses whole JSON bodies for the tunnel, and the gateway
 * inflates them before the client sees anything. The client's request/response
 * contract must be identical; only the wire between two machines we control
 * changes. SSE stays uncompressed, or the phone would stop seeing tokens as
 * they are produced.
 */

let harness: Harness | null = null
let agents: AgentClient[] = []
let locals: Upstream | null = null

afterEach(() => {
  for (const agent of agents.splice(0)) agent.close()
  locals?.close()
  locals = null
  harness?.close()
  harness = null
})

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('condition not met in time')
}

function startAgent(harness: Harness, localUrl: string): AgentClient {
  const agent = createAgentClient({
    gatewayUrl: `${harness.url.replace(/^http/, 'ws')}/relay/agent`,
    agentToken: AGENT_TOKEN,
    getLocalServerUrl: () => localUrl,
    reconnect: false,
    log: () => {},
  })
  agents.push(agent)
  return agent
}

describe('tunnel compression', () => {
  test('a repeated JSON body arrives intact and smaller on the wire', async () => {
    // The gateway's own upstream is unreachable, so a successful read proves
    // the body came through the agent.
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    const body = JSON.stringify({ messages: Array.from({ length: 4000 }, (_, n) => ({ id: n, text: 'repeated transcript row' })) })
    expect(body.length).toBeGreaterThan(100_000)
    locals = startUpstream({ '/api/big': () => Response.json(JSON.parse(body)) })
    startAgent(harness, locals.url)
    await until(() => harness!.gateway.hub.connected)
    const device = await pairDevice(harness)

    const response = await fetch(`${harness.url}/api/big`, { headers: { authorization: `Bearer ${device.deviceToken}` } })
    expect(response.status).toBe(200)
    // The client is never told the body was compressed in transit.
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(await response.text()).toBe(body)
  })

  test('the agent only compresses whole JSON answers, never events or errors', () => {
    const json = (value: string) => new Headers({ 'content-type': value })
    expect(compressibleResponse(json('application/json;charset=utf-8'))).toBe(true)
    expect(compressibleResponse(json('application/json'))).toBe(true)
    // A phone reads SSE frame by frame; gzip would hold the stream in its window.
    expect(compressibleResponse(json('text/event-stream'))).toBe(false)
    // An upstream that already framed its body must be passed through as written.
    const encoded = json('application/json')
    encoded.set('content-encoding', 'br')
    expect(compressibleResponse(encoded)).toBe(false)
    expect(compressibleResponse(json('application/octet-stream'))).toBe(false)
  })

  test('a gateway that never offered gzip gets plain bodies', async () => {
    // A desktop updates independently of the server it dials into. An old
    // gateway would hand a compressed frame to the client undecoded, so the
    // agent waits for the hub's `hello` before it compresses anything.
    const local = startUpstream({ '/api/json': () => Response.json({ ok: true, pad: 'x'.repeat(2048) }) })
    locals = local
    const frames: Array<{ t: string; encoding?: string }> = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          // No `hello`: this gateway does not know about tunnel encoding.
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/json', headers: {} }))
        },
        message(ws, message) {
          if (typeof message === 'string') frames.push(JSON.parse(message) as { t: string; encoding?: string })
        },
      },
    })
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_old_gateway_secret',
      getLocalServerUrl: () => local.url,
      reconnect: false,
      log: () => {},
    })
    agents.push(agent)
    try {
      await until(() => frames.some(frame => frame.t === 'http_end'))
      const head = frames.find(frame => frame.t === 'http_head')
      expect(head?.encoding).toBeUndefined()
      const chunk = frames.find(frame => frame.t === 'http_chunk') as { data?: string } | undefined
      expect(Buffer.from(chunk!.data!, 'base64').toString('utf8')).toContain('"ok":true')
    } finally {
      stand.stop(true)
    }
  })

  test('the tunnel frame is gzipped once the hub says it can inflate it', async () => {
    const local = startUpstream({
      '/api/json': () => Response.json({ rows: Array.from({ length: 2000 }, (_, n) => `row-${n}`) }),
    })
    locals = local
    const frames: Array<{ t: string; encoding?: string; data?: string }> = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ t: 'hello', capabilities: ['gzip'] }))
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/json', headers: {} }))
        },
        message(ws, message) {
          if (typeof message === 'string') frames.push(JSON.parse(message) as { t: string; encoding?: string; data?: string })
        },
      },
    })
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_new_gateway_secret',
      getLocalServerUrl: () => local.url,
      reconnect: false,
      log: () => {},
    })
    agents.push(agent)
    try {
      await until(() => frames.some(frame => frame.t === 'http_end'))
      expect(frames.find(frame => frame.t === 'http_head')?.encoding).toBe('gzip')
      const gzipped = Buffer.from(frames.find(frame => frame.t === 'http_chunk')!.data!, 'base64')
      const inflated = Buffer.from(Bun.gunzipSync(gzipped))
      // Smaller on the wire, and byte-identical after inflation.
      expect(gzipped.byteLength).toBeLessThan(inflated.byteLength / 4)
      expect(JSON.parse(inflated.toString('utf8')).rows).toHaveLength(2000)
    } finally {
      stand.stop(true)
    }
  })

  test('a body that crosses the compression cap is streamed whole, without a hole', async () => {
    // The overflow chunk is the one that tips `size` past the cap. Dropping it
    // used to splice a hole into the JSON and the client got unparseable text,
    // so this pins the seam: the chunk that crossed the cap is forwarded too.
    const local = startUpstream({
      '/api/overflow': () => Response.json({
        rows: Array.from({ length: 400 }, (_, n) => `row-${n}-${'x'.repeat(64)}`),
      }),
    })
    locals = local
    const expected = JSON.stringify(JSON.parse(await (await fetch(`${local.url}/api/overflow`)).text()))
    const frames: Array<{ t: string; encoding?: string; data?: string }> = []
    const stand = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('expected an upgrade', { status: 400 })
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify({ t: 'hello', capabilities: ['gzip'] }))
          ws.send(JSON.stringify({ t: 'http_req', id: 'r1', method: 'GET', path: '/api/overflow', headers: {} }))
        },
        message(ws, message) {
          if (typeof message === 'string') frames.push(JSON.parse(message) as { t: string; encoding?: string; data?: string })
        },
      },
    })
    const agent = createAgentClient({
      gatewayUrl: `ws://127.0.0.1:${stand.port}/relay/agent`,
      agentToken: 'dsk_overflow_secret',
      getLocalServerUrl: () => local.url,
      reconnect: false,
      // One chunk of this body is a few KiB, so a 8 KiB cap lands mid-body.
      compressLimitBytes: 8 * 1024,
      log: () => {},
    })
    agents.push(agent)
    try {
      await until(() => frames.some(frame => frame.t === 'http_end'))
      expect(frames.find(frame => frame.t === 'http_head')?.encoding).toBeUndefined()
      const joined = frames
        .filter(frame => frame.t === 'http_chunk')
        .map(frame => Buffer.from(frame.data!, 'base64').toString('utf8'))
        .join('')
      expect(joined).toBe(expected)
    } finally {
      stand.stop(true)
    }
  })

  test('a non-200 answer is streamed rather than buffered', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    locals = startUpstream({
      '/api/fail': () => Response.json({ error: 'nope', detail: 'x'.repeat(4096) }, { status: 503 }),
    })
    startAgent(harness, locals.url)
    await until(() => harness!.gateway.hub.connected)
    const device = await pairDevice(harness)

    const response = await fetch(`${harness.url}/api/fail`, { headers: { authorization: `Bearer ${device.deviceToken}` } })
    expect(response.status).toBe(503)
    expect((await response.json() as { error: string }).error).toBe('nope')
  })

  test('SSE keeps arriving while the stream is still open', async () => {
    harness = startGateway({ upstreamUrl: 'http://127.0.0.1:1' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    locals = startUpstream({
      '/api/stream': () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('data: first\n\n'))
            // The second event only exists once the client has read the first;
            // buffering for gzip would deadlock this test.
            await gate
            controller.enqueue(encoder.encode('data: second\n\n'))
            controller.close()
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    startAgent(harness, locals.url)
    await until(() => harness!.gateway.hub.connected)
    const device = await pairDevice(harness)

    const response = await fetch(`${harness.url}/api/stream`, { headers: { authorization: `Bearer ${device.deviceToken}` } })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const first = decoder.decode((await reader.read()).value)
    expect(first).toContain('data: first')
    release()
    let rest = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      rest += decoder.decode(value)
    }
    expect(rest).toContain('data: second')
  })
})
