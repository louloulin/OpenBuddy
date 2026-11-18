import { afterEach, describe, expect, test } from 'bun:test'

import { createFcmProvider, fcmErrorCode, isPermanentFcmFailure, type FcmServiceAccount } from '../src/push/fcm.js'
import { createWebhookProvider, isAllowedWebhookUrl } from '../src/push/webhook.js'
import { createExpoProvider } from '../src/push/expo.js'
import { createPushDispatcher } from '../src/push/dispatcher.js'
import { parseServiceAccount } from '../src/push/providers.js'
import { Store } from '../src/store.js'
import {
  createLiveStatusReader,
  createSessionWatcher,
  diffLiveStatus,
  parseLiveStatus,
  type LiveSession,
} from '../src/push/watcher.js'
import {
  ADMIN_TOKEN,
  AGENT_TOKEN,
  authHeader,
  enrollDesktop,
  pairDevice,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

// ── Live-status diffing ──────────────────────────────────────

describe('diffLiveStatus', () => {
  const run = (before: LiveSession[], after: LiveSession[]) =>
    diffLiveStatus(new Map(before.map(s => [s.id, s.activityState])), after)

  test('a session that starts waiting is an approval, whether or not running was seen', () => {
    expect(run([{ id: 'a', activityState: 'running' }], [{ id: 'a', activityState: 'waiting' }]))
      .toEqual([{ kind: 'approval', sessionId: 'a' }])
    expect(run([], [{ id: 'a', activityState: 'waiting' }]))
      .toEqual([{ kind: 'approval', sessionId: 'a' }])
  })

  test('a running session that disappears finished', () => {
    expect(run([{ id: 'a', activityState: 'running' }], []))
      .toEqual([{ kind: 'done', sessionId: 'a' }])
  })

  test('an answered session that disappears is not news', () => {
    expect(run([{ id: 'a', activityState: 'waiting' }], [])).toEqual([])
  })

  test('steady states and a new running session emit nothing', () => {
    expect(run(
      [{ id: 'a', activityState: 'running' }, { id: 'b', activityState: 'waiting' }],
      [{ id: 'a', activityState: 'running' }, { id: 'b', activityState: 'waiting' }, { id: 'c', activityState: 'running' }],
    )).toEqual([])
  })

  test('a session that goes back to running and waits again re-notifies', () => {
    expect(run([{ id: 'a', activityState: 'running' }], [{ id: 'a', activityState: 'waiting' }]))
      .toEqual([{ kind: 'approval', sessionId: 'a' }])
  })

  test('an approval carries the tool the session is waiting on', () => {
    expect(run(
      [{ id: 'a', activityState: 'running' }],
      [{ id: 'a', activityState: 'waiting', pendingToolName: 'Bash' }],
    )).toEqual([{ kind: 'approval', sessionId: 'a', toolName: 'Bash' }])
  })

  test('an approval carries the request id so push buttons can answer it', () => {
    expect(run(
      [{ id: 'a', activityState: 'running' }],
      [{ id: 'a', activityState: 'waiting', pendingToolName: 'Bash', pendingRequestId: 'perm-1' }],
    )).toEqual([{ kind: 'approval', sessionId: 'a', toolName: 'Bash', requestId: 'perm-1' }])
  })

  test('parseLiveStatus keeps a well-formed tool name and drops the rest', () => {
    expect(parseLiveStatus({
      sessions: [
        { id: 'a', activityState: 'waiting', pendingToolName: 'Bash', pendingRequestId: 'perm-1' },
        { id: 'b', activityState: 'waiting', pendingToolName: '', pendingRequestId: 'perm-2' },
        { id: 'c', activityState: 'waiting', pendingToolName: 42, pendingRequestId: 42 },
        { id: 'd', activityState: 'running', pendingToolName: 'Bash' },
      ],
    })).toEqual([
      { id: 'a', activityState: 'waiting', pendingToolName: 'Bash', pendingRequestId: 'perm-1' },
      { id: 'b', activityState: 'waiting', pendingRequestId: 'perm-2' },
      { id: 'c', activityState: 'waiting' },
      { id: 'd', activityState: 'running' },
    ])
  })

  test('parseLiveStatus drops malformed rows and unknown states', () => {
    expect(parseLiveStatus({
      sessions: [
        { id: 'a', activityState: 'running' },
        { id: '', activityState: 'waiting' },
        { id: 'b', activityState: 'idle' },
        { activityState: 'waiting' },
        { id: 'c', activityState: 'waiting' },
        null,
      ],
    })).toEqual([
      { id: 'a', activityState: 'running' },
      { id: 'c', activityState: 'waiting' },
    ])
    expect(parseLiveStatus(null)).toEqual([])
    expect(parseLiveStatus({ sessions: 'nope' })).toEqual([])
  })

  test('parseLiveStatus keeps a non-empty scheduled task id', () => {
    expect(parseLiveStatus({
      sessions: [
        { id: 'a', activityState: 'running', scheduledTaskId: 'task-1' },
        { id: 'b', activityState: 'waiting', scheduledTaskId: '' },
        { id: 'c', activityState: 'running', scheduledTaskId: 42 },
      ],
    })).toEqual([
      { id: 'a', activityState: 'running', scheduledTaskId: 'task-1' },
      { id: 'b', activityState: 'waiting' },
      { id: 'c', activityState: 'running' },
    ])
  })

  test('AskUserQuestion is a question and any other waiting tool is an approval', () => {
    const waiting = (pendingToolName?: string) => diffLiveStatus(
      new Map([['a', 'running' as const]]),
      [{ id: 'a', activityState: 'waiting', ...(pendingToolName ? { pendingToolName } : {}) }],
    )

    expect(waiting('AskUserQuestion')).toEqual([
      { kind: 'question', sessionId: 'a', toolName: 'AskUserQuestion' },
    ])
    // MCP tools arrive namespaced; the asking suffix still decides the kind.
    expect(waiting('mcp__lumos__AskUserQuestion')).toEqual([
      { kind: 'question', sessionId: 'a', toolName: 'mcp__lumos__AskUserQuestion' },
    ])
    expect(waiting('Bash')).toEqual([
      { kind: 'approval', sessionId: 'a', toolName: 'Bash' },
    ])
    expect(waiting()).toEqual([{ kind: 'approval', sessionId: 'a' }])
  })

  test('a scheduled session that disappears is scheduled, not done', () => {
    expect(diffLiveStatus(
      new Map([['s', 'running'], ['n', 'running']]),
      [],
      new Set(['s']),
    )).toEqual([
      { kind: 'scheduled', sessionId: 's' },
      { kind: 'done', sessionId: 'n' },
    ])
  })
})

describe('session watcher', () => {
  test('the first poll seeds state instead of notifying about everything live', async () => {
    const seen: unknown[] = []
    const watcher = createSessionWatcher({
      read: async () => [{ id: 'a', activityState: 'waiting' }],
      onEvents: events => { seen.push(events) },
    })
    expect(await watcher.poll()).toEqual([])
    expect(seen).toEqual([])
  })

  test('a transition after seeding is reported once', async () => {
    let live: LiveSession[] = [{ id: 'a', activityState: 'running' }]
    const batches: string[][] = []
    const watcher = createSessionWatcher({
      read: async () => live,
      onEvents: events => { batches.push(events.map(event => `${event.kind}:${event.sessionId}`)) },
    })
    await watcher.poll()
    live = [{ id: 'a', activityState: 'waiting' }]
    expect(await watcher.poll()).toEqual([{ kind: 'approval', sessionId: 'a' }])
    expect(await watcher.poll()).toEqual([])
    // The user answered, so the session works on and then stops.
    live = [{ id: 'a', activityState: 'running' }]
    expect(await watcher.poll()).toEqual([])
    live = []
    expect(await watcher.poll()).toEqual([{ kind: 'done', sessionId: 'a' }])
    expect(batches).toEqual([['approval:a'], ['done:a']])
  })

  test('a skipped poll neither reads nor forgets what it knew', async () => {
    let reads = 0
    let live: LiveSession[] = [{ id: 'a', activityState: 'running' }]
    let listening = false
    const watcher = createSessionWatcher({
      read: async () => { reads += 1; return live },
      onEvents: () => {},
      shouldPoll: () => listening,
    })
    expect(await watcher.poll()).toEqual([])
    expect(reads).toBe(0)
    // Nobody was listening while the session moved on; the first poll that
    // actually reads seeds, so it must not fire a stale approval.
    listening = true
    live = [{ id: 'a', activityState: 'waiting' }]
    expect(await watcher.poll()).toEqual([])
    expect(reads).toBe(1)
  })

  test('a failed read keeps state so the recovery poll still reports the change', async () => {
    let live: LiveSession[] = [{ id: 'a', activityState: 'running' }]
    let fail = false
    const errors: unknown[] = []
    const watcher = createSessionWatcher({
      read: async () => {
        if (fail) throw new Error('upstream down')
        return live
      },
      onEvents: () => {},
      onError: error => { errors.push(error) },
    })
    await watcher.poll()
    fail = true
    await expect(watcher.poll()).rejects.toThrow('upstream down')
    fail = false
    live = []
    expect(await watcher.poll()).toEqual([{ kind: 'done', sessionId: 'a' }])
    expect(errors).toEqual([])
  })

  test('a scheduled session that stops is reported as scheduled', async () => {
    let live: LiveSession[] = [{ id: 'a', activityState: 'running', scheduledTaskId: 'task-1' }]
    const watcher = createSessionWatcher({
      read: async () => live,
      onEvents: () => {},
    })
    // The seed learns the task id even though it emits nothing.
    expect(await watcher.poll()).toEqual([])
    live = []
    expect(await watcher.poll()).toEqual([{ kind: 'scheduled', sessionId: 'a' }])
  })
})

describe('live-status reader', () => {
  test('reads through the agent tunnel when one is connected', async () => {
    const requests: Array<{ method: string; path: string; headers: Record<string, string> }> = []
    const reader = createLiveStatusReader({
      hub: {
        connected: true,
        legacyConnected: true,
        requestHttp: async (_route: string, request: { method: string; path: string; headers: Record<string, string> }) => {
          requests.push(request)
          return Response.json({ sessions: [{ id: 's1', activityState: 'waiting' }] })
        },
      } as never,
      upstreamUrl: 'http://127.0.0.1:1',
      upstreamToken: 'up_token',
    })
    expect(await reader()).toEqual([{ id: 's1', activityState: 'waiting' }])
    expect(requests).toEqual([{
      method: 'GET',
      path: '/api/sessions/live-status',
      headers: { accept: 'application/json', 'accept-encoding': 'identity', authorization: 'Bearer up_token' },
    }])
  })

  test('falls back to the upstream URL and surfaces a bad status', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ sessions: [{ id: 'direct', activityState: 'running' }] }),
    })
    try {
      const reader = createLiveStatusReader({
        hub: { connected: false } as never,
        upstreamUrl: `http://127.0.0.1:${server.port}`,
      })
      expect(await reader()).toEqual([{ id: 'direct', activityState: 'running' }])
    } finally {
      server.stop(true)
    }

    const failing = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('nope', { status: 503 }) })
    try {
      const reader = createLiveStatusReader({
        hub: { connected: false } as never,
        upstreamUrl: `http://127.0.0.1:${failing.port}`,
      })
      await expect(reader()).rejects.toThrow('live-status returned 503')
    } finally {
      failing.stop(true)
    }
  })
})

