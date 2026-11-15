import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * The live board.
 *
 * Two behaviours are the whole point and both are easy to get wrong:
 *
 * - A desktop that is asleep is *not asked* and *not reported as idle*. The
 *   board says offline, because "nothing is running" is a claim the gateway
 *   cannot make about a computer it cannot reach.
 * - Concurrent readers share one upstream read. Three open tabs are one poll.
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

type LiveStatusAnswer = { sessions: Array<{ id: string; activityState: string; pendingToolName?: string }> }

/**
 * Connects a fake desktop agent that answers live-status with `answer`.
 *
 * `reads` counts how many times it was actually asked, which is how the cache
 * and the shared-in-flight behaviour are observed from the outside.
 */
async function connectAgent(
  harness: Harness,
  agentToken: string,
  answer: () => LiveStatusAnswer | Promise<LiveStatusAnswer>,
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
    if (frame.path?.startsWith('/api/sessions/live-status')) {
      reads.count += 1
      const body = JSON.stringify(await answer())
      socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status: 200, headers: { 'content-type': 'application/json' } }))
      socket.send(JSON.stringify({ t: 'http_chunk', id: frame.id, data: Buffer.from(body).toString('base64') }))
      socket.send(JSON.stringify({ t: 'http_end', id: frame.id }))
      return
    }
    socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status: 404, headers: {} }))
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

/** Creates an account, enrolls a desktop, and returns its agent token. */
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

describe('live board', () => {
  test('reports a waiting session with the tool that is blocking it', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    await connectAgent(harness, agentToken, () => ({
      sessions: [{ id: 'session-1', activityState: 'waiting', pendingToolName: 'Bash' }],
    }))
    await waitForOnline(harness, desktop.id)

    const response = await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })
    expect(response.status).toBe(200)
    const board = (await response.json()) as {
      waiting: Array<{
        desktopId: string
        desktopName: string | null
        sessionId: string
        pendingToolName: string | null
      }>
      desktops: Array<{ desktopId: string; online: boolean; sessions: unknown[]; stale: boolean }>
    }

    expect(board.waiting).toEqual([
      { desktopId: desktop.id, desktopName: 'install-a', sessionId: 'session-1', pendingToolName: 'Bash' },
    ])
    expect(board.desktops).toHaveLength(1)
    expect(board.desktops[0]!.online).toBe(true)
    expect(board.desktops[0]!.stale).toBe(false)
  })

  test('an offline desktop is listed but never asked', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    const socket = await connectAgent(harness, agentToken, () => ({ sessions: [] }), reads)
    await waitForOnline(harness, desktop.id)

    const before = await (await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })).json() as {
      desktops: Array<{ online: boolean }>
    }
    expect(before.desktops[0]!.online).toBe(true)

    // The computer disconnects; the next read must not touch it.
    socket.close()
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && harness.gateway.hub.isOnline(desktop.id)) await Bun.sleep(10)

    const after = await (await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })).json() as {
      desktops: Array<{ desktopId: string; online: boolean; sessions: unknown[]; stale: boolean }>
    }
    expect(after.desktops[0]!.desktopId).toBe(desktop.id)
    expect(after.desktops[0]!.online).toBe(false)
    // An offline desktop's board is empty and explicitly not stale: it was not
    // read, so there is nothing stale about it.
    expect(after.desktops[0]!.sessions).toEqual([])
    expect(after.desktops[0]!.stale).toBe(false)
  })

  test('concurrent readers share one upstream read', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(
      harness,
      agentToken,
      async () => {
        // A slow answer is what makes the overlap real.
        await Bun.sleep(60)
        return { sessions: [{ id: 's1', activityState: 'running' }] }
      },
      reads,
    )
    await waitForOnline(harness, desktop.id)

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => fetch(`${harness.url}/admin/live`, { headers: adminHeaders })),
    )
    expect(responses.every(response => response.status === 200)).toBe(true)
    // Four simultaneous readers, one question to the computer.
    expect(reads.count).toBe(1)
  })

  test('a second read inside the cache window does not reach the desktop', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const reads = { count: 0 }
    await connectAgent(harness, agentToken, () => ({ sessions: [] }), reads)
    await waitForOnline(harness, desktop.id)

    await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })
    const afterFirst = reads.count
    await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })
    expect(reads.count).toBe(afterFirst)
  })

  test('a desktop that stops answering is reported stale, keeping its last known board', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')

    let answerLive = true
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
      headers: { authorization: `Bearer ${agentToken}` },
    })
    sockets.push(socket)
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = JSON.parse(event.data) as { t?: string; id?: string; path?: string }
      if (frame.t !== 'http_req' || !frame.id) return
      if (!answerLive) return // go silent: no head, no end
      const body = JSON.stringify({ sessions: [{ id: 's1', activityState: 'waiting', pendingToolName: 'Edit' }] })
      socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status: 200, headers: { 'content-type': 'application/json' } }))
      socket.send(JSON.stringify({ t: 'http_chunk', id: frame.id, data: Buffer.from(body).toString('base64') }))
      socket.send(JSON.stringify({ t: 'http_end', id: frame.id }))
    }
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('agent failed to open'))
    })
    await waitForOnline(harness, desktop.id)

    // First read succeeds and seeds the cache.
    const first = await (await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })).json() as {
      desktops: Array<{ stale: boolean; sessions: unknown[] }>
    }
    expect(first.desktops[0]!.stale).toBe(false)

    // Now the computer goes quiet while remaining connected.
    answerLive = false
    // Wait past the cache window so the next read actually happens.
    await Bun.sleep(2_600)

    const second = await (await fetch(`${harness.url}/admin/live`, { headers: adminHeaders })).json() as {
      desktops: Array<{ stale: boolean; sessions: Array<{ id: string }>; error?: string }>
    }
    expect(second.desktops[0]!.stale).toBe(true)
    expect(second.desktops[0]!.error).toContain('timed out')
    // The last good answer is still shown rather than an empty board.
    expect(second.desktops[0]!.sessions.map(session => session.id)).toEqual(['s1'])
  }, 15_000)
})

