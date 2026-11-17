import { describe, expect, test } from 'bun:test'

import { createBridgeServer, type HostDispatcher } from '../src/server.js'
import { EventBuffer } from '../src/event-buffer.js'
import { isAllowedCommand, scopeForCommand } from '../src/scopes.js'

const TOKEN = 'bridge-test-token'

function fakeDispatcher(overrides: Partial<HostDispatcher> = {}): HostDispatcher & {
  handlers: Map<string, (payload: unknown) => unknown>
  fire: (event: string, payload: unknown) => void
} {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const listeners = new Set<(event: string, payload: unknown) => void>()
  return {
    handlers,
    dispatch: async (command, payload) => {
      const handler = handlers.get(command)
      if (!handler) throw new Error(`no handler for ${command}`)
      return handler(payload)
    },
    listen: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    servedCommands: () => [
      'host_capabilities', 'agent_list_sessions', 'agent_send', 'agent_new_session',
      'agent_resolve_permission', 'window_minimize', 'bogus_command',
    ],
    fire: (event, payload) => {
      for (const listener of listeners) listener(event, payload)
    },
    ...overrides,
  }
}

const auth = { authorization: `Bearer ${TOKEN}` }

describe('scopes', () => {
  test('desktop-native commands are refused', () => {
    expect(isAllowedCommand('window_minimize')).toBe(false)
    expect(isAllowedCommand('dialog_open')).toBe(false)
    expect(isAllowedCommand('write_text_file')).toBe(false)
  })

  test('reads need read scope, writes need write, approvals need approve', () => {
    expect(scopeForCommand('agent_list_sessions')).toBe('sessions:read')
    expect(scopeForCommand('agent_send')).toBe('sessions:write')
    expect(scopeForCommand('agent_resolve_permission')).toBe('approve')
  })
})

