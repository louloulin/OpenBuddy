/**
 * End-to-end check of the desktop's own PiBridge (20261115-mobile.md Phase 2.6).
 *
 * This is the piece the earlier scripts stubbed out: instead of a fake
 * dispatcher inside one Bun process, the **desktop's** bridge module serves the
 * contract over node:http, dials the gateway itself with the gateway's agent
 * client, and a phone reaches it through the real tunnel.
 *
 * The gateway runs as a separate Bun process (it needs bun:sqlite); this half
 * runs under Node, like the Electron main process does.
 *
 * Run: node scripts/run-desktop-bridge-e2e.mjs
 */

import { createEngineEventHub, startMobileBridge } from '../apps/desktop/src/main/mobile-bridge.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

type GatewayInfo = { url: string; adminToken: string; agentToken: string }

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const info = JSON.parse(process.env.OPENBUDDY_E2E_GATEWAY ?? '{}') as GatewayInfo
if (!info.url) {
  console.error('OPENBUDDY_E2E_GATEWAY is missing')
  process.exit(2)
}

// ── The desktop side ────────────────────────────────────────────────────────

const hub = createEngineEventHub()
const handled: string[] = []
const handlers = {
  agent_list_sessions: () => {
    handled.push('agent_list_sessions')
    return [{ id: 'sess-desktop', title: 'Desktop bridge session' }]
  },
  agent_send: (payload: Record<string, unknown>) => {
    handled.push('agent_send')
    // The engine answers a turn with events; the bridge must carry them.
    setTimeout(() => {
      hub.emit('agent://event', {
        sessionId: 'sess-desktop',
        event: { type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: '来自桌面桥' } },
      })
      hub.emit('agent://event', { sessionId: 'sess-desktop', event: { type: 'agent_settled' } })
    }, 20)
    return { promptId: 'p1', text: payload.text }
  },
  agent_resolve_permission: () => ({ resolved: true }),
}

const bridge = await startMobileBridge({
  handlers,
  hub,
  uploadsDir: '/tmp/openbuddy-desktop-uploads',
  gatewayUrl: info.url,
  agentToken: info.agentToken,
})
check('the desktop started its PiBridge', bridge !== null, bridge?.url ?? '')

// ── A phone pairs with the gateway and talks to the desktop ────────────────

const pairResponse = await fetch(`${info.url}/pair/start`, {
  method: 'POST',
  headers: { authorization: `Bearer ${info.adminToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string }
check('the desktop gateway minted a pairing code', /^\d{8}$/.test(pair.code))

const claimResponse = await fetch(`${info.url}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: pair.code, deviceName: 'E2E Phone', platform: 'ios' }),
})
const claim = (await claimResponse.json()) as { deviceToken: string }
check('the phone claimed a device token', typeof claim.deviceToken === 'string' && claim.deviceToken.startsWith('dvc_'))

const transport = new GatewayTransport({
  baseUrl: `${info.url}/api`,
  token: claim.deviceToken,
  maxBackoffMs: 500,
})
const openDeadline = Date.now() + 5000
while (transport.state() !== 'open' && Date.now() < openDeadline) {
  await new Promise(resolve => setTimeout(resolve, 25))
}
check('the phone reached the desktop through the gateway', transport.state() === 'open', transport.state())

const caps = (await (await fetch(`${info.url}/api/capabilities`, {
  headers: { authorization: `Bearer ${claim.deviceToken}` },
})).json()) as { platform: string; commands: string[] }
check('the desktop advertised the mobile surface', caps.platform === 'mobile-host' && caps.commands.includes('agent_send'), JSON.stringify(caps.commands))

const sessions = await transport.invoke<Array<{ id: string }>>('agent_list_sessions', {})
check('a command ran the desktop handler', sessions[0]?.id === 'sess-desktop', JSON.stringify(sessions))
check('the desktop recorded the command', handled.includes('agent_list_sessions'))

let streamed = ''
await transport.listen<{ sessionId: string; event: { assistantMessageEvent?: { delta?: string } } }>(
  'agent://event',
  payload => { streamed += payload.event.assistantMessageEvent?.delta ?? '' },
)
await transport.invoke('agent_send', { text: 'hi' })
const streamDeadline = Date.now() + 3000
while (!streamed && Date.now() < streamDeadline) await new Promise(resolve => setTimeout(resolve, 25))
check('engine events reached the phone', streamed === '来自桌面桥', streamed)

await transport.close()
await bridge?.close()

console.log(failures === 0 ? '\nDESKTOP BRIDGE E2E: ALL CHECKS PASSED' : `\nDESKTOP BRIDGE E2E: ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
