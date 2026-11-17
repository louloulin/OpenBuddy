/**
 * Push loop end-to-end (20261115-mobile.md §5.8, closed loop).
 *
 * The phone path has four hops:
 *
 *   desktop event → PiBridge live-status → gateway watcher → push provider → phone
 *
 * The last hop is the one this script proves: the gateway polls the desktop
 * through the tunnel, notices a session start waiting, and delivers a push to
 * a device's registered destination. A local webhook receiver stands in for
 * FCM/APNs — the decision and the addressing are the parts under test.
 *
 * Run: bun run scripts/e2e-mobile-push.ts
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. The phone's push destination (a webhook standing in for FCM/APNs) ────

const received: Array<{ kind?: string; sessionId?: string; requestId?: string; title?: string }> = []
const receiver = serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'POST') return new Response('ok')
    const body = (await req.json().catch(() => null)) as (typeof received)[number] | null
    if (body) received.push(body)
    return new Response('ok')
  },
})
const receiverUrl = `http://127.0.0.1:${receiver.port}/push`

// ── 2. Desktop: the bridge, fed by engine-shaped events ─────────────────────

const listeners = new Set<(event: string, payload: unknown) => void>()
const dispatcher: HostDispatcher = {
  dispatch: async (command) => {
    if (command === 'agent_list_sessions') return [{ sessionId: 'sess-push', title: 'Push loop' }]
    return {}
  },
  listen: handler => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
  servedCommands: () => ['agent_list_sessions'],
}
const fire = (event: string, payload: unknown) => {
  for (const listener of listeners) listener(event, payload)
}

const bridge = createBridgeServer(dispatcher, { token: 'push-bridge' })
const bridgeServer = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => bridge.fetch(req, server),
  websocket: bridge.websocket as never,
})
const bridgeUrl = `http://127.0.0.1:${bridgeServer.port}`

// ── 3. Gateway: short poll interval so the test does not wait seconds ──────

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: 'push-admin',
  agentToken: 'push-agent',
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 1024 * 1024,
  allowedOrigins: [],
  h5Enabled: false,
  h5Dir: '.',
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: true,
  pushWatchIntervalMs: 50,
  fcmChannelId: 'push-e2e',
  trustProxy: false,
} as Parameters<typeof createGateway>[0])

const gatewayServer = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => gateway.app.fetch(req, server),
  websocket,
})
const gatewayUrl = `http://127.0.0.1:${gatewayServer.port}`

const agent = createAgentClient({
  gatewayUrl,
  agentToken: 'push-agent',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'push-bridge',
  log: () => {},
})
await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolve() }
  }, 20)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})
check('desktop tunnel came up', agent.connected())

// ── 4. Pair a phone and register its push destination ──────────────────────

const pairResponse = await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer push-admin', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string }
const claimResponse = await fetch(`${gatewayUrl}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: pair.code, deviceName: 'Push phone', platform: 'ios' }),
})
const claim = (await claimResponse.json()) as { deviceToken: string }
const auth = { authorization: `Bearer ${claim.deviceToken}` }

const registered = await fetch(`${gatewayUrl}/push/register`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'webhook', token: receiverUrl }),
})
check('the phone registered a destination', registered.status === 200, `HTTP ${registered.status}`)

const waitFor = async (condition: () => boolean, ms = 4000): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return condition()
}

// ── 5. Work in progress is not news ────────────────────────────────────────

fire('agent://event', { sessionId: 'sess-push', event: { type: 'agent_start' } })
await new Promise(resolve => setTimeout(resolve, 600))
check('starting a turn pushes nothing', received.length === 0, `received=${received.length}`)

// ── 6. Waiting on the user is ───────────────────────────────────────────────

fire('agent://permission', { requestId: 'req-push-1', sessionId: 'sess-push', toolKind: 'agent_bash' })
const gotApproval = await waitFor(() => received.some(item => item.kind === 'approval'))
check('a pending approval reaches the phone', gotApproval, JSON.stringify(received))
const approval = received.find(item => item.kind === 'approval')
check('the push names the session', approval?.sessionId === 'sess-push')
check('the push carries the approval id (so the phone can answer it)', approval?.requestId === 'req-push-1')

// ── 7. Finishing is ────────────────────────────────────────────────────────
//
// A session that was *waiting* and then disappears is not news (the user
// answered it), so "done" is exercised with a session that only ever ran.

fire('agent://permission-dismiss', { requestId: 'req-push-1', sessionId: 'sess-push' })
fire('agent://event', { sessionId: 'sess-push', event: { type: 'agent_settled' } })

fire('agent://event', { sessionId: 'sess-done', event: { type: 'agent_start' } })
await new Promise(resolve => setTimeout(resolve, 250))
fire('agent://event', { sessionId: 'sess-done', event: { type: 'agent_settled' } })
const gotDone = await waitFor(() => received.some(item => item.kind === 'done'))
check('finishing the turn pushes "done"', gotDone, JSON.stringify(received.map(item => item.kind)))

// ── 8. A scheduled task is labelled as such ────────────────────────────────

fire('agent://event', { sessionId: 'sess-auto', event: { type: 'agent_start', scheduledTaskId: 'auto-1' } })
await new Promise(resolve => setTimeout(resolve, 200))
fire('agent://event', { sessionId: 'sess-auto', event: { type: 'agent_settled', scheduledTaskId: 'auto-1' } })
const gotScheduled = await waitFor(() => received.some(item => item.kind === 'scheduled'))
check('a scheduled task finishing is labelled scheduled', gotScheduled, JSON.stringify(received.map(item => item.kind)))

// ── Cleanup ─────────────────────────────────────────────────────────────────

agent.close()
gatewayServer.stop(true)
bridgeServer.stop(true)
receiver.stop(true)
gateway.close()

console.log(failures === 0 ? '\nPUSH E2E: ALL CHECKS PASSED' : `\nPUSH E2E: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