describe('EventBuffer', () => {
  test('assigns gap-free seqs and replays a range', () => {
    const buffer = new EventBuffer()
    buffer.push('agent://event', { n: 1 })
    buffer.push('agent://event', { n: 2 })
    buffer.push('agent://event', { n: 3 })
    expect(buffer.head()).toBe(3)
    expect(buffer.since(1)!.map(item => item.payload)).toEqual([{ n: 2 }, { n: 3 }])
    expect(buffer.since(0)!.map(item => item.payload)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  test('a gap too old reports null (resync)', () => {
    const buffer = new EventBuffer()
    for (let index = 0; index < 3000; index += 1) buffer.push('agent://event', { index })
    expect(buffer.since(1)).toBeNull()
    expect(buffer.since(buffer.head() - 100)).not.toBeNull()
  })
})

describe('bridge server', () => {
  test('capabilities answer names the mobile platform and filtered commands', async () => {
    const dispatcher = fakeDispatcher()
    const server = createBridgeServer(dispatcher, { token: TOKEN })
    const response = await server.app.request('/capabilities', { headers: auth })
    const body = await response.json() as { platform: string; commands: string[] }
    expect(body.platform).toBe('mobile-host')
    expect(body.commands).toContain('agent_send')
    expect(body.commands).not.toContain('window_minimize')
    expect(body.commands).not.toContain('bogus_command')
  })

  test('capabilities rejects a wrong token', async () => {
    const server = createBridgeServer(fakeDispatcher(), { token: TOKEN })
    const response = await server.app.request('/capabilities', { headers: { authorization: 'Bearer nope' } })
    expect(response.status).toBe(401)
  })

  test('command dispatch validates payloads before reaching the handler', async () => {
    const dispatcher = fakeDispatcher()
    let received: unknown
    dispatcher.handlers.set('agent_new_session', payload => {
      received = payload
      return { sessionId: 's1' }
    })
    const server = createBridgeServer(dispatcher, { token: TOKEN })

    const ok = await server.app.request('/cmd/agent_new_session', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'm1' }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, result: { sessionId: 's1' } })
    expect(received).toEqual({ modelId: 'm1' })

    // Renderer image bytes are forbidden by the contract's validation.
    const bad = await server.app.request('/cmd/agent_send', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi', images: [] }),
    })
    expect(bad.status).toBe(400)
  })

  test('unknown and denied commands answer 404, handler errors answer 500', async () => {
    const dispatcher = fakeDispatcher()
    const server = createBridgeServer(dispatcher, { token: TOKEN })
    // agent_send is allowed but this dispatcher registers no handler yet, so
    // the dispatch throws → 500. Denied/unknown commands → 404.
    expect((await server.app.request('/cmd/window_minimize', { method: 'POST', headers: auth })).status).toBe(404)
    expect((await server.app.request('/cmd/totally_unknown', { method: 'POST', headers: auth })).status).toBe(404)

    dispatcher.handlers.set('agent_send', () => { throw new Error('engine exploded') })
    const boom = await server.app.request('/cmd/agent_send', {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
    })
    expect(boom.status).toBe(500)
  })

  test('SSE stream replays buffered events by seq and streams live ones', async () => {
    const dispatcher = fakeDispatcher()
    const server = createBridgeServer(dispatcher, { token: TOKEN })
    server.emit('agent://event', { turn: 1 })
    server.emit('agent://event', { turn: 2 })

    // SSE is an HTTP surface: exercise it through a real server rather than
    // app.request() so the streaming/response plumbing matches production.
    const http = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: server.app.fetch })
    // The stream never ends on its own, so a hung read must fail loudly: the
    // timeout aborts the request and the reader rejects.
    const signal = AbortSignal.timeout(5000)
    try {
      const response = await fetch(`http://127.0.0.1:${http.port}/events?since=0`, { headers: auth, signal })
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      const readUntil = async (needle: string) => {
        while (!text.includes(needle)) {
          const { done, value } = await reader.read()
          if (done) break
          text += decoder.decode(value)
        }
      }

      await readUntil('turn":2')
      expect(text).toContain('event: hello')
      expect(text).toContain('id: 1')
      expect(text).toContain('"turn":1')
      expect(text).toContain('"turn":2')

      // The same stream keeps tailing: a live event arrives with the next seq.
      server.emit('agent://event', { turn: 3 })
      await readUntil('turn":3')
      expect(text).toContain('id: 3')
      expect(text).toContain('"turn":3')
      await reader.cancel()
    } finally {
      server.close()
      http.stop(true)
    }
  })

  test('events endpoint requires auth', async () => {
    const server = createBridgeServer(fakeDispatcher(), { token: TOKEN })
    const response = await server.app.request('/events')
    expect(response.status).toBe(401)
  })

  test('camera upload writes bytes and returns a sendable path', async () => {
    const saved: { bytes: number; extension: string }[] = []
    const server = createBridgeServer(fakeDispatcher(), {
      token: TOKEN,
      uploads: {
        maxBytes: 8 * 1024 * 1024,
        save: async (bytes, extension) => {
          saved.push({ bytes: bytes.byteLength, extension })
          return { path: `/tmp/openbuddy-upload/shot.${extension}` }
        },
      },
    })

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    const response = await server.app.request('/api/upload', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'image/jpeg' },
      body: bytes,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: '/tmp/openbuddy-upload/shot.jpg', bytes: 4 })
    expect(saved).toEqual([{ bytes: 4, extension: 'jpg' }])
  })

  test('camera upload refuses wrong types, empty bodies and oversized bodies', async () => {
    const server = createBridgeServer(fakeDispatcher(), {
      token: TOKEN,
      uploads: { maxBytes: 3, save: async () => ({ path: '/tmp/x' }) },
    })

    const wrongType = await server.app.request('/api/upload', {
      method: 'POST', headers: { ...auth, 'content-type': 'image/gif' }, body: new Uint8Array([1]),
    })
    expect(wrongType.status).toBe(415)

    const empty = await server.app.request('/api/upload', {
      method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: new Uint8Array(),
    })
    expect(empty.status).toBe(400)

    const tooBig = await server.app.request('/api/upload', {
      method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3, 4]),
    })
    expect(tooBig.status).toBe(413)
  })

  test('upload is closed when the bridge has no sink, and requires auth', async () => {
    const server = createBridgeServer(fakeDispatcher(), { token: TOKEN })
    const disabled = await server.app.request('/api/upload', {
      method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: new Uint8Array([1]),
    })
    expect(disabled.status).toBe(404)

    const unauthorized = await server.app.request('/api/upload', {
      method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([1]),
    })
    expect(unauthorized.status).toBe(401)
  })
})

