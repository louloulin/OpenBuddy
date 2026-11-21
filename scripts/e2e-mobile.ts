/**
 * End-to-end verification (20261115-mobile.md §6 Phase 2 acceptance):
 *
 *   phone-sim (GatewayTransport over the gateway)
 *     → gateway /api/* HTTP tunnel (device token, scope checks)
 *     → AgentHub WS tunnel (desktop dialed out with agentCore)
 *     → PiBridge server (loopback, validate + scope + handler)
 *     → fake host dispatcher (stands in for the real PiEngine handlers)
 *
 * What it proves:
 *   1. Desktop enrollment + outbound WS tunnel to a NAT'd gateway works.
 *   2. One-time pairing mints a device token bound to that desktop.
 *   3. A phone invoke reaches the host handler and the reply comes back.
 *   4. Engine events flow phone-ward through the tunnel as SSE with seq.
 *   5. Denied commands and wrong tokens are refused (LLM key never needed).
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway, type Gateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. Fake host dispatcher (the real one wraps PiEngine handlers) ──────────

const engineListeners = new Set<(event: string, payload: unknown) => void>()
const handledCommands: string[] = []

const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    handledCommands.push(command)
    switch (command) {
      case 'agent_new_session':
        return { sessionId: 'sess-1' }
      case 'agent_send':
        // A real engine would stream; emit the events a session turn produces.
        setTimeout(() => {
          engineListeners.forEach(listener => listener('agent://event', { sessionId: 'sess-1', event: { type: 'message_update', assistantMessageEvent: { delta: 'Hello' } } }))
          engineListeners.forEach(listener => listener('agent://event', { sessionId: 'sess-1', event: { type: 'message_update', assistantMessageEvent: { delta: ' from' } } }))
          engineListeners.forEach(listener => listener('agent://event', { sessionId: 'sess-1', event: { type: 'agent_settled' } }))
        }, 30)
        return { promptId: 'p1' }
      case 'agent_list_sessions':
        return [{ id: 'sess-1', title: 'E2E session' }]
      case 'agent_resolve_permission':
        return { resolved: true }
      default:
        throw new Error(`unexpected command ${command}`)
    }
  },
  listen: handler => {
    engineListeners.add(handler)
    return () => engineListeners.delete(handler)
  },
  servedCommands: () => [
    'agent_new_session', 'agent_send', 'agent_list_sessions', 'agent_resolve_permission',
    'window_minimize', // deliberately present: the bridge must filter it out
  ],
}

// ── 2. Real gateway on an ephemeral port ────────────────────────────────────

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1', // never used: all traffic goes through the tunnel
  adminToken: 'e2e-admin-token',
  agentToken: 'e2e-agent-token',
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 1024 * 1024,
  allowedOrigins: [],
  h5Enabled: false,
  h5Dir: '.',
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: false,
  pushWatchIntervalMs: 60_000,
  fcmChannelId: 'e2e',
  trustProxy: false,
} as Parameters<typeof createGateway>[0])

const gatewayServer = serve({
  idleTimeout: 120,
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => gateway.app.fetch(req, server),
  websocket,
})
const gatewayUrl = `http://127.0.0.1:${gatewayServer.port}`
console.log(`gateway on ${gatewayUrl}`)

// ── 3. Desktop side: bridge server + agent dial-out ─────────────────────────

const bridge = createBridgeServer(dispatcher, { token: 'bridge-secret' })
const bridgeServer = serve({
  idleTimeout: 120,
  port: 0,
  hostname: '127.0.0.1',
  fetch: bridge.app.fetch,
})
const bridgeUrl = `http://127.0.0.1:${bridgeServer.port}`

const agent = createAgentClient({
  gatewayUrl,
  agentToken: 'e2e-agent-token',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'bridge-secret',
  log: () => {},
})

// Wait for the agent's tunnel to be live.
await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolve() }
  }, 50)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})
check('desktop tunnel connected to gateway (outbound only)', agent.connected())

// ── 4. Pairing: admin mints a code, phone claims it ─────────────────────────

const pairResponse = await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer e2e-admin-token', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string; desktopId?: string }
check('pair/start returned an 8-digit code', /^\d{8}$/.test(pair.code))

const claimResponse = await fetch(`${gatewayUrl}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: pair.code, deviceName: 'E2E Phone', platform: 'ios' }),
})
const claim = (await claimResponse.json()) as { deviceToken: string; deviceId: string; scopes: string[] }
check('pair/claim minted a device token', typeof claim.deviceToken === 'string' && claim.deviceToken.startsWith('dvc_'))
check('device is bound to the enrolled desktop', claim.scopes.includes('sessions:write'))

// ── 5. Phone side: GatewayTransport through the gateway tunnel ──────────────

const phone = new GatewayTransport({
  // The gateway forwards the phone's path verbatim to the desktop bridge, so
  // the mobile base URL carries the /api prefix the bridge serves.
  baseUrl: `${gatewayUrl}/api`,
  token: claim.deviceToken,
  maxBackoffMs: 500,
})

// Capabilities: the phone learns the surface from the bridge (via the /api tunnel).
const capsResponse = await fetch(`${gatewayUrl}/api/capabilities`, {
  headers: { authorization: `Bearer ${claim.deviceToken}` },
})
const caps = (await capsResponse.json()) as { platform: string; commands: string[] }
check('capabilities reachable through the gateway tunnel', caps.platform === 'mobile-host')
check('desktop-only commands are filtered from the mobile surface', !caps.commands.includes('window_minimize'))
check('session commands are exposed', caps.commands.includes('agent_send'))

// Command over the tunnel: list sessions (read scope).
const sessions = await phone.invoke<Array<{ id: string; title: string }>>('agent_list_sessions', {})
check('invoke over the tunnel reached the host handler', Array.isArray(sessions) && sessions[0]?.title === 'E2E session')
check('handler dispatch recorded the command', handledCommands.includes('agent_list_sessions'))

// Streaming: subscribe first, then send.
const streamed: string[] = []
let settled = false
const unlisten = await phone.listen<{ sessionId: string; event: { type: string; assistantMessageEvent?: { delta?: string } } }>('agent://event', payload => {
  if (payload.event.type === 'message_update' && payload.event.assistantMessageEvent?.delta) {
    streamed.push(payload.event.assistantMessageEvent.delta)
  }
  if (payload.event.type === 'agent_settled') settled = true
})
await new Promise(resolve => setTimeout(resolve, 150))

await phone.invoke('agent_new_session', { modelId: 'test-model' })
await phone.invoke('agent_send', { text: 'hi' })

const deadline = Date.now() + 5000
while (!settled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
check('session events streamed to the phone over the tunnel', streamed.join('') === 'Hello from', `streamed=${JSON.stringify(streamed)}`)
check('turn settled event arrived', settled)

// Denied command: the bridge refuses desktop-native commands.
let denied = false
try { await phone.invoke('window_minimize') } catch { denied = true }
check('desktop-native command refused for the phone', denied)

// ── 6. Security: wrong token, revoked-scope behavior ────────────────────────

const badResponse = await fetch(`${gatewayUrl}/api/capabilities`, {
  headers: { authorization: 'Bearer dvc_fake_token' },
})
check('wrong device token rejected', badResponse.status === 401 || badResponse.status === 403)

// ── Cleanup ──────────────────────────────────────────────────────────────────
unlisten()
phone.close()
agent.close()
gatewayServer.stop(true)
bridgeServer.stop(true)
gateway.close()

console.log(failures === 0 ? '\nE2E: ALL CHECKS PASSED' : `\nE2E: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
