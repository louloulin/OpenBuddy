import { afterEach, describe, expect, test } from 'bun:test'

import { WsBridgeTransport } from '../../client/src/ws-bridge-transport.js'

import { createBridgeServer, type BridgeServer, type HostDispatcher } from '../src/server.js'

const TOKEN = 'ws-test-token'

function dispatcher(): HostDispatcher & { fire: (event: string, payload: unknown) => void } {
  const listeners = new Set<(event: string, payload: unknown) => void>()
  return {
    dispatch: async (command, payload) => {
      switch (command) {
        case 'agent_list_sessions':
          return [{ id: 's1', title: 'WS session', echo: payload }]
        case 'agent_send':
          return { promptId: 'p1' }
        default:
          throw new Error(`no handler for ${command}`)
      }
    },
    listen: handler => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    servedCommands: () => ['agent_list_sessions', 'agent_send', 'window_minimize'],
    fire: (event, payload) => { for (const listener of listeners) listener(event, payload) },
  }
}

type Running = { bridge: BridgeServer; url: string; port: number; stop: () => void }

function startBridge(host: HostDispatcher): Running {
  const bridge = createBridgeServer(host, { token: TOKEN })
  const http = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req, server) => bridge.fetch(req, server) as Response,
    websocket: bridge.websocket as never,
  })
  return {
    bridge,
    url: `http://127.0.0.1:${http.port}`,
    port: http.port,
    stop: () => { bridge.close(); http.stop(true) },
  }
}

async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('condition not met before the deadline')
}

let running: Running | null = null
afterEach(() => {
  running?.stop()
  running = null
})

describe('websocket bridge', () => {
  test('replays buffered events on connect, then streams live ones', async () => {
    const host = dispatcher()
    running = startBridge(host)
    host.fire('agent://event', { turn: 1 })
    host.fire('agent://event', { turn: 2 })

    const transport = new WsBridgeTransport({ baseUrl: `${running.url}/api`, token: TOKEN })
    const seen: unknown[] = []
    await transport.listen<{ turn: number }>('agent://event', payload => seen.push(payload))
    await waitFor(() => seen.length >= 2)
    expect(seen).toEqual([{ turn: 1 }, { turn: 2 }])

    host.fire('agent://event', { turn: 3 })
    await waitFor(() => seen.length >= 3)
    expect(seen[2]).toEqual({ turn: 3 })
    transport.close()
  })

  test('commands and replies correlate over the same socket', async () => {
    running = startBridge(dispatcher())
    const transport = new WsBridgeTransport({ baseUrl: `${running.url}/api`, token: TOKEN })
    await waitFor(() => transport.state() === 'open')

    const sessions = await transport.invoke<Array<{ id: string; title: string }>>('agent_list_sessions', { cwd: '/x' })
    expect(sessions[0]).toMatchObject({ id: 's1', title: 'WS session' })

    // A denied desktop-only command never reaches the handler.
    await expect(transport.invoke('window_minimize')).rejects.toThrow('not_implemented')
    // An allowed command whose handler throws reports the handler's error.
    await expect(transport.invoke('agent_send', { text: 'x' })).resolves.toMatchObject({ promptId: 'p1' })
    transport.close()
  })

  test('invalid payloads are rejected before dispatch', async () => {
    running = startBridge(dispatcher())
    const transport = new WsBridgeTransport({ baseUrl: `${running.url}/api`, token: TOKEN })
    await waitFor(() => transport.state() === 'open')
    // agent_send forbids renderer image bytes.
    await expect(transport.invoke('agent_send', { text: 'hi', images: [] })).rejects.toThrow('invalid_payload')
    transport.close()
  })

  test('the socket requires the bridge token', async () => {
    running = startBridge(dispatcher())
    const unauthorized = await fetch(`${running.url}/api/ws`)
    expect(unauthorized.status).toBe(401)

    const authorized = await fetch(`${running.url}/api/ws?token=${TOKEN}`)
    // Reaches the upgrade branch; without a websocket server argument Bun
    // answers 426 rather than silently serving the HTTP app.
    expect([400, 426]).toContain(authorized.status)
  })

  test('state reports open then closed', async () => {
    running = startBridge(dispatcher())
    const transport = new WsBridgeTransport({ baseUrl: `${running.url}/api`, token: TOKEN })
    const states: string[] = []
    transport.onState(state => states.push(state))
    await waitFor(() => transport.state() === 'open')
    expect(states).toContain('open')
    transport.close()
    expect(transport.state()).toBe('closed')
  })
})