describe('session browser', () => {
  test('reads a desktop’s session list through its tunnel and records the read', async () => {
    const harness = gateway()
    const { desktop, agentToken } = await enroll(harness, 'a@example.com', 'install-a')
    const socket = new WebSocket(`${harness.url.replace('http', 'ws')}/relay/agent`, {
      headers: { authorization: `Bearer ${agentToken}` },
    })
    sockets.push(socket)
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      const frame = JSON.parse(event.data) as { t?: string; id?: string }
      if (frame.t !== 'http_req' || !frame.id) return
      const body = JSON.stringify({ sessions: [{ id: 's1', title: 'Refactor' }] })
      socket.send(JSON.stringify({ t: 'http_head', id: frame.id, status: 200, headers: { 'content-type': 'application/json' } }))
      socket.send(JSON.stringify({ t: 'http_chunk', id: frame.id, data: Buffer.from(body).toString('base64') }))
      socket.send(JSON.stringify({ t: 'http_end', id: frame.id }))
    }
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('agent failed to open'))
    })
    await waitForOnline(harness, desktop.id)

    const response = await fetch(`${harness.url}/admin/desktops/${desktop.id}/sessions`, {
      headers: adminHeaders,
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { sessions: Array<{ id: string; title: string }> }
    expect(payload.sessions).toEqual([{ id: 's1', title: 'Refactor' }])

    const actions = harness.gateway.store.listAudit(20).map(row => row.action)
    expect(actions).toContain('admin_session_read')
  })

  test('an offline desktop answers 503 with a code the console can render', async () => {
    const harness = gateway()
    const { desktop } = await enroll(harness, 'a@example.com', 'install-a')

    const response = await fetch(`${harness.url}/admin/desktops/${desktop.id}/sessions`, {
      headers: adminHeaders,
    })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { code: string; desktopId: string }
    expect(body.code).toBe('desktop_offline')
    expect(body.desktopId).toBe(desktop.id)
  })

  test('an unknown desktop is a 404 rather than an offline one', async () => {
    const harness = gateway()
    const response = await fetch(`${harness.url}/admin/desktops/nope/sessions`, {
      headers: adminHeaders,
    })
    expect(response.status).toBe(404)
  })
})
