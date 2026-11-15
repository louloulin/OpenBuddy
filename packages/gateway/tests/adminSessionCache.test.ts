import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * Transcript reads through the tunnel.
 *
 * A transcript crosses the tunnel to a desktop that then re-reads its own
 * history, so an open drawer is the most expensive read the console makes.
 * Two properties are defended here:
 *
 * - concurrent readers of the same session share one upstream read;
 * - a repeat inside the two-second window does not reach the computer at all.
 *
 * The audit row is separate from the upstream read: it records that an
 * operator looked, which cache hit or miss cannot change.
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

/** A fake desktop that answers every session read from `answer`. */
async function connectAgent(
  harness: Harness,
  agentToken: string,
  answer: () => { status: number; body: unknown },
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
    const { status, body } = answer()
    // A slow answer makes concurrency observable: without it a fast fake can
    // finish before the second request arrives, turning "shared" into "hit".
    await Bun.sleep(50)
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
  sessionId = 's1',
): Promise<{ status: number; cache: string | null; body: unknown }> {
  const response = await fetch(
    `${harness.url}/admin/desktops/${desktopId}/sessions/${sessionId}/messages`,
    { headers: adminHeaders },
  )
  return {
    status: response.status,
    cache: response.headers.get('x-gateway-cache'),
    body: await response.json(),
  }
}

describe('session read cache', () => {
  test('four concurrent readers produce one upstream read', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(
      harness,
      agentToken,
      () => ({ status: 200, body: { messages: [{ role: 'user', content: 'hello' }] } }),
      reads,
    )
    await waitForOnline(harness, desktop.id)

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => readMessages(harness, desktop.id)),
    )
    expect(responses.every(response => response.status === 200)).toBe(true)
    expect(reads.count).toBe(1)
    expect(responses.map(response => response.cache).sort()).toEqual([
      'miss',
      'shared',
      'shared',
      'shared',
    ])

    // Every read is still attributed, even the ones that never reached the
    // computer.
    const audits = harness.gateway.store.queryAudit({ limit: 20, prefixes: ['admin_session_read'] })
    expect(audits).toHaveLength(4)
  })

  test('a repeat inside the window is a cache hit, not a tunnel read', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), reads)
    await waitForOnline(harness, desktop.id)

    const first = await readMessages(harness, desktop.id)
    const second = await readMessages(harness, desktop.id)
    expect(first.cache).toBe('miss')
    expect(second.cache).toBe('hit')
    expect(reads.count).toBe(1)

    // The hit is audited too: "who read this" is independent of "did the
    // desktop answer".
    const hits = harness.gateway.store
      .queryAudit({ limit: 20, prefixes: ['admin_session_read'] })
      .filter(row => JSON.parse(row.meta_json ?? '{}').cache === 'hit')
    expect(hits).toHaveLength(1)
  })

  test('the entry expires after two seconds', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), reads)
    await waitForOnline(harness, desktop.id)

    await readMessages(harness, desktop.id)
    await Bun.sleep(2_100)
    const fresh = await readMessages(harness, desktop.id)
    expect(fresh.cache).toBe('miss')
    expect(reads.count).toBe(2)
  })

  test('failures are never cached', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    let failing = true
    await connectAgent(
      harness,
      agentToken,
      () => (failing ? { status: 500, body: { error: 'boom' } } : { status: 200, body: { messages: [] } }),
      reads,
    )
    await waitForOnline(harness, desktop.id)

    const failed = await readMessages(harness, desktop.id)
    expect(failed.status).toBe(500)
    expect(failed.cache).toBe('miss')

    failing = false
    const retried = await readMessages(harness, desktop.id)
    // If the 500 had been cached, this would still be a 500 without a read.
    expect(retried.status).toBe(200)
    expect(reads.count).toBe(2)
  })

  test('different sessions do not share a cache entry', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(harness, agentToken, () => ({ status: 200, body: { messages: [] } }), reads)
    await waitForOnline(harness, desktop.id)

    await Promise.all([
      readMessages(harness, desktop.id, 's1'),
      readMessages(harness, desktop.id, 's2'),
    ])
    expect(reads.count).toBe(2)
  })
})
