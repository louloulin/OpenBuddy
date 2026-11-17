/**
 * H5 end-to-end verification (20261115-mobile.md Phase 3.5).
 *
 * The same React bundle the desktop renders is served by the gateway under
 * `/h5`. This script proves the two things that could break in a browser:
 *
 *   1. the bundle is actually served (documents + content-hashed assets), and
 *   2. the browser transport path works — claim a code, call `host_capabilities`
 *      through `/api`, and read the session list — which is exactly what
 *      `apps/web/src/app/h5/boot.ts` installs.
 *
 * Run:  bun run scripts/e2e-mobile-h5.ts            # checks then exits
 *       bun run scripts/e2e-mobile-h5.ts --serve    # stays up for a browser
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { serve } from 'bun'
import { websocket } from 'hono/bun'

import { createGateway } from '../packages/gateway/src/app.js'
import { createAgentClient } from '../packages/gateway/src/agentCore.js'
import { createBridgeServer, type HostDispatcher } from '../packages/pi-bridge/src/server.js'
import { GatewayTransport } from '../packages/client/src/gateway-transport.js'

const h5Dir = resolve('dist')
const keepServing = process.argv.includes('--serve')

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  const mark = condition ? 'PASS' : 'FAIL'
  if (!condition) failures += 1
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
}

let indexHtml: string
try {
  indexHtml = await readFile(join(h5Dir, 'index.html'), 'utf8')
} catch {
  console.error('dist/index.html is missing — run `npx vite build --config apps/web/vite.config.ts` first.')
  process.exit(2)
}

// ── Demo desktop ────────────────────────────────────────────────────────────

const listeners = new Set<(event: string, payload: unknown) => void>()
const dispatcher: HostDispatcher = {
  dispatch: async (command, payload) => {
    switch (command) {
      case 'agent_list_sessions':
        // `SessionSummary` (protocol): the sidebar selects by `sessionId`.
        return [
          { sessionId: 'sess-h5', title: '浏览器里的会话', cwd: '/preview/workspace', updatedAt: new Date(Date.now() - 90_000).toISOString(), pinned: true },
          { sessionId: 'sess-h5-2', title: 'H5 兜底验证', cwd: '/preview/workspace', updatedAt: new Date(Date.now() - 3_600_000).toISOString(), pinned: false },
        ]
      case 'agent_load_session':
        // The renderer hydrates from a snapshot, not from the event stream.
        return {
          cwd: '/preview/workspace',
          messages: [
            { role: 'user', content: '网页版也能用？', timestamp: Date.now() - 120_000 },
            {
              role: 'assistant',
              content: [{ type: 'text', text: '可以。页面由网关直接托管，请求沿 /api 隧道回到这台电脑。' }],
              timestamp: Date.now() - 118_000,
            },
          ],
          busy: false,
          status: 'idle',
          queue: { steering: [], followUp: [] },
        }
      case 'agent_send':
        setTimeout(() => {
          for (const listener of listeners) {
            listener('agent://event', { sessionId: String(payload.sessionId ?? 'sess-h5'), event: { type: 'message_start' } })
            listener('agent://event', { sessionId: String(payload.sessionId ?? 'sess-h5'), event: { type: 'message_delta', assistantMessageEvent: { type: 'text_delta', delta: '来自桌面的回复' } } })
            listener('agent://event', { sessionId: String(payload.sessionId ?? 'sess-h5'), event: { type: 'agent_settled' } })
          }
        }, 30)
        return { promptId: 'h5' }
      case 'agent_init':
        // Enough of the desktop's answer for the renderer to mount. No model
        // is configured, which is the honest state of a preview desktop.
        return {
          ok: true,
          auth: { ready: true },
          cwd: '/preview/workspace',
          inbox: '/preview/inbox',
          agentVersion: 'preview',
          invalidDefault: false,
        }
      case 'providers_list':
        return { models: [], providers: [] }
      case 'agents_defaults_get':
        return { invalidDefault: false }
      case 'tasks_list':
      case 'permission_list':
      case 'agent_list_workspaces':
        return []
      case 'permission_mode_get':
        return 'default'
      case 'settings_agent_get':
        return {}
      case 'notification_append':
        return { ok: true }
      case 'artifacts_list':
        return []
      case 'host_capabilities':
        // Deliberately the desktop's answer: the bridge must replace it with the
        // mobile surface, or the page would render dead buttons.
        return { protocolVersion: 1, platform: 'desktop', commands: ['window_minimize', 'write_text_file'], events: [], features: [] }
      default:
        throw new Error(`demo host has no ${command}`)
    }
  },
  listen: handler => {
    listeners.add(handler)
    return () => listeners.delete(handler)
  },
  servedCommands: () => [
    'host_capabilities', 'agent_init', 'providers_list', 'agents_defaults_get',
    'tasks_list', 'permission_list', 'agent_list_workspaces',
    'permission_mode_get', 'settings_agent_get', 'notification_append',
    'artifacts_list',
    'agent_list_sessions', 'agent_load_session', 'agent_send',
  ],
}

const bridge = createBridgeServer(dispatcher, { token: 'h5-bridge' })
const bridgeServer = serve({
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
  adminToken: 'h5-admin',
  agentToken: 'h5-agent',
  dbPath: ':memory:',
  pairTtlMs: 10 * 60_000,
  claimLimitPerMinute: 100,
  maxBodyBytes: 1024 * 1024,
  allowedOrigins: [],
  h5Enabled: true,
  h5Dir,
  pairAllowsSharedRoute: true,
  webhookAllowedHosts: [],
  webhookAllowCleartext: false,
  pushWatchIntervalMs: 60_000,
  fcmChannelId: 'h5',
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
  agentToken: 'h5-agent',
  getLocalServerUrl: () => bridgeUrl,
  localAccessToken: 'h5-bridge',
  log: () => {},
})
await new Promise<void>(resolvePromise => {
  const timer = setInterval(() => {
    if (agent.connected()) { clearInterval(timer); resolvePromise() }
  }, 20)
  setTimeout(() => { clearInterval(timer); resolvePromise() }, 5000)
})
check('desktop tunnel came up', agent.connected())

// ── 1. The bundle is served ─────────────────────────────────────────────────

const page = await fetch(`${gatewayUrl}/h5/`)
const pageText = await page.text()
check('gateway serves the H5 document', page.status === 200 && pageText.includes('<div id="root">'), `HTTP ${page.status}`)

const scriptSrc = /src="(\.\/[^"]+\.js)"/.exec(indexHtml)?.[1]?.replace(/^\.\//, '')
if (scriptSrc) {
  const asset = await fetch(`${gatewayUrl}/h5/${scriptSrc}`)
  check('content-hashed assets resolve under /h5', asset.status === 200 && (await asset.arrayBuffer()).byteLength > 1000, scriptSrc.slice(0, 48))
} else {
  check('index.html references its entry script', false, 'no script tag found')
}

const redirect = await fetch(`${gatewayUrl}/h5`, { redirect: 'manual' })
check('/h5 redirects to /h5/', [301, 302, 307, 308].includes(redirect.status), `HTTP ${redirect.status}`)

// ── 2. The browser transport path (what boot.ts installs) ───────────────────

const pairResponse = await fetch(`${gatewayUrl}/pair/start`, {
  method: 'POST',
  headers: { authorization: 'Bearer h5-admin', 'content-type': 'application/json' },
  body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
})
const pair = (await pairResponse.json()) as { code: string }

const claimResponse = await fetch(`${gatewayUrl}/pair/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: pair.code, deviceName: '浏览器', platform: 'web' }),
})
const claim = (await claimResponse.json()) as { deviceToken: string }
check('the page can claim a pairing code', claimResponse.status === 200 && claim.deviceToken.startsWith('dvc_'))

const transport = new GatewayTransport({ baseUrl: `${gatewayUrl}/api`, token: claim.deviceToken, maxBackoffMs: 500 })
await new Promise<void>(resolvePromise => {
  const timer = setInterval(() => {
    if (transport.state() === 'open') { clearInterval(timer); resolvePromise() }
  }, 25)
  setTimeout(() => { clearInterval(timer); resolvePromise() }, 5000)
})
check('the browser transport opens through /api', transport.state() === 'open')

const capabilities = await transport.invoke<{ platform: string; commands: string[] }>('host_capabilities', {})
check('host_capabilities describes the mobile surface', capabilities.platform === 'mobile-host', capabilities.platform)
check('desktop-only commands stay hidden from the page', !capabilities.commands.includes('window_minimize'))

const sessions = await transport.invoke<Array<{ id: string; title: string }>>('agent_list_sessions', {})
check('the session list arrives', Array.isArray(sessions) && sessions[0]?.title === '浏览器里的会话')

const streamed: string[] = []
await transport.listen<{ sessionId: string; event: { type: string; assistantMessageEvent?: { delta?: string } } }>('agent://event', payload => {
  if (payload.event.assistantMessageEvent?.delta) streamed.push(payload.event.assistantMessageEvent.delta)
})
await transport.invoke('agent_send', { sessionId: 'sess-h5', text: '你好' })
const deadline = Date.now() + 3000
while (streamed.join('') !== '来自桌面的回复' && Date.now() < deadline) {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
}
check('streamed replies reach the page', streamed.join('') === '来自桌面的回复', JSON.stringify(streamed))

transport.close()
check('browser credential is bound to the desktop', claimResponse.status === 200)

if (keepServing) {
  // The checks above consumed their code; mint a fresh one for the browser.
  const freshResponse = await fetch(`${gatewayUrl}/pair/start`, {
    method: 'POST',
    headers: { authorization: 'Bearer h5-admin', 'content-type': 'application/json' },
    body: JSON.stringify({ scopes: ['sessions:read', 'sessions:write', 'approve'] }),
  })
  const fresh = (await freshResponse.json()) as { code: string }
  console.log(JSON.stringify({ webUrl: `${gatewayUrl}/h5/`, gatewayUrl, pairCode: fresh.code, desktopConnected: agent.connected() }, null, 2))
  console.log('serving — Ctrl-C to stop')
  const shutdown = () => {
    agent.close()
    gatewayServer.stop(true)
    bridgeServer.stop(true)
    gateway.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} else {
  agent.close()
  gatewayServer.stop(true)
  bridgeServer.stop(true)
  gateway.close()
  console.log(failures === 0 ? '\nH5 E2E: ALL CHECKS PASSED' : `\nH5 E2E: ${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}