// ── Webhook provider ─────────────────────────────────────────

describe('webhook destination rules', () => {
  test('https is allowed by default and http is not', () => {
    expect(isAllowedWebhookUrl('https://ntfy.example.com/topic')).toBe(true)
    expect(isAllowedWebhookUrl('http://ntfy.example.com/topic')).toBe(false)
    expect(isAllowedWebhookUrl('http://192.168.1.5:8080/hook', { allowCleartext: true })).toBe(true)
  })

  test('other schemes and unparseable values are refused', () => {
    expect(isAllowedWebhookUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedWebhookUrl('ftp://example.com')).toBe(false)
    expect(isAllowedWebhookUrl('not a url')).toBe(false)
    expect(isAllowedWebhookUrl('')).toBe(false)
  })

  test('an allowlist matches the host and its subdomains only', () => {
    const options = { allowedHosts: ['example.com'] }
    expect(isAllowedWebhookUrl('https://example.com/h', options)).toBe(true)
    expect(isAllowedWebhookUrl('https://push.example.com/h', options)).toBe(true)
    expect(isAllowedWebhookUrl('https://notexample.com/h', options)).toBe(false)
    expect(isAllowedWebhookUrl('https://example.com.evil.net/h', options)).toBe(false)
  })

  test('private IP literals are refused unless the operator opted into the local network', () => {
    // The cloud metadata service, a LAN printer, and the gateway itself are
    // all things a device-supplied webhook must not be aimed at by default.
    expect(isAllowedWebhookUrl('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isAllowedWebhookUrl('https://10.0.0.9/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://192.168.1.1/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://172.20.0.4/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://100.100.1.1/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://127.0.0.1:8787/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://[::1]/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://[fe80::1]/hook')).toBe(false)
    expect(isAllowedWebhookUrl('https://[::ffff:10.0.0.9]/hook')).toBe(false)

    // The cleartext opt-in is the local-relay story, so it carries these too.
    const local = { allowCleartext: true }
    expect(isAllowedWebhookUrl('http://127.0.0.1:19999/hook', local)).toBe(true)
    expect(isAllowedWebhookUrl('https://192.168.1.1/hook', local)).toBe(true)

    // Public names and addresses stay unaffected.
    expect(isAllowedWebhookUrl('https://ntfy.example.com/t')).toBe(true)
    expect(isAllowedWebhookUrl('https://8.8.8.8/hook')).toBe(true)
  })

  test('a redirect is not followed', async () => {
    const first = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response(null, { status: 302, headers: { location: 'http://elsewhere.invalid/hook' } }),
    })
    const provider = createWebhookProvider({ allowCleartext: true })
    const outcome = await provider.send({
      token: `http://127.0.0.1:${first.port}/hook`,
      kind: 'done', title: 't', body: 'b', sessionId: 's1',
    })
    first.stop(true)
    // A manual redirect surfaces as an opaque response, not a delivery: the
    // notification must not travel anywhere the policy never checked.
    expect(outcome.ok).toBe(false)
  })
})

