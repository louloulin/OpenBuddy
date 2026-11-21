import { describe, expect, test } from 'bun:test'

import { AgentHub, BODY_IDLE_TIMEOUT_MS, MAX_TUNNELLED_BODY_BYTES } from '../src/relay/hub.js'

type FakeSocket = {
  sent: string[]
  closed: Array<{ code?: number; reason?: string }>
}

function fakeSocket(): FakeSocket & import('../src/relay/hub.js').AgentSocket {
  const socket: FakeSocket = { sent: [], closed: [] }
  return {
    ...socket,
    send(data: string) {
      socket.sent.push(data)
    },
    close(code?: number, reason?: string) {
      socket.closed.push({ code, reason })
    },
  } as never
}

async function settledHttp(hub: AgentHub, route: string): Promise<{ id: string; outcome: Promise<unknown> }> {
  const id = 'req-1'
  const outcome = hub
    .requestHttp(route, { method: 'GET', path: '/api/sessions', headers: {} })
    .then((response) => ({ ok: true as const, response }))
    .catch((error: unknown) => ({ ok: false as const, error }))
  await Bun.sleep(0)
  return { id, outcome }
}

describe('agent hub reconnect semantics', () => {
  test('replacing a route fails its in-flight http request instead of stalling', async () => {
    const hub = new AgentHub()
    const first = fakeSocket()
    hub.attach('d1', first)

    const { outcome } = await settledHttp(hub, 'd1')
    expect(first.sent.some((frame) => frame.includes('"t":"http_req"'))).toBe(true)

    hub.attach('d1', fakeSocket())
    const result = (await outcome) as { ok: boolean; error?: Error }
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('agent reconnected')
  })

  test('replacing a route closes its bridged websockets so clients can retry', () => {
    const hub = new AgentHub()
    hub.attach('d1', fakeSocket())

    const closes: Array<{ code?: number; reason?: string }> = []
    hub.openWs('d1', '/ws/session-1', {}, {
      onMessage: () => {},
      onClose: (code, reason) => closes.push({ code, reason }),
    })

    hub.attach('d1', fakeSocket())
    expect(closes).toEqual([{ code: 1011, reason: 'agent reconnected' }])
  })

  test('a replaced route cannot receive frames sent to the old socket', async () => {
    const hub = new AgentHub()
    const first = fakeSocket()
    hub.attach('d1', first)
    const { outcome } = await settledHttp(hub, 'd1')
    hub.attach('d1', fakeSocket())

    // The old agent answering late must not reach the already-failed request.
    hub.receive('d1', JSON.stringify({ t: 'http_head', id: 'req-1', status: 200, headers: {} }))
    const result = (await outcome) as { ok: boolean }
    expect(result.ok).toBe(false)
  })

  test('only the reconnecting route is affected', async () => {
    const hub = new AgentHub()
    hub.attach('d1', fakeSocket())
    hub.attach('d2', fakeSocket())

    const d1 = await settledHttp(hub, 'd1')
    const d2 = await settledHttp(hub, 'd2')

    hub.attach('d1', fakeSocket())
    const failed = (await d1.outcome) as { ok: boolean; error?: Error }
    expect(failed.ok).toBe(false)
    expect(failed.error?.message).toBe('agent reconnected')

    // The other desktop's in-flight request keeps waiting for its own agent.
    let settled = false
    void d2.outcome.then(() => { settled = true })
    await Bun.sleep(10)
    expect(settled).toBe(false)
  })

  test('detach still fails pending work as a disconnect', async () => {
    const hub = new AgentHub()
    const socket = fakeSocket()
    hub.attach('d1', socket)

    const { outcome } = await settledHttp(hub, 'd1')
    hub.detach('d1', socket)
    const result = (await outcome) as { ok: boolean; error?: Error }
    expect(result.ok).toBe(false)
    expect(result.error?.message).toBe('agent disconnected')
  })
})

