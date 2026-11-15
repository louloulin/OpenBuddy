/**
 * End-to-end smoke test against the real gateway and agent code paths.
 *
 * Topology:
 *   phone (fetch/WebSocket) → gateway → agent (outbound WSS) → mock lumos
 *
 * The gateway's direct upstream is intentionally unreachable, so every success
 * below proves the request travelled through the relay.
 *
 *   bun run smoke
 */

import assert from 'node:assert/strict'
import { websocket } from 'hono/bun'

import { createGateway } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createAgentClient } from '../src/agent.js'

const ADMIN = 'adm_smoke_admin'
const AGENT = 'agt_smoke_agent'
const encoder = new TextEncoder()

function log(step: string): void {
  console.log(`PASS  ${step}`)
}

async function until(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out: ${label}`)
}

// ── Mock lumos desktop server ──────────────────────────────

const upstream = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/ws/')) {
      server.upgrade(req)
      return
    }
    if (url.pathname === '/api/sessions') {
      return Response.json({
        sessions: [{ id: 'smoke-session', title: 'Smoke' }],
        via: 'mock-desktop',
      })
    }
    if (url.pathname === '/api/models') {
      return Response.json({
        models: [{ id: 'smoke-model', name: 'Smoke Model', description: '', context: '200k' }],
        provider: null,
      })
    }
    if (url.pathname === '/proxy/v1/messages') {
      const body = await req.text()
      if (!body.includes('"stream":false')) {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n'))
            await Bun.sleep(10)
            controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"delta":"ok"}\n\n'))
            controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'))
            controller.close()
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      }
      return Response.json({
        id: 'msg_smoke',
        type: 'message',
        role: 'assistant',
        model: 'smoke-model',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2, output_tokens: 1 },
      })
    }
    return Response.json({ ok: true })
  },
  websocket: {
    open(ws) {
      ws.send('welcome')
    },
    message(ws, message) {
      ws.send(`echo:${message}`)
    },
  },
})
const upstreamUrl = `http://127.0.0.1:${upstream.port}`

// ── Gateway with an unreachable direct upstream ─────────────

const config = {
  ...loadConfig({
    GATEWAY_DB: ':memory:',
    GATEWAY_ADMIN_TOKEN: ADMIN,
    GATEWAY_AGENT_TOKEN: AGENT,
    LUMOS_UPSTREAM_URL: 'http://127.0.0.1:1',
    // This smoke is a single-tenant gateway: the phone pairs with a code
    // that names no computer and reads the shared upstream.
    GATEWAY_PAIR_ALLOW_SHARED: '1',
  }),
  upstreamUrl: 'http://127.0.0.1:1',
}
const gateway = createGateway(config)
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: gateway.app.fetch,
  websocket,
})
const base = `http://127.0.0.1:${server.port}`
const wsBase = base.replace(/^http/, 'ws')

// ── Desktop agent dials out ─────────────────────────────────

const agent = createAgentClient({
  gatewayUrl: `${wsBase}/relay/agent`,
  agentToken: AGENT,
  getLocalServerUrl: () => upstreamUrl,
  reconnect: false,
  log: message => console.log(`      ${message}`),
})