describe('webhook delivery', () => {
  const servers: Array<ReturnType<typeof Bun.serve>> = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
  })

  function destination(handler: (req: Request) => Response | Promise<Response>) {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
    servers.push(server)
    return `http://127.0.0.1:${server.port}/hook`
  }

  test('posts the notification as JSON with the shared secret', async () => {
    const received: { body?: unknown; auth?: string | null } = {}
    const token = destination(async (req) => {
      received.body = await req.json()
      received.auth = req.headers.get('authorization')
      return Response.json({ ok: true })
    })
    const provider = createWebhookProvider({ token: 'shh', allowCleartext: true })
    expect(await provider.send({
      token,
      kind: 'approval',
      title: 'Approval needed',
      body: 'A session is waiting for your approval.',
      sessionId: 's1',
      collapseKey: 's1',
    })).toEqual({ ok: true })
    expect(received).toEqual({
      body: {
        kind: 'approval',
        title: 'Approval needed',
        body: 'A session is waiting for your approval.',
        sessionId: 's1',
        collapseKey: 's1',
      },
      auth: 'Bearer shh',
    })
  })

  test('a gone endpoint is permanent and a server error is not', async () => {
    const gone = createWebhookProvider({ allowCleartext: true })
    expect(await gone.send({
      token: destination(() => new Response('gone', { status: 410 })),
      kind: 'done', title: 't', body: 'b', sessionId: 's1',
    })).toEqual({ ok: false, permanent: true, error: 'webhook 410' })

    expect(await gone.send({
      token: destination(() => new Response('boom', { status: 500 })),
      kind: 'done', title: 't', body: 'b', sessionId: 's1',
    })).toEqual({ ok: false, permanent: false, error: 'webhook 500' })
  })

  test('a disallowed destination is permanent so it stops being retried', async () => {
    const provider = createWebhookProvider({ allowedHosts: ['example.com'] })
    const outcome = await provider.send({
      token: 'https://elsewhere.test/hook',
      kind: 'done', title: 't', body: 'b', sessionId: 's1',
    })
    expect(outcome).toEqual({ ok: false, permanent: true, error: 'webhook destination is not allowed' })
  })

  test('a connection failure is retryable', async () => {
    const provider = createWebhookProvider({ allowCleartext: true, timeoutMs: 500 })
    const outcome = await provider.send({
      // Port 1 on loopback refuses immediately.
      token: 'http://127.0.0.1:1/hook',
      kind: 'done', title: 't', body: 'b', sessionId: 's1',
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.permanent).toBe(false)
  })
})

// ── FCM provider ─────────────────────────────────────────────

function toPem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