describe('agent hub body stall and buffering bounds', () => {
  function requestId(socket: ReturnType<typeof fakeSocket>): string {
    const frame = socket.sent.find((candidate) => candidate.includes('"t":"http_req"'))
    return JSON.parse(frame!).id as string
  }

  test('a silent agent fails the stream after the body idle window, not forever', async () => {
    const hub = new AgentHub({ bodyIdleTimeoutMs: 25 })
    const socket = fakeSocket()
    hub.attach('d1', socket)

    const settled = hub
      .requestHttp('d1', { method: 'GET', path: '/api/sessions', headers: {} })
      .then(async (response) => {
        // The head resolved; the body never arrives. Reading must reject.
        const reader = response.body!.getReader()
        return reader.read().then(
          () => ({ phase: 'chunk' as const }),
          (error: unknown) => ({ phase: 'error' as const, error }),
        )
      })
      .catch((error: unknown) => ({ phase: 'error' as const, error }))

    hub.receive('d1', JSON.stringify({ t: 'http_head', id: requestId(socket), status: 200, headers: {} }))

    const result = (await settled) as { phase: string; error?: Error }
    expect(result.phase).toBe('error')
    expect(result.error?.message).toBe('agent response stalled mid-body')
    // The dead request told its agent to stop working on it.
    expect(socket.sent.some((frame) => frame.includes('"t":"http_abort"'))).toBe(true)
  })

  test('an over-budget compressed body fails instead of buffering unbounded', async () => {
    const hub = new AgentHub({ maxBodyBytes: 16 })
    const socket = fakeSocket()
    hub.attach('d1', socket)

    const settled = hub
      .requestHttp('d1', { method: 'GET', path: '/download', headers: {} })
      .then(async (response) => {
        const reader = response.body!.getReader()
        return reader.read().then(
          () => ({ phase: 'chunk' as const }),
          (error: unknown) => ({ phase: 'error' as const, error }),
        )
      })
      .catch((error: unknown) => ({ phase: 'error' as const, error }))

    const id = requestId(socket)
    hub.receive('d1', JSON.stringify({ t: 'http_head', id, status: 200, headers: {}, encoding: 'gzip' }))
    hub.receive('d1', JSON.stringify({ t: 'http_chunk', id, data: Buffer.from(new Uint8Array(12)).toString('base64') }))
    // Second chunk crosses the budget: the buffered accumulator stops here.
    hub.receive('d1', JSON.stringify({ t: 'http_chunk', id, data: Buffer.from(new Uint8Array(12)).toString('base64') }))

    const result = (await settled) as { phase: string; error?: Error }
    expect(result.phase).toBe('error')
    expect(result.error?.message).toBe('agent response stalled mid-body')
  })

  test('the production bounds are finite and generous', () => {
    expect(BODY_IDLE_TIMEOUT_MS).toBe(120_000)
    expect(MAX_TUNNELLED_BODY_BYTES).toBe(64 * 1024 * 1024)
  })
})

describe('agent hub tunnel backpressure', () => {
  test('a frame the socket refuses fails the request at once instead of stalling', async () => {
    // Bun returns 0 when the frame is dropped. Believing it was delivered is
    // what used to turn a burst into a 30-second 502 per request.
    const socket = fakeSocket()
    let sending = true
    const hub = new AgentHub({ maxBodyBytes: 1024 })
    hub.attach('desktop-1', {
      send(data: string) {
        if (!sending) return 0 as never
        socket.sent.push(data)
      },
      close() {},
    } as never)

    sending = false
    const outcome = await hub
      .requestHttp('desktop-1', { method: 'POST', path: '/api/cmd/agent_send', headers: {}, body: new Uint8Array([1]) })
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    expect(outcome.ok).toBe(false)
    expect((outcome as { error: Error }).error.message).toContain('backpressure')
  })

  test('a saturated tunnel is refused before the frame is even written', async () => {
    const hub = new AgentHub({ maxBodyBytes: 1024 })
    const sent: string[] = []
    hub.attach('desktop-2', {
      send(data: string) { sent.push(data) },
      close() {},
      bufferedAmount: () => 8 * 1024 * 1024,
    } as never)

    const outcome = await hub
      .requestHttp('desktop-2', { method: 'POST', path: '/api/cmd/agent_send', headers: {}, body: new Uint8Array([1]) })
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    expect(outcome.ok).toBe(false)
    expect((outcome as { error: Error }).error.message).toContain('backpressure')
    // The attach handshake writes one `hello` frame; the refused request must
    // not have added a second.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('hello')
  })

  test('a socket without a verdict is treated as healthy', async () => {
    const hub = new AgentHub({ maxBodyBytes: 1024 })
    hub.attach('desktop-3', {
      send() { /* returns undefined: runtime has no verdict */ },
      close() {},
    } as never)
    // No throw: the request is pending, which is the normal path.
    const pending = hub.requestHttp('desktop-3', { method: 'GET', path: '/api/capabilities', headers: {} })
    await Bun.sleep(5)
    expect(pending).toBeInstanceOf(Promise)
  })
})
