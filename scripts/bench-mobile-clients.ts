/**
 * Concurrency and soak benchmark (20261115-mobile.md §5.3 / Phase 5).
 *
 * The single-phone benchmark measures latency; this one measures what a
 * *shared* gateway has to survive: many phones connected at once, each with
 * its own device token, its own event stream and its own commands.
 *
 *   N phones → gateway (N tunnels) → one desktop PiBridge → host handlers
 *
 * What it reports:
 *   - how long the last phone took to come up (the worst case matters more
 *     than the average)
 *   - per-phone command latency under contention
 *   - resident memory before and after, so a leak shows up as a number
 *   - with `--soak <seconds>`, the memory trend while the phones keep talking
 *
 * Run: bun run scripts/bench-mobile-clients.ts [--clients 100] [--soak 30]
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

const CLIENTS = arg('clients', 20)
const SOAK_SECONDS = arg('soak', 0)
const COMMANDS_EACH = arg('commands', 5)

const listeners = new Set<(event: string, payload: unknown) => void>()
let handled = 0

const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    handled += 1
    if (command === 'agent_send') return { promptId: `p-${String(payload.text ?? '')}` }
    if (command === 'agent_list_sessions') return [{ id: 'bench', title: 'bench' }]
    return { ok: true }
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

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: 'bench-admin',
  agentToken: 'bench-agent',
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 100_000,
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

// ── Pair every phone with its own device token ──────────────────────────────

const rss = () => Math.round(process.memoryUsage().rss / 1024 / 1024)
const memoryBefore = rss()

const connectStart = performance.now()
const transports: GatewayTransport[] = []
for (let index = 0; index < CLIENTS; index += 1) {
  const pair = (await (await fetch(`${gatewayUrl}/pair/start`, {
    method: 'POST',
    headers: { authorization: 'Bearer bench-admin', 'content-type': 'application/json' },
    body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write'] }),
  })).json()) as { code: string }

  const claim = (await (await fetch(`${gatewayUrl}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pair.code, deviceName: `phone-${index}`, platform: 'ios' }),
  })).json()) as { deviceToken: string }

  const transport = new GatewayTransport({
    baseUrl: `${gatewayUrl}/api`,
    token: claim.deviceToken,
    maxBackoffMs: 200,
  })
  transports.push(transport)
}
const pairedMs = performance.now() - connectStart

// Wait for every stream to come up; the slowest one is the number that matters.
const openStart = performance.now()
const openTimes: number[] = []
for (const transport of transports) {
  const started = performance.now()
  while (transport.state() !== 'open' && performance.now() - openStart < 20_000) {
    await Bun.sleep(5)
  }
  openTimes.push(performance.now() - started)
}
const allOpenMs = performance.now() - openStart
const openCount = transports.filter(transport => transport.state() === 'open').length

// ── Commands under contention ───────────────────────────────────────────────

const latencies: number[] = []
const failures: string[] = []
for (let round = 0; round < COMMANDS_EACH; round += 1) {
  const batch = transports.map(async (transport, index) => {
    const start = performance.now()
    try {
      await transport.invoke('agent_send', { text: `c-${round}-${index}` })
      latencies.push(performance.now() - start)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  })
  await Promise.all(batch)
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[at] ?? 0
}

// ── Soak: keep talking and watch the memory ─────────────────────────────────

const soakSamples: number[] = []
if (SOAK_SECONDS > 0) {
  const until = Date.now() + SOAK_SECONDS * 1000
  let round = 0
  while (Date.now() < until) {
    await Promise.all(transports.map(transport => transport.invoke('agent_send', { text: `soak-${round}` })))
    for (const listener of listeners) listener('agent://event', { sessionId: 'bench', event: { type: 'message_delta', round } })
    soakSamples.push(rss())
    round += 1
    await Bun.sleep(250)
  }
}

const memoryAfter = rss()

const report = {
  clients: CLIENTS,
  pairedMs: Number(pairedMs.toFixed(1)),
  allOpenMs: Number(allOpenMs.toFixed(1)),
  openClients: openCount,
  slowestOpenMs: Number(Math.max(0, ...openTimes).toFixed(1)),
  commandLatencyMs: {
    p50: Number(percentile(latencies, 50).toFixed(2)),
    p95: Number(percentile(latencies, 95).toFixed(2)),
    max: Number(Math.max(0, ...latencies).toFixed(2)),
  },
  commands: latencies.length,
  failed: failures.length,
  failureSample: failures.slice(0, 3),
  handled,
  memoryMb: { before: memoryBefore, after: memoryAfter, growth: memoryAfter - memoryBefore },
  soak: soakSamples.length > 0
    ? { seconds: SOAK_SECONDS, first: soakSamples[0], last: soakSamples.at(-1), samples: soakSamples.length }
    : null,
  chain: `${CLIENTS} phones → gateway → one PiBridge → host handlers (no LLM)`,
}

console.log(JSON.stringify(report, null, 2))

for (const transport of transports) transport.close()
agent.close()
gatewayServer.stop(true)
bridgeServer.stop(true)
gateway.close()

// Every phone must have come up, and the soak must not have grown the heap.
const leaked = soakSamples.length > 1 && soakSamples.at(-1)! - soakSamples[0]! > 128
process.exit(openCount === CLIENTS && !leaked ? 0 : 1)