async function generateServiceAccount(): Promise<{ account: FcmServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  const publicKey = await crypto.subtle.importKey(
    'spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  )
  return {
    account: {
      projectId: 'lumos-test',
      clientEmail: 'pusher@lumos-test.iam.gserviceaccount.com',
      privateKeyPem: toPem('PRIVATE KEY', pkcs8),
    },
    publicKey,
  }
}

describe('fcm', () => {
  const servers: Array<ReturnType<typeof Bun.serve>> = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
  })

  test('error codes are read from both FCM shapes and classified', () => {
    expect(fcmErrorCode(404, { error: { status: 'NOT_FOUND' } })).toBe('NOT_FOUND')
    expect(fcmErrorCode(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } })).toBe('INVALID_ARGUMENT')
    expect(fcmErrorCode(500, { error: { message: 'backend down' } })).toBe('500:backend down')
    expect(fcmErrorCode(500, null)).toBeNull()
    expect(fcmErrorCode(500, { error: 'text' })).toBeNull()

    expect(isPermanentFcmFailure(404, null)).toBe(true)
    expect(isPermanentFcmFailure(400, 'UNREGISTERED')).toBe(true)
    expect(isPermanentFcmFailure(400, 'INVALID_ARGUMENT')).toBe(true)
    expect(isPermanentFcmFailure(503, 'UNAVAILABLE')).toBe(false)
    // A rejected token is refetched, so it must stay retryable.
    expect(isPermanentFcmFailure(401, null)).toBe(false)
  })

  test('signs a real assertion, exchanges it, and sends the notification', async () => {
    const { account, publicKey } = await generateServiceAccount()
    const seen: { tokenForm?: Record<string, string>; send?: { auth: string | null; body: any } } = {}

    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/token') {
          seen.tokenForm = Object.fromEntries(new URLSearchParams(await req.text()))
          return Response.json({ access_token: 'ya29.test', expires_in: 3600 })
        }
        seen.send = { auth: req.headers.get('authorization'), body: await req.json() }
        return Response.json({ name: 'projects/lumos-test/messages/1' })
      },
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`

    const provider = createFcmProvider({
      serviceAccount: account,
      tokenUrl: `${base}/token`,
      sendUrl: `${base}/v1/messages:send`,
      channelId: 'lumos',
      now: () => 1_700_000_000_000,
    })

    expect(await provider.send({
      token: 'device-token',
      kind: 'approval',
      title: 'Approval needed',
      body: 'A session is waiting for your approval.',
      sessionId: 's1',
      collapseKey: 's1',
    })).toEqual({ ok: true })

    // The assertion is a real RS256 JWT over the service account's key.
    const assertion = seen.tokenForm?.assertion ?? ''
    const [header, claims, signature] = assertion.split('.')
    expect(seen.tokenForm?.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(signature!, 'base64url'),
      Buffer.from(`${header}.${claims}`, 'utf8'),
    )
    expect(verified).toBe(true)
    const parsedClaims = JSON.parse(Buffer.from(claims!, 'base64url').toString())
    expect(parsedClaims).toEqual({
      iss: account.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: `${base}/token`,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    })

    expect(seen.send?.auth).toBe('Bearer ya29.test')
    expect(seen.send?.body).toEqual({
      message: {
        token: 'device-token',
        notification: { title: 'Approval needed', body: 'A session is waiting for your approval.' },
        data: { kind: 'approval', sessionId: 's1' },
        android: {
          priority: 'high',
          collapse_key: 's1',
          notification: { channel_id: 'lumos', tag: 's1' },
        },
      },
    })
  })

  test('an actionable approval ships data-only so the phone can render buttons', async () => {
    const { account } = await generateServiceAccount()
    const seen: { send?: { auth: string | null; body: any } } = {}

    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        if (new URL(req.url).pathname === '/token') {
          return Response.json({ access_token: 'ya29.test', expires_in: 3600 })
        }
        seen.send = { auth: req.headers.get('authorization'), body: await req.json() }
        return Response.json({ name: 'projects/lumos-test/messages/1' })
      },
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`

    const provider = createFcmProvider({
      serviceAccount: account,
      tokenUrl: `${base}/token`,
      sendUrl: `${base}/v1/messages:send`,
      channelId: 'lumos',
      now: () => 1_700_000_000_000,
    })

    expect(await provider.send({
      token: 'device-token',
      kind: 'approval',
      title: 'Approval needed',
      body: 'A session is waiting for your approval.',
      sessionId: 's1',
      requestId: 'perm-1',
      collapseKey: 's1',
    })).toEqual({ ok: true })

    // No `notification` block anywhere: a background system-tray render would
    // pre-empt the app's own Allow/Deny notification. The copy travels in data
    // (FCM data is stringly) for the phone's messaging service to render.
    expect(seen.send?.body).toEqual({
      message: {
        token: 'device-token',
        data: {
          kind: 'approval',
          sessionId: 's1',
          requestId: 'perm-1',
          title: 'Approval needed',
          body: 'A session is waiting for your approval.',
        },
        android: { priority: 'high', collapse_key: 's1' },
      },
    })
  })

  test('a completion notification rides the quiet info channel', async () => {
    const { account } = await generateServiceAccount()
    const seen: { send?: { auth: string | null; body: any } } = {}

    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/token') return Response.json({ access_token: 'ya29.test', expires_in: 3600 })
        seen.send = { auth: req.headers.get('authorization'), body: await req.json() }
        return Response.json({ name: 'projects/lumos-test/messages/1' })
      },
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`

    const provider = createFcmProvider({
      serviceAccount: account,
      tokenUrl: `${base}/token`,
      sendUrl: `${base}/v1/messages:send`,
      channelId: 'lumos',
    })

    expect(await provider.send({
      token: 'device-token',
      kind: 'done',
      title: 'Session finished',
      body: 'A session stopped working.',
      sessionId: 's1',
      collapseKey: 's1',
    })).toEqual({ ok: true })

    const body = seen.send?.body as { message: { android: { notification: { channel_id: string } } } }
    expect(body.message.android.notification.channel_id).toBe('lumos-info')
  })

  test('the access token is reused until it is nearly expired', async () => {
    const { account } = await generateServiceAccount()
    let tokenCalls = 0
    let clock = 1_700_000_000_000
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        if (new URL(req.url).pathname === '/token') {
          tokenCalls += 1
          return Response.json({ access_token: `tok${tokenCalls}`, expires_in: 3600 })
        }
        return Response.json({ ok: true })
      },
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`
    const provider = createFcmProvider({
      serviceAccount: account,
      tokenUrl: `${base}/token`,
      sendUrl: `${base}/send`,
      now: () => clock,
    })

    const message = { token: 't', kind: 'done' as const, title: 't', body: 'b', sessionId: 's1' }
    await provider.send(message)
    clock += 60_000
    await provider.send(message)
    expect(tokenCalls).toBe(1)
    // Past the refresh margin the assertion is minted again.
    clock += 3_600_000
    await provider.send(message)
    expect(tokenCalls).toBe(2)
  })

  test('an unregistered token is permanent and an outage is not', async () => {
    const { account } = await generateServiceAccount()
    let status = 404
    let payload: unknown = { error: { status: 'NOT_FOUND' } }
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        if (new URL(req.url).pathname === '/token') {
          return Response.json({ access_token: 'tok', expires_in: 3600 })
        }
        return Response.json(payload as object, { status })
      },
    })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`
    const provider = createFcmProvider({
      serviceAccount: account,
      tokenUrl: `${base}/token`,
      sendUrl: `${base}/send`,
    })
    const message = { token: 't', kind: 'done' as const, title: 't', body: 'b', sessionId: 's1' }

    expect(await provider.send(message)).toEqual({ ok: false, permanent: true, error: 'fcm 404 NOT_FOUND' })

    status = 503
    payload = { error: { status: 'UNAVAILABLE' } }
    expect(await provider.send(message)).toEqual({ ok: false, permanent: false, error: 'fcm 503 UNAVAILABLE' })
  })

  test('a broken credential fails the send without blaming the device', async () => {
    const provider = createFcmProvider({
      serviceAccount: { projectId: 'p', clientEmail: 'a@b.c', privateKeyPem: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----' },
      tokenUrl: 'http://127.0.0.1:1/token',
      sendUrl: 'http://127.0.0.1:1/send',
    })
    const outcome = await provider.send({ token: 't', kind: 'done', title: 't', body: 'b', sessionId: 's1' })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.permanent).toBe(false)
  })

  test('a service account JSON is validated before it is trusted', () => {
    expect(() => parseServiceAccount({})).toThrow('project_id')
    expect(() => parseServiceAccount({ project_id: 'p' })).toThrow('client_email')
    expect(() => parseServiceAccount({ project_id: 'p', client_email: 'a@b.c', private_key: 'nope' })).toThrow('private_key')
    const parsed = parseServiceAccount({
      project_id: 'p',
      client_email: 'a@b.c',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    })
    expect(parsed.privateKeyPem).toContain('\nabc\n')
    expect(parsed.privateKeyPem).not.toContain('\\n')
  })
})

// ── Store ────────────────────────────────────────────────────

describe('push registration storage', () => {
  test('re-registering the same token updates instead of duplicating', () => {
    const store = new Store(':memory:')
    try {
      store.insertDevice({
        id: 'd1', name: 'Phone', platform: 'android', token_hash: 'h',
        scopes_json: '["approve"]', created_at: 1,
      })
      const first = store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })!
      const second = store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })!
      expect(second.id).toBe(first.id)
      expect(store.listPushRegistrations()).toHaveLength(1)
      expect(store.countPushRegistrations()).toEqual({ active: 1, dead: 0 })
    } finally {
      store.close()
    }
  })

  test('a revoked device stops receiving and its rows are pruned on unpair', () => {
    const store = new Store(':memory:')
    try {
      store.insertDevice({
        id: 'd1', name: 'Phone', platform: 'android', token_hash: 'h',
        scopes_json: '["approve"]', created_at: 1,
      })
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      expect(store.listPushRegistrations()).toHaveLength(1)

      store.revokeDevice('d1')
      expect(store.listPushRegistrations()).toHaveLength(0)
      // Still visible to the admin view so the row can be explained.
      expect(store.listDevicePushRegistrations('d1')).toHaveLength(1)

      expect(store.deleteDevicePushRegistrations('d1')).toBe(1)
      expect(store.countPushRegistrations()).toEqual({ active: 0, dead: 0 })
    } finally {
      store.close()
    }
  })

  test('a dead registration is excluded from delivery but counted', () => {
    const store = new Store(':memory:')
    try {
      store.insertDevice({
        id: 'd1', name: 'Phone', platform: 'android', token_hash: 'h',
        scopes_json: '["approve"]', created_at: 1,
      })
      const registration = store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })!
      store.markPushRegistrationDead(registration.id, 'fcm 404 NOT_FOUND')
      expect(store.listPushRegistrations()).toHaveLength(0)
      expect(store.countPushRegistrations()).toEqual({ active: 0, dead: 1 })

      // Re-registering clears the failure: the app is alive and asking again.
      const again = store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })!
      expect(again.id).toBe(registration.id)
      expect(again.failedAt).toBeNull()
      expect(store.countPushRegistrations()).toEqual({ active: 1, dead: 0 })
    } finally {
      store.close()
    }
  })
})

// ── Dispatcher ───────────────────────────────────────────────

describe('push dispatcher', () => {
  function storeWith(deviceId = 'd1'): Store {
    const store = new Store(':memory:')
    store.insertDevice({
      id: deviceId, name: 'Phone', platform: 'android', token_hash: 'h',
      scopes_json: '["approve"]', created_at: 1,
    })
    return store
  }

  test('a permanent failure retires only the registration that caused it', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'dead', platform: 'android' })
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'live', platform: 'android' })

      const dispatcher = createPushDispatcher({
        store,
        providers: {
          fcm: {
            name: 'fcm',
            send: async message => (message.token === 'dead'
              ? { ok: false, permanent: true, error: 'fcm 404 NOT_FOUND' }
              : { ok: true }),
          },
        },
      })

      expect(await dispatcher.notify({ kind: 'approval', sessionId: 's1' }))
        .toEqual({ considered: 2, delivered: 1, retryable: 0, dead: 1, skipped: 0 })
      // The dead one is gone; the live one is untouched.
      expect(store.listPushRegistrations().map(row => row.token)).toEqual(['live'])
      expect(store.listAudit(5).some(row => row.action === 'push_registration_dead')).toBe(true)
    } finally {
      store.close()
    }
  })

  test('a transient failure keeps the registration for the next event', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      const dispatcher = createPushDispatcher({
        store,
        providers: {
          webhook: { name: 'webhook', send: async () => ({ ok: false, permanent: false, error: 'webhook 503' }) },
        },
      })
      expect(await dispatcher.notify({ kind: 'done', sessionId: 's1' }))
        .toEqual({ considered: 1, delivered: 0, retryable: 1, dead: 0, skipped: 0 })
      expect(store.listPushRegistrations()).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  test('a provider that throws is a retryable failure, not a crash', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })
      const dispatcher = createPushDispatcher({
        store,
        providers: { fcm: { name: 'fcm', send: async () => { throw new Error('socket hang up') } } },
      })
      expect(await dispatcher.notify({ kind: 'done', sessionId: 's1' }))
        .toEqual({ considered: 1, delivered: 0, retryable: 1, dead: 0, skipped: 0 })
    } finally {
      store.close()
    }
  })

  test('an unconfigured provider is skipped rather than failed', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'tok', platform: 'android' })
      const dispatcher = createPushDispatcher({ store, providers: {} })
      expect(await dispatcher.notify({ kind: 'done', sessionId: 's1' }))
        .toEqual({ considered: 1, delivered: 0, retryable: 0, dead: 0, skipped: 1 })
      expect(store.listPushRegistrations()).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  test('the notification carries the session and the per-kind default copy', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      const sent: unknown[] = []
      const dispatcher = createPushDispatcher({
        store,
        providers: { webhook: { name: 'webhook', send: async (message) => { sent.push(message); return { ok: true } } } },
      })
      await dispatcher.notify({ kind: 'question', sessionId: 's7' })
      await dispatcher.notify({ kind: 'done', sessionId: 's7', title: 'Build finished' })
      expect(sent).toEqual([
        {
          token: 'https://h.test/a',
          kind: 'question',
          title: 'Question waiting',
          body: 'A session asked you something.',
          sessionId: 's7',
          collapseKey: 's7',
        },
        {
          token: 'https://h.test/a',
          kind: 'done',
          title: 'Build finished',
          body: 'A session stopped working.',
          sessionId: 's7',
          collapseKey: 's7',
        },
      ])
    } finally {
      store.close()
    }
  })

  test('a device-scoped notification ignores other devices', async () => {
    const store = storeWith()
    try {
      store.insertDevice({
        id: 'd2', name: 'Tablet', platform: 'android', token_hash: 'h2',
        scopes_json: '["approve"]', created_at: 2,
      })
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      store.upsertPushRegistration({ deviceId: 'd2', provider: 'webhook', token: 'https://h.test/b', platform: 'android' })
      const sent: string[] = []
      const dispatcher = createPushDispatcher({
        store,
        providers: { webhook: { name: 'webhook', send: async (message) => { sent.push(message.token); return { ok: true } } } },
      })
      await dispatcher.notify({ kind: 'done', sessionId: 's1', deviceId: 'd2' })
      expect(sent).toEqual(['https://h.test/b'])
    } finally {
      store.close()
    }
  })

  test('a transient failure is retried with the same message until it succeeds', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      const scheduled: Array<() => void> = []
      const sent: Array<Record<string, unknown>> = []
      const dispatcher = createPushDispatcher({
        store,
        providers: {
          webhook: {
            name: 'webhook',
            send: async (message) => {
              sent.push(message as unknown as Record<string, unknown>)
              // Transient twice, delivered on the third attempt.
              return sent.length <= 2
                ? { ok: false, permanent: false, error: 'webhook 503' }
                : { ok: true }
            },
          },
        },
        retry: { schedule: (fn) => { scheduled.push(fn); return scheduled.length } },
      })

      // The first report describes this event's first pass only.
      expect(await dispatcher.notify({ kind: 'done', sessionId: 's1' }))
        .toEqual({ considered: 1, delivered: 0, retryable: 1, dead: 0, skipped: 0 })
      expect(sent).toHaveLength(1)
      expect(scheduled).toHaveLength(1)

      scheduled.shift()!()
      await waitUntil(() => sent.length === 2)
      expect(scheduled).toHaveLength(1)

      scheduled.shift()!()
      await waitUntil(() => sent.length === 3)
      expect(scheduled).toHaveLength(0)
      // Every retry re-sent the exact first message.
      expect(sent[1]).toEqual(sent[0])
      expect(sent[2]).toEqual(sent[0])
      expect(store.listPushRegistrations()).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  test('a permanent failure is not retried', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'fcm', token: 'dead', platform: 'android' })
      const scheduled: Array<() => void> = []
      const dispatcher = createPushDispatcher({
        store,
        providers: {
          fcm: { name: 'fcm', send: async () => ({ ok: false, permanent: true, error: 'fcm 404 NOT_FOUND' }) },
        },
        retry: { schedule: (fn) => { scheduled.push(fn); return scheduled.length } },
      })
      expect(await dispatcher.notify({ kind: 'done', sessionId: 's1' }))
        .toEqual({ considered: 1, delivered: 0, retryable: 0, dead: 1, skipped: 0 })
      expect(scheduled).toHaveLength(0)
      expect(store.listPushRegistrations()).toHaveLength(0)
    } finally {
      store.close()
    }
  })

  test('dispose cancels pending retries', async () => {
    const store = storeWith()
    try {
      store.upsertPushRegistration({ deviceId: 'd1', provider: 'webhook', token: 'https://h.test/a', platform: 'android' })
      const scheduled: Array<() => void> = []
      const sent: unknown[] = []
      const dispatcher = createPushDispatcher({
        store,
        providers: {
          webhook: {
            name: 'webhook',
            send: async (message) => {
              sent.push(message)
              return { ok: false, permanent: false, error: 'webhook 503' }
            },
          },
        },
        retry: { schedule: (fn) => { scheduled.push(fn); return scheduled.length } },
      })

      await dispatcher.notify({ kind: 'done', sessionId: 's1' })
      expect(sent).toHaveLength(1)
      expect(scheduled).toHaveLength(1)

      dispatcher.dispose?.()
      scheduled.shift()!()
      await Bun.sleep(10)
      expect(sent).toHaveLength(1)
      expect(scheduled).toHaveLength(0)
    } finally {
      store.close()
    }
  })
})

// ── Gateway routes ───────────────────────────────────────────

describe('push routes', () => {
  let harness: Harness
  afterEach(() => harness?.close())

  test('a device registers, sees, and removes its own destination', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const registered = await fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'webhook', token: 'https://relay.example.com/hook' }),
    })
    expect(registered.status).toBe(200)
    const { registration } = await registered.json() as { registration: { id: string; platform: string } }
    expect(registration.platform).toBe('ios')

    const listed = await fetch(`${harness.url}/push/registrations`, { headers: authHeader(device.deviceToken) })
    expect((await listed.json() as { registrations: unknown[] }).registrations).toHaveLength(1)

    const removed = await fetch(`${harness.url}/push/registrations/${registration.id}`, {
      method: 'DELETE',
      headers: authHeader(device.deviceToken),
    })
    expect(removed.status).toBe(200)
    expect(harness.gateway.store.countPushRegistrations()).toEqual({ active: 0, dead: 0 })
  })

  test('one account cannot take over another account\'s push destination', async () => {
    // A push token is an address, not a secret: another user can learn it. If
    // re-registering moved the row, the original phone would go silent and the
    // new caller would receive that user's session notifications.
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceDesktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const bobDesktop = await enrollDesktop(harness, bob.token, { installationId: 'bob-laptop' })
    const alicePhone = await provisionDevice(harness, alice.token, aliceDesktop.desktop.id)
    const bobPhone = await provisionDevice(harness, bob.token, bobDesktop.desktop.id)

    const token = 'https://relay.example.com/shared-hook'
    const first = await fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: { ...authHeader(alicePhone.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'webhook', token }),
    })
    expect(first.status).toBe(200)

    const takeover = await fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: { ...authHeader(bobPhone.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'webhook', token }),
    })
    expect(takeover.status).toBe(409)

    // Alice's row is untouched and still points at her device.
    const rows = harness.gateway.store.listDevicePushRegistrations(alicePhone.deviceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.token).toBe(token)
    expect(harness.gateway.store.listDevicePushRegistrations(bobPhone.deviceId)).toHaveLength(0)
  })

  test('the same phone may re-register its own token', async () => {
    // The guard is about crossing accounts, not about rotation within one.
    harness = startGateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const desktop = await enrollDesktop(harness, alice.token, { installationId: 'alice-laptop' })
    const phone = await provisionDevice(harness, alice.token, desktop.desktop.id)
    const body = JSON.stringify({ provider: 'webhook', token: 'https://relay.example.com/hook' })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${harness.url}/push/register`, {
        method: 'POST',
        headers: { ...authHeader(phone.deviceToken), 'content-type': 'application/json' },
        body,
      })
      expect(response.status).toBe(200)
    }
    expect(harness.gateway.store.listDevicePushRegistrations(phone.deviceId)).toHaveLength(1)
  })

  test('registration rejects a bad provider, an empty token, and a missing device token', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const post = (body: unknown, token: string | null) => fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: {
        ...(token ? authHeader(token) : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    expect((await post({ provider: 'apns', token: 'x' }, device.deviceToken)).status).toBe(400)
    expect((await post({ provider: 'fcm', token: '  ' }, device.deviceToken)).status).toBe(400)
    expect((await post({ provider: 'fcm', token: 'x' }, null)).status).toBe(401)
  })

  test('a device cannot delete another device\'s registration', async () => {
    harness = startGateway()
    const first = await pairDevice(harness, { name: 'Phone' })
    const second = await pairDevice(harness, { name: 'Tablet' })
    const created = await fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: { ...authHeader(first.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'webhook', token: 'https://relay.example.com/hook' }),
    })
    const { registration } = await created.json() as { registration: { id: string } }

    const denied = await fetch(`${harness.url}/push/registrations/${registration.id}`, {
      method: 'DELETE',
      headers: authHeader(second.deviceToken),
    })
    expect(denied.status).toBe(404)
    expect(harness.gateway.store.countPushRegistrations()).toEqual({ active: 1, dead: 0 })
  })

  test('notify requires an agent or admin token and a known kind', async () => {
    harness = startGateway()
    const post = (body: unknown, token: string | null) => fetch(`${harness.url}/push/notify`, {
      method: 'POST',
      headers: {
        ...(token ? authHeader(token) : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    expect((await post({ kind: 'approval', sessionId: 's1' }, null)).status).toBe(401)
    expect((await post({ kind: 'approval', sessionId: 's1' }, 'agt_wrong')).status).toBe(401)
    expect((await post({ kind: 'panic', sessionId: 's1' }, AGENT_TOKEN)).status).toBe(400)
    expect((await post({ kind: 'approval' }, AGENT_TOKEN)).status).toBe(400)
    expect((await post({ kind: 'approval', sessionId: 's1' }, ADMIN_TOKEN)).status).toBe(200)
  })

  test('a notification reaches the registered endpoint end to end', async () => {
    harness = startGateway()
    const received: Array<Record<string, unknown>> = []
    const relay = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        received.push(await req.json() as Record<string, unknown>)
        return Response.json({ ok: true })
      },
    })
    try {
      const device = await pairDevice(harness)
      await fetch(`${harness.url}/push/register`, {
        method: 'POST',
        headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'webhook', token: `http://127.0.0.1:${relay.port}/hook` }),
      })

      // Cleartext is refused by default, so the registration is dead on arrival.
      const refused = await fetch(`${harness.url}/push/notify`, {
        method: 'POST',
        headers: { ...authHeader(AGENT_TOKEN), 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'approval', sessionId: 's1' }),
      })
      expect((await refused.json() as { report: { dead: number } }).report.dead).toBe(1)
      expect(received).toHaveLength(0)
    } finally {
      relay.stop(true)
    }
  })

  test('an allowed cleartext destination is delivered to, and a gone one retires itself', async () => {
    const received: Array<Record<string, unknown>> = []
    let status = 200
    const relay = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        received.push(await req.json() as Record<string, unknown>)
        return new Response(status === 200 ? '{"ok":true}' : 'gone', { status })
      },
    })
    harness = startGateway({
      ...harnessConfig(),
      webhookAllowCleartext: true,
      pushWatch: false,
    })
    try {
      const device = await pairDevice(harness)
      await fetch(`${harness.url}/push/register`, {
        method: 'POST',
        headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'webhook', token: `http://127.0.0.1:${relay.port}/hook`, platform: 'android' }),
      })

      const notify = () => fetch(`${harness.url}/push/notify`, {
        method: 'POST',
        headers: { ...authHeader(AGENT_TOKEN), 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'question', sessionId: 's9' }),
      })

      const first = await (await notify()).json() as { report: Record<string, number> }
      expect(first.report).toEqual({ considered: 1, delivered: 1, retryable: 0, dead: 0, skipped: 0 })
      expect(received).toEqual([{
        kind: 'question',
        title: 'Question waiting',
        body: 'A session asked you something.',
        sessionId: 's9',
        collapseKey: 's9',
      }])

      status = 410
      const second = await (await notify()).json() as { report: Record<string, number> }
      expect(second.report.dead).toBe(1)
      // The row is retired, so the next event does not even try.
      const third = await (await notify()).json() as { report: Record<string, number> }
      expect(third.report.considered).toBe(0)
      expect(received).toHaveLength(2)
    } finally {
      harness.close()
      relay.stop(true)
    }
  })

  test('admin can see push state and send a test notification', async () => {
    // Delivery "fails" through an injected fetch that rejects at once: a real
    // hostname — even one that should NXDOMAIN — once made this test race the
    // machine's resolver and blow past bun's 5s test budget.
    harness = startGateway({}, {}, {
      fetchImpl: (async () => { throw new TypeError('fetch failed: unreachable') }) as unknown as typeof fetch,
    })
    const device = await pairDevice(harness)
    await fetch(`${harness.url}/push/register`, {
      method: 'POST',
      headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'webhook', token: 'https://relay.example.com/hook' }),
    })

    const state = await fetch(`${harness.url}/admin/push`, { headers: authHeader(ADMIN_TOKEN) })
    const body = await state.json() as { providers: string[]; counts: { active: number }; registrations: unknown[] }
    expect(body.providers).toEqual(['webhook', 'expo'])
    expect(body.counts.active).toBe(1)
    expect(body.registrations).toHaveLength(1)

    // The webhook host is not reachable, so delivery fails transiently — the
    // point is that the endpoint runs the real providers.
    const test = await fetch(`${harness.url}/admin/push/test`, {
      method: 'POST',
      headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'approval' }),
    })
    expect(test.status).toBe(200)
    expect((await test.json() as { report: { considered: number } }).report.considered).toBe(1)

    expect((await fetch(`${harness.url}/admin/push`)).status).toBe(401)
  })

  test('the watcher turns a session waiting on the user into a delivered notification', async () => {
    const delivered: Array<Record<string, unknown>> = []
    const relay = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        delivered.push(await req.json() as Record<string, unknown>)
        return Response.json({ ok: true })
      },
    })
    let live: unknown = { sessions: [{ id: 's1', activityState: 'running' }] }
    const upstream = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: req => (new URL(req.url).pathname === '/api/sessions/live-status'
        ? Response.json(live)
        : Response.json({ ok: true })),
    })
    harness = startGateway({
      upstreamUrl: `http://127.0.0.1:${upstream.port}`,
      webhookAllowCleartext: true,
      pushWatchIntervalMs: 20,
    })
    try {
      const device = await pairDevice(harness)
      await fetch(`${harness.url}/push/register`, {
        method: 'POST',
        headers: { ...authHeader(device.deviceToken), 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'webhook', token: `http://127.0.0.1:${relay.port}/hook` }),
      })

      // Let the watcher seed on the running session, then have it start waiting.
      await Bun.sleep(120)
      expect(delivered).toHaveLength(0)
      live = { sessions: [{ id: 's1', activityState: 'waiting' }] }
      await waitUntil(() => delivered.length > 0, 2000)

      expect(delivered[0]).toMatchObject({ kind: 'approval', sessionId: 's1' })
      // The session list and the phone agree on what "waiting" means; the
      // notification only names the session and lets the phone open it.
      expect(harness.gateway.store.countPushRegistrations()).toEqual({ active: 1, dead: 0 })
    } finally {
      harness.close()
      upstream.stop(true)
      relay.stop(true)
    }
  })

  test('health reports the push configuration', async () => {
    harness = startGateway()
    const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as {
      push: { providers: string[]; watching: boolean; registrations: { active: number; dead: number } }
    }
    expect(health.push.providers).toEqual(['webhook', 'expo'])
    expect(health.push.watching).toBe(true)
    expect(health.push.registrations).toEqual({ active: 0, dead: 0 })
  })

  test('the watcher can be switched off', async () => {
    harness = startGateway({ pushWatch: false })
    const health = await (await fetch(`${harness.url}/admin/health`, { headers: authHeader(ADMIN_TOKEN) })).json() as { push: { watching: boolean } }
    expect(health.push.watching).toBe(false)
  })
})

