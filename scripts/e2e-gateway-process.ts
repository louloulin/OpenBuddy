/**
 * The gateway half of the desktop-bridge end-to-end check.
 *
 * The gateway is Bun-only (bun:sqlite), the desktop is Node/Electron-only.
 * They cannot share a process — Bun's `Bun.serve` and node's `http` in one
 * runtime make Bun reject its own Response objects — so the check runs them as
 * two processes talking over HTTP, exactly as they do in production.
 *
 * This file is the Bun process. It prints one JSON line with the address and
 * then stays alive until it is killed.
 */

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'

const ADMIN_TOKEN = 'e2e-admin-token'
const AGENT_TOKEN = 'e2e-agent-token'

const gateway = createGateway({
  host: '127.0.0.1',
  port: 0,
  upstreamUrl: 'http://127.0.0.1:1',
  adminToken: ADMIN_TOKEN,
  agentToken: AGENT_TOKEN,
  dbPath: ':memory:',
  pairTtlMs: 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 2 * 1024 * 1024,
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

const server = serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (req, bunServer) => gateway.app.fetch(req, bunServer),
  websocket,
})

console.log(JSON.stringify({
  ready: true,
  url: `http://127.0.0.1:${server.port}`,
  adminToken: ADMIN_TOKEN,
  agentToken: AGENT_TOKEN,
}))

// Stay up until the parent stops us.
await new Promise<void>(() => {})
