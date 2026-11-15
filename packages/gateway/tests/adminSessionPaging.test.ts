import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * The console never asks for a whole transcript.
 *
 * The desktop's default messages endpoint is already paged, but only if the
 * caller forwards its `cursor`. These tests pin that boundary: the gateway
 * passes the cursor through unchanged (encoded once), refuses an oversized one
 * before it reaches the tunnel, caches each page separately, and lets a stale
 * cursor's 409 reach the browser — the drawer needs that code to drop its old
 * pages rather than splice mismatched halves together.
 */

const open: Harness[] = []
const sockets: WebSocket[] = []

function gateway(overrides: Parameters<typeof startGateway>[0] = {}): Harness {
  const harness = startGateway(overrides)
  open.push(harness)
  return harness
}

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close()
    } catch {
      // already closed
    }
  }
  for (const harness of open.splice(0)) harness.close()
})

const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` }

async function connectAgent(
  harness: Harness,
  agentToken: string,
  answer: (path: string) => { status: number; body: unknown },
  paths: string[] = [],
  reads = { count: 0 },
): Promise<WebSocket> {
  const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
    headers: { authorization: `Bearer ${agentToken}` },
  })
  sockets.push(socket)
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') return
    const frame = JSON.parse(event.data) as { t?: string; id?: string; path?: string }
    if (frame.t !== 'http_req' || !frame.id) return
    reads.count += 1
    paths.push(frame.path ?? '')
    const { status, body } = answer(frame.path ?? '')
    // Keep the fake slow enough for in-flight sharing to be observable.
    await Bun.sleep(20)
    socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status, headers: { 'content-type': 'application/json' } }))
    socket.send(JSON.stringify({ t: 'http_chunk', id: frame.id, data: Buffer.from(JSON.stringify(body)).toString('base64') }))
    socket.send(JSON.stringify({ t: 'http_end', id: frame.id }))
  }
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('agent failed to open'))
  })
  return socket
}

async function waitForOnline(harness: Harness, desktopId: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (harness.gateway.hub.isOnline(desktopId)) return
    await Bun.sleep(10)
  }
  throw new Error(`desktop ${desktopId} never came online`)
}

async function enroll(harness: Harness, email: string, installationId: string) {
  const registered = await fetch(`${harness.url}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'a good password' }),
  })
  const { token } = (await registered.json()) as { token: string }

  const enrolled = await fetch(`${harness.url}/desktops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ installationId, name: installationId, platform: 'macos' }),
  })
  const { desktop, agentToken } = (await enrolled.json()) as {
    desktop: { id: string; name: string }
    agentToken: string
  }
  return { desktop, agentToken }
}

async function readMessages(
  harness: Harness,
  desktopId: string,
  query = '',
  sessionId = 's1',
): Promise<{ status: number; cache: string | null; body: Record<string, unknown> }> {
  const response = await fetch(
    `${harness.url}/admin/desktops/${desktopId}/sessions/${sessionId}/messages${query}`,
    { headers: adminHeaders },
  )
  return {
    status: response.status,
    cache: response.headers.get('x-gateway-cache'),
    body: (await response.json()) as Record<string, unknown>,
  }
}

describe('session message paging', () => {
  test('the default read is the newest page, with no query added', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'page-a@example.com', 'page-install-a')
    const paths: string[] = []
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), paths)
    await waitForOnline(harness, desktop.id)

    await readMessages(harness, desktop.id)
    expect(paths).toEqual(['/api/sessions/s1/messages'])
  })

  test('a cursor is forwarded encoded once and cached per page', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'page-b@example.com', 'page-install-b')
    const paths: string[] = []
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), paths)
    await waitForOnline(harness, desktop.id)

    // A base64url cursor can still carry `+`, `/` and `=`; the desktop must
    // receive the original value, not a doubly-encoded one.
    const cursor = 'a+b/c='
    const query = `?cursor=${encodeURIComponent(cursor)}`
    const first = await readMessages(harness, desktop.id, query)
    expect(first.status).toBe(200)
    expect(paths[0]).toBe('/api/sessions/s1/messages?cursor=a%2Bb%2Fc%3D')

    const repeat = await readMessages(harness, desktop.id, query)
    expect(repeat.cache).toBe('hit')
    expect(paths).toHaveLength(1)

    // A different page is a different cache entry and a second tunnel read.
    const other = await readMessages(harness, desktop.id, '?cursor=another')
    expect(other.cache).toBe('miss')
    expect(paths).toHaveLength(2)

    // The audit says which session was read; an opaque cursor would only make
    // the row longer without telling an operator anything.
    const targets = harness.gateway.store
      .queryAudit({ limit: 20, prefixes: ['admin_session_read'] })
      .map(row => row.target)
    expect(new Set(targets)).toEqual(new Set(['/api/sessions/s1/messages']))
  })

  test('an oversized cursor is refused before the tunnel', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'page-c@example.com', 'page-install-c')
    const paths: string[] = []
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), paths)
    await waitForOnline(harness, desktop.id)

    const tooLong = 'a'.repeat(2_049)
    const response = await readMessages(harness, desktop.id, `?cursor=${tooLong}`)
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('invalid_cursor')
    expect(paths).toHaveLength(0)
  })

  test('a stale cursor\'s 409 is passed through and not cached', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'page-d@example.com', 'page-install-d')
    const paths: string[] = []
    await connectAgent(
      harness,
      agentToken,
      () => ({ status: 409, body: { error: 'Session history changed', code: 'HISTORY_CHANGED' } }),
      paths,
    )
    await waitForOnline(harness, desktop.id)

    const first = await readMessages(harness, desktop.id, '?cursor=stale')
    expect(first.status).toBe(409)
    expect(first.body.code).toBe('HISTORY_CHANGED')

    // An error must not be served from cache: the next attempt has to reach
    // the desktop, which may now have a valid newest page.
    const second = await readMessages(harness, desktop.id, '?cursor=stale')
    expect(second.status).toBe(409)
    expect(paths).toHaveLength(2)
  })
})