function harnessConfig() {
  return { webhookAllowCleartext: true, pushWatch: false as boolean | undefined }
}

/** Polls a condition so a test does not race a background timer. */
async function waitUntil(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(10)
  }
  throw new Error('condition not met before the deadline')
}

// ── Expo push provider ───────────────────────────────────────

describe('expo provider', () => {
  const message = {
    token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    kind: 'approval' as const,
    title: 'Approval needed',
    body: 'A session is waiting.',
    sessionId: 's-1',
    requestId: 'req-1',
    collapseKey: 'session:s-1',
  }

  test('posts the notification and carries the deep-link data', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const provider = createExpoProvider({
      sendUrl: 'https://expo.test/send',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } }), { status: 200 })
      }) as unknown as typeof fetch,
    })

    expect(await provider.send(message)).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://expo.test/send')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toMatchObject({
      to: message.token,
      title: message.title,
      body: message.body,
      collapseId: 'session:s-1',
      categoryId: 'approval',
      data: { kind: 'approval', sessionId: 's-1', requestId: 'req-1' },
    })
  })

  test('only a pending approval carries the action category', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const provider = createExpoProvider({
      sendUrl: 'https://expo.test/send',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response(JSON.stringify({ data: { status: 'ok', id: 't2' } }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await provider.send({ ...message, kind: 'done', requestId: undefined })
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.categoryId).toBeUndefined()
  })

  test('rejects a token that is not an Expo token without calling the network', async () => {
    let called = false
    const provider = createExpoProvider({
      fetchImpl: (async () => { called = true; return new Response('{}') }) as unknown as typeof fetch,
    })
    expect(await provider.send({ ...message, token: 'fcm-raw-token' }))
      .toEqual({ ok: false, permanent: true, error: 'expo: not an Expo push token' })
    expect(called).toBe(false)
  })

  test('a DeviceNotRegistered ticket is permanent, a 5xx is transient', async () => {
    const unregistered = createExpoProvider({
      fetchImpl: (async () => new Response(JSON.stringify({
        data: { status: 'error', details: { error: 'DeviceNotRegistered' } },
      }), { status: 200 })) as unknown as typeof fetch,
    })
    const first = await unregistered.send(message)
    expect(first.ok).toBe(false)
    expect(first.ok === false && first.permanent).toBe(true)

    const flaky = createExpoProvider({
      fetchImpl: (async () => new Response('upstream down', { status: 503 })) as unknown as typeof fetch,
    })
    const second = await flaky.send(message)
    expect(second).toEqual({ ok: false, permanent: false, error: 'expo 503' })
  })

  test('a 4xx means the token or credential is unusable', async () => {
    const provider = createExpoProvider({
      fetchImpl: (async () => new Response('invalid token', { status: 400 })) as unknown as typeof fetch,
    })
    const outcome = await provider.send(message)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.permanent).toBe(true)
    expect(outcome.ok === false && outcome.error).toContain('expo 400')
  })

  test('sends the access token when configured', async () => {
    let header: string | null = null
    const provider = createExpoProvider({
      accessToken: 'expo-secret',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        header = new Headers(init.headers).get('authorization')
        return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    await provider.send(message)
    expect(header).toBe('Bearer expo-secret')
  })
})