describe('event stream heartbeat', () => {
  test('an idle stream still says it is alive', async () => {
    // A reverse proxy closes an idle response after about a minute; without a
    // heartbeat the phone's tunnel dies on a quiet conversation.
    const dispatcher = fakeDispatcher()
    const server = createBridgeServer(dispatcher, { token: TOKEN, heartbeatIntervalMs: 100 })
    const http = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: server.app.fetch })
    try {
      const response = await fetch(`http://127.0.0.1:${http.port}/events?since=0`, { headers: auth })
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      const deadline = Date.now() + 3_000
      while (!text.includes('event: ping') && Date.now() < deadline) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }
      expect(text).toContain('event: ping')
      await reader.cancel()
    } finally {
      server.close()
      http.stop(true)
    }
  }, 10_000)
})

describe('host_capabilities over the bridge', () => {
  const dispatcher = () => {
    const fake = fakeDispatcher()
    // The desktop would answer with its own full surface; the bridge must not
    // hand that to a phone.
    fake.handlers.set('host_capabilities', () => ({
      protocolVersion: 1,
      platform: 'desktop',
      commands: ['window_minimize', 'write_text_file'],
      events: ['agent://event'],
      features: ['desktop'],
    }))
    return fake
  }

  test('HTTP answers the mobile surface, not the desktop one', async () => {
    const server = createBridgeServer(dispatcher(), { token: TOKEN })
    const response = await server.app.request('/api/cmd/host_capabilities', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; result: { platform: string; commands: string[] } }
    expect(body.result.platform).toBe('mobile-host')
    expect(body.result.commands).toContain('agent_send')
    expect(body.result.commands).not.toContain('window_minimize')
  })

  test('the socket path gives the same answer', async () => {
    const server = createBridgeServer(dispatcher(), { token: TOKEN })
    const http = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (req, s) => server.fetch(req, s), websocket: server.websocket as never })
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${http.port}/ws?token=${encodeURIComponent(TOKEN)}`)
      const reply = await new Promise<{ ok?: boolean; result?: { platform?: string; commands?: string[] } }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no reply')), 3000)
        socket.onopen = () => socket.send(JSON.stringify({ t: 'cmd', id: 'c1', command: 'host_capabilities', payload: {} }))
        socket.onmessage = event => {
          const frame = JSON.parse(String(event.data)) as { t?: string; id?: string }
          if (frame.t !== 'reply' || frame.id !== 'c1') return
          clearTimeout(timer)
          resolve(frame as never)
        }
        socket.onerror = () => { clearTimeout(timer); reject(new Error('socket error')) }
      })
      expect(reply.ok).toBe(true)
      expect(reply.result?.platform).toBe('mobile-host')
      expect(reply.result?.commands).not.toContain('window_minimize')
      socket.close()
    } finally {
      server.close()
      http.stop(true)
    }
  })
})

describe('live status for the gateway push watcher', () => {
  test('reports waiting sessions and drops them when the turn settles', async () => {
    const dispatcher = fakeDispatcher()
    const server = createBridgeServer(dispatcher, { token: TOKEN })

    expect((await server.app.request('/api/sessions/live-status')).status).toBe(401)

    dispatcher.fire('agent://event', { sessionId: 's1', event: { type: 'agent_start' } })
    let body = await (await server.app.request('/api/sessions/live-status', { headers: auth })).json() as { sessions: unknown[] }
    expect(body.sessions).toEqual([{ id: 's1', activityState: 'running' }])

    dispatcher.fire('agent://permission', { requestId: 'req-1', sessionId: 's1', toolKind: 'agent_bash' })
    body = await (await server.app.request('/api/sessions/live-status', { headers: auth })).json() as { sessions: unknown[] }
    expect(body.sessions).toEqual([
      { id: 's1', activityState: 'waiting', pendingRequestId: 'req-1', pendingToolName: 'agent_bash' },
    ])

    dispatcher.fire('agent://event', { sessionId: 's1', event: { type: 'agent_settled' } })
    body = await (await server.app.request('/api/sessions/live-status', { headers: auth })).json() as { sessions: unknown[] }
    expect(body.sessions).toEqual([])
  })
})
