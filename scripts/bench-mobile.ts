/**
 * Mobile-path benchmark (20261115-mobile.md §5.3 / Phase 5).
 *
 * Measures the real chain with no LLM involved: phone → gateway tunnel →
 * PiBridge → handler, plus the event tail. The numbers are the ones the plan's
 * targets are stated in, so a regression is visible as a number, not a feeling.
 *
 * Run: bun run scripts/bench-mobile.ts [--commands 200] [--events 2000]
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

const arg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const COMMANDS = arg('commands', 200)
const EVENTS = arg('events', 2000)
const WARMUP = 20

// ── Desktop side ────────────────────────────────────────────────────────────

const listeners = new Set<(event: string, payload: unknown) => void>()
let marker = 0

const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    if (command === 'agent_list_sessions') return [{ id: 'bench', title: 'bench' }]
    if (command === 'agent_send') {
      // Echo a small payload so the reply path is exercised, not just routing.
      return { promptId: `p-${String(payload.text ?? '')}` }
    }
    if (command === 'bench_ping') {
      // Not in COMMANDS; only exists to prove an unknown command is refused.
      return payload
    }
    return { marker: ++marker }
  },
  listen: handler => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
  servedCommands: () => ['agent_list_sessions', 'agent_send'],
}

const bridge = createBridgeServer(dispatcher, { token: 'bench-secret' })
const bridgeServer = serve({
  idleTimeout: 120,
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, server) => bridge.fetch(req, server),
  websocket: bridge.websocket as never,
})
const bridgeUrl = `http://127.0.0.1:${bridgeServer.port}`

// ── Gateway ─────────────────────────────────────────────────────────────────

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: 'bench-admin',
  agentToken: 'bench-agent',
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 10_000,
  maxBodyBytes: 2 * 1024 * 1024,
  allowedOrigins: [],
  h5Enabled: false,
  h5Dir: '.',
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: false,
  pushWatchIntervalMs: 60_000,
  fcmChannelId: 'bench',
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

const agent = createAgentClient({
  gatewayUrl,
  agentToken: 'bench-agent',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'bench-secret',
  log: () => {},
})

await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolve() }
  }, 20)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})

// ── Pair ────────────────────────────────────────────────────────────────────

const pair = (await (await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer bench-admin', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})).json()) as { code: string }

const claim = (await (await fetch(`${gatewayUrl}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: pair.code, deviceName: 'bench phone', platform: 'mobile' }),
})).json()) as { deviceToken: string }

const transport = new GatewayTransport({
  baseUrl: `${gatewayUrl}/api`,
  token: claim.deviceToken,
  maxBackoffMs: 100,
})
await new Promise<void>(resolve => {
  const timer = setInterval(() => {
    if (transport.state() === 'open') { clearInterval(timer); resolve() }
  }, 10)
  setTimeout(() => { clearInterval(timer); resolve() }, 5000)
})

// ── Command latency ─────────────────────────────────────────────────────────

for (let index = 0; index < WARMUP; index += 1) await transport.invoke('agent_send', { text: `warm-${index}` })

const commandLatencies: number[] = []
for (let index = 0; index < COMMANDS; index += 1) {
  const start = performance.now()
  await transport.invoke('agent_send', { text: `c-${index}` })
  commandLatencies.push(performance.now() - start)
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[at] ?? 0
}

// ── Event throughput ────────────────────────────────────────────────────────

let received = 0
let lastAt = 0
await transport.listen('agent://event', () => {
  received += 1
  lastAt = performance.now()
})

const eventStart = performance.now()
for (let index = 0; index < EVENTS; index += 1) {
  for (const listener of listeners) {
    listener('agent://event', { sessionId: 'bench', event: { type: 'message_delta', index } })
  }
}
const deadline = Date.now() + 15_000
while (received < EVENTS && Date.now() < deadline) await Bun.sleep(5)
const eventElapsed = lastAt - eventStart

// ── Report ──────────────────────────────────────────────────────────────────

const report = {
  commands: COMMANDS,
  commandLatencyMs: {
    p50: Number(percentile(commandLatencies, 50).toFixed(2)),
    p95: Number(percentile(commandLatencies, 95).toFixed(2)),
    max: Number(Math.max(...commandLatencies).toFixed(2)),
  },
  events: { expected: EVENTS, received, elapsedMs: Number(eventElapsed.toFixed(1)), perSecond: Number((received / (eventElapsed / 1000)).toFixed(1)) },
  chain: 'phone → gateway tunnel → PiBridge → handler (no LLM)',
}

console.log(JSON.stringify(report, null, 2))

transport.close()
agent.close()
gatewayServer.stop(true)
bridgeServer.stop(true)
gateway.close()

process.exit(report.events.received === EVENTS ? 0 : 1)