let failed = false
try {
  await until(() => gateway.hub.connected, 'agent connected')
  log('desktop agent connected over outbound WebSocket')
  console.log(`      health: ${JSON.stringify(await (await fetch(`${base}/health`)).json())}`)

  // Pair
  const startRes = await fetch(`${base}/pair/start`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve', 'proxy'] }),
  })
  assert.equal(startRes.status, 200)
  const { code } = await startRes.json() as { code: string }

  const claimRes = await fetch(`${base}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName: 'Smoke Phone', platform: 'ios' }),
  })
  assert.equal(claimRes.status, 200)
  const device = await claimRes.json() as { deviceId: string; deviceToken: string; scopes: string[] }
  assert.match(device.deviceToken, /^dvc_/)
  log(`device paired with scopes [${device.scopes.join(', ')}]`)

  const auth = { authorization: `Bearer ${device.deviceToken}` }

  // REST through the tunnel
  const sessions = await fetch(`${base}/api/sessions`, { headers: auth })
  assert.equal(sessions.status, 200)
  const payload = await sessions.json() as { sessions: Array<{ id: string }>; via: string }
  assert.equal(payload.via, 'mock-desktop')
  assert.equal(payload.sessions[0]?.id, 'smoke-session')
  log('REST /api/sessions relayed through the tunnel')

  // SSE through the tunnel
  const proxy = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'smoke', messages: [{ role: 'user', content: 'hi' }] }),
  })
  assert.equal(proxy.status, 200)
  assert.match(proxy.headers.get('content-type') ?? '', /text\/event-stream/)
  const sse = await proxy.text()
  for (const event of ['message_start', 'content_block_delta', 'message_stop']) {
    assert.ok(sse.includes(event), `missing SSE event ${event}`)
  }
  log('SSE streamed through the tunnel without buffering')

  // OpenAI-compatible endpoints through the tunnel
  const models = await fetch(`${base}/v1/models`, { headers: auth })
  assert.equal(models.status, 200)
  const modelList = await models.json() as { object: string; data: Array<{ id: string; object: string; owned_by: string }> }
  assert.equal(modelList.object, 'list')
  assert.equal(modelList.data[0]?.id, 'smoke-model')
  assert.equal(modelList.data[0]?.owned_by, 'lumos')
  log('GET /v1/models relayed and normalized through the tunnel')

  const completion = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'smoke-model', messages: [{ role: 'user', content: 'hi' }] }),
  })
  assert.equal(completion.status, 200)
  const chat = await completion.json() as {
    object: string
    model: string
    choices: Array<{ message: { role: string; content: string }; finish_reason: string }>
  }
  assert.equal(chat.object, 'chat.completion')
  assert.equal(chat.model, 'smoke-model')
  assert.equal(chat.choices[0]?.message.role, 'assistant')
  assert.equal(chat.choices[0]?.message.content, 'ok')
  assert.equal(chat.choices[0]?.finish_reason, 'stop')
  log('POST /v1/chat/completions translated through the tunnel')

  const streamed = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'smoke-model', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  })
  assert.equal(streamed.status, 200)
  assert.match(streamed.headers.get('content-type') ?? '', /text\/event-stream/)
  const chunks = await streamed.text()
  assert.ok(chunks.includes('chat.completion.chunk'), 'missing OpenAI chunk')
  assert.ok(chunks.trimEnd().endsWith('data: [DONE]'), 'missing [DONE] terminator')
  log('OpenAI SSE chunks streamed through the tunnel')

  // WebSocket through the tunnel
  const socket = new WebSocket(`${wsBase}/ws/smoke-session`)
  const messages: string[] = []
  socket.onmessage = (event) => {
    messages.push(String(event.data))
  }
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('phone websocket failed'))
  })
  socket.send(JSON.stringify({ type: 'auth', token: device.deviceToken }))
  await until(() => messages.length >= 1, 'welcome frame')
  assert.equal(messages[0], 'welcome')
  socket.send('ping-through-relay')
  await until(() => messages.length >= 2, 'echo frame')
  assert.equal(messages[1], 'echo:ping-through-relay')
  socket.close()
  log('WebSocket frames relayed through the tunnel')

  // Revocation
  const revoke = await fetch(`${base}/admin/devices/${device.deviceId}/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN}` },
  })
  assert.equal(revoke.status, 200)
  const afterRevoke = await fetch(`${base}/api/sessions`, { headers: auth })
  assert.equal(afterRevoke.status, 401)
  log('revoked device is rejected immediately')

  console.log('\nSMOKE PASS — gateway, agent relay, pairing, SSE and WebSocket all verified end to end.')
} catch (error) {
  failed = true
  console.error('\nSMOKE FAIL', error)
} finally {
  agent.close()
  server.stop(true)
  upstream.stop(true)
  gateway.close()
}

process.exit(failed ? 1 : 0)
