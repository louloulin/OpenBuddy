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
    expect(buffer.since(0)).toEqual([])
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

    const response = await server.app.request('/events?since=0', { headers: auth })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const readFor = async (ms: number) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value)
        if (text.includes('turn: 2')) break
      }
    }
    await readFor(500)
    expect(text).toContain('event: hello')
    expect(text).toContain('id: 1')
    expect(text).toContain('"turn":1')
    expect(text).toContain('"turn":2')
    reader.cancel()
  })

  test('events endpoint requires auth', async () => {
    const server = createBridgeServer(fakeDispatcher(), { token: TOKEN })
    const response = await server.app.request('/events')
    expect(response.status).toBe(401)
  })
})
