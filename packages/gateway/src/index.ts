import { dirname } from 'node:path'

import { websocket } from 'hono/bun'

import { createGateway } from './app.js'
import { ensureBootstrapAdmin } from './bootstrapAdmin.js'
import { loadConfig, type GatewayConfig } from './config.js'
import { resolveSecret, secretNotice } from './credentials.js'
import { setEmbeddedUi } from './ui.js'

// The console ships in the gateway by default: a tree that has run
// `ui:embed` (and every packaged binary) serves the admin console even with
// no gateway-ui directory on disk. A real directory build still wins when it
// exists, so a developer's fresh bundle is never shadowed by a stale embed.
await import('./generated/uiAssets.js')
  .then(module => setEmbeddedUi(module.embeddedUiAssets()))
  .catch(() => {
    // No embedded build in this checkout — the disk directory remains the
    // source, and `/ui` explains how to produce one when it is missing.
  })

const base = loadConfig()

/**
 * Where the gateway keeps its own files.
 *
 * The database lives here, so the token files live beside it: one directory
 * the operator already has to be able to write.
 */
const dataDir = base.dbPath === ':memory:' ? null : dirname(base.dbPath)

/**
 * The two privileged credentials.
 *
 * A token the operator supplied stays exactly as supplied. A token the gateway
 * generated is written to a file only the operator can read — never printed,
 * because stdout reaches every log aggregator in the deployment. The operator
 * is told the path and reads the value there.
 */
const adminSecret = resolveSecret({
  envValue: process.env.GATEWAY_ADMIN_TOKEN,
  envName: 'GATEWAY_ADMIN_TOKEN',
  dataDir,
  fileName: 'admin.token',
  prefix: 'adm_',
})
const agentSecret = resolveSecret({
  envValue: process.env.GATEWAY_AGENT_TOKEN,
  envName: 'GATEWAY_AGENT_TOKEN',
  dataDir,
  fileName: 'agent.token',
  prefix: 'agt_',
})

// A generated credential nobody can read is a gateway nobody can administer.
// Refusing to start is the only honest outcome: there is no third option that
// keeps the secret out of the log and still tells the operator what it is.
for (const [secret, envName] of [
  [adminSecret, 'GATEWAY_ADMIN_TOKEN'],
  [agentSecret, 'GATEWAY_AGENT_TOKEN'],
] as const) {
  if (secret.recoverable) continue
  console.error(
    `[gateway] refusing to start: the generated credential could not be written to `
      + `${secret.path ?? dataDir ?? 'the data directory'}; set ${envName} explicitly`,
  )
  process.exit(1)
}

const config: GatewayConfig = {
  ...base,
  adminToken: adminSecret.value,
  agentToken: agentSecret.value,
}

const gateway = createGateway(config)

// Creating the operator's account is idempotent, so this runs on every boot;
// a second start is a no-op rather than a second account or a password reset.
await ensureBootstrapAdmin(gateway.store, config)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // The Bun server handle travels as Hono's env: rate limiting reads the real
  // socket address from it (`server.requestIP`) instead of trusting headers,
  // and the WebSocket upgrade finds it there too.
  fetch: (req, bunServer) => gateway.app.fetch(req, bunServer),
  // Bun's Hono adapter needs the WebSocket handler exported alongside fetch.
  websocket,
})

console.log(`[gateway] listening on http://${config.host}:${server.port}`)
console.log(`[gateway] upstream: ${config.upstreamUrl}`)

/**
 * The address phones will be told to connect to.
 *
 * A public address in cleartext carries every session transcript and every
 * device token in the readable. The gateway cannot add TLS by itself — it
 * normally sits behind a terminating proxy — so the honest thing is to say
 * so at boot, and to refuse to start when the operator declared the
 * deployment public and asked for the check to be fatal.
 */
const advertised = config.publicUrl ?? (config.host === '0.0.0.0' || config.host === '::' ? undefined : `http://${config.host}:${server.port}`)
if (advertised && !advertised.startsWith('https://') && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(advertised)) {
  const message = `[gateway] the advertised address ${advertised} is plain HTTP; `
    + 'put the gateway behind HTTPS/WSS before phones outside the LAN use it'
  if (config.requireTls) {
    console.error(`${message} (GATEWAY_REQUIRE_TLS=1, refusing to start)`)
    process.exit(1)
  }
  console.warn(message)
}

console.log(secretNotice('admin token', adminSecret, 'GATEWAY_ADMIN_TOKEN'))
console.log(secretNotice('agent token', agentSecret, 'GATEWAY_AGENT_TOKEN'))

const shutdown = () => {
  gateway.close()
  void server.stop(true)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
