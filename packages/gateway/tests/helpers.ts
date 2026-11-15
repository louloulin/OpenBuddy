import { websocket } from 'hono/bun'

import { createGateway, type Gateway } from '../src/app.js'
import { loadConfig, type GatewayConfig } from '../src/config.js'
import type { UiAssetMap } from '../src/ui.js'

export const ADMIN_TOKEN = 'adm_test_admin'
export const AGENT_TOKEN = 'agt_test_agent'

export type Upstream = {
  url: string
  seen: Array<{ path: string; method: string; headers: Headers; body: string }>
  server: ReturnType<typeof Bun.serve>
  close: () => void
}

export type UpstreamHandler = (req: Request, url: URL) => Response | Promise<Response>

export function startUpstream(handlers: Record<string, UpstreamHandler> = {}): Upstream {
  const seen: Upstream['seen'] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/ws/')) {
        if (srv.upgrade(req)) return undefined as unknown as Response
        return new Response('upgrade failed', { status: 400 })
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text()
      seen.push({ path: `${url.pathname}${url.search}`, method: req.method, headers: req.headers, body })

      const handler = handlers[url.pathname]
      if (handler) return handler(req, url)

      if (url.pathname === '/api/sessions') {
        return Response.json({ sessions: [{ id: 's1' }], gatewayDevice: req.headers.get('x-gateway-device') })
      }
      if (url.pathname === '/api/headers') {
        const headers: Record<string, string> = {}
        req.headers.forEach((value, name) => {
          headers[name] = value
        })
        return Response.json({ headers })
      }
      if (url.pathname === '/proxy/v1/messages') {
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n'))
            await Bun.sleep(5)
            controller.enqueue(encoder.encode('event: content_block_delta\ndata: {"delta":"ok"}\n\n'))
            controller.close()
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      }
      if (url.pathname === '/slow-error') {
        return Response.json({ error: 'boom' }, { status: 500 })
      }
      return Response.json({ ok: true, path: url.pathname })
    },
    websocket: {
      open(ws) {
        ws.send('welcome')
      },
      message(ws, message) {
        ws.send(typeof message === 'string' ? `echo:${message}` : message)
      },
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    server,
    close: () => server.stop(true),
  }
}

export type Harness = {
  gateway: Gateway
  server: ReturnType<typeof Bun.serve>
  url: string
  upstream: Upstream
  close: () => void
}

export function startGateway(
  overrides: Partial<GatewayConfig> = {},
  handlers: Record<string, UpstreamHandler> = {},
  gatewayOptions: { fetchImpl?: typeof fetch; embeddedUi?: UiAssetMap | null } = {},
): Harness {
  const upstream = startUpstream(handlers)
  const config: GatewayConfig = {
    ...loadConfig({
      GATEWAY_DB: ':memory:',
      GATEWAY_ADMIN_TOKEN: ADMIN_TOKEN,
      GATEWAY_AGENT_TOKEN: AGENT_TOKEN,
      LUMOS_UPSTREAM_URL: upstream.url,
      GATEWAY_CLAIM_LIMIT: '50',
      // The gateway ships with the shared route off, because on a real
      // multi-account deployment it hands one user's sessions to another
      // user's phone. The test gateway is single-tenant by construction, and
      // most of these cases are about the shared route itself.
      GATEWAY_PAIR_ALLOW_SHARED: '1',
    }),
    ...overrides,
  }
  const gateway = createGateway(config, gatewayOptions)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: gateway.app.fetch,
    websocket,
  })
  return {
    gateway,
    server,
    url: `http://127.0.0.1:${server.port}`,
    upstream,
    close: () => {
      gateway.close()
      server.stop(true)
      upstream.close()
    },
  }
}

export type PairedDevice = {
  deviceId: string
  deviceToken: string
  scopes: string[]
}

export async function pairDevice(
  harness: Harness,
  options: { scopes?: string[]; name?: string; desktopId?: string } = {},
): Promise<PairedDevice> {
  const start = await fetch(`${harness.url}/pair/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.desktopId ? { desktopId: options.desktopId } : {}),
    }),
  })
  if (!start.ok) throw new Error(`pair/start failed: ${start.status}`)
  const { code } = await start.json() as { code: string }

  const claim = await fetch(`${harness.url}/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceName: options.name ?? 'Test Phone', platform: 'ios' }),
  })
  if (!claim.ok) throw new Error(`pair/claim failed: ${claim.status} ${await claim.text()}`)
  return await claim.json() as PairedDevice
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

export type Account = {
  token: string
  user: { id: string; email: string; displayName: string | null }
}

export async function registerUser(
  harness: Harness,
  options: { email?: string; password?: string; displayName?: string } = {},
): Promise<Account> {
  const response = await fetch(`${harness.url}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: options.email ?? 'user@example.com',
      password: options.password ?? 'correct horse battery',
      displayName: options.displayName ?? 'Test User',
    }),
  })
  if (!response.ok) throw new Error(`register failed: ${response.status} ${await response.text()}`)
  return await response.json() as Account
}

export type EnrolledDesktop = {
  desktop: { id: string; name: string; platform: string; online: boolean }
  agentToken: string
  gatewayUrl: string
}

export async function enrollDesktop(
  harness: Harness,
  userToken: string,
  options: { installationId?: string; name?: string; platform?: string } = {},
): Promise<EnrolledDesktop> {
  const response = await fetch(`${harness.url}/desktops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(userToken) },
    body: JSON.stringify({
      installationId: options.installationId ?? 'installation-desktop-1',
      name: options.name ?? 'Test Desktop',
      platform: options.platform ?? 'macos',
    }),
  })
  if (!response.ok) throw new Error(`desktop enroll failed: ${response.status} ${await response.text()}`)
  return await response.json() as EnrolledDesktop
}

export type ProvisionedDevice = {
  deviceId: string
  deviceToken: string
  desktopId: string
  desktopName: string
  gatewayUrl: string
  scopes: string[]
}

export async function provisionDevice(
  harness: Harness,
  userToken: string,
  desktopId: string,
  options: { installationId?: string; name?: string; platform?: string; scopes?: string[]; revive?: boolean } = {},
): Promise<ProvisionedDevice> {
  const response = await fetch(`${harness.url}/desktops/${desktopId}/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(userToken) },
    body: JSON.stringify({
      installationId: options.installationId ?? 'installation-phone-1',
      name: options.name ?? 'Test Phone',
      platform: options.platform ?? 'android',
      ...(options.revive !== undefined ? { revive: options.revive } : {}),
      ...(options.scopes ? { scopes: options.scopes } : {}),
    }),
  })
  if (!response.ok) throw new Error(`device provision failed: ${response.status} ${await response.text()}`)
  return await response.json() as ProvisionedDevice
}

export function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('websocket error'))
  })
}

export type Collector = {
  messages: string[]
  waitFor: (count: number, timeoutMs?: number) => Promise<string[]>
}

/** Buffers messages from the moment the socket is created (no open race). */
export function collect(socket: WebSocket): Collector {
  const messages: string[] = []
  const waiters = new Set<() => void>()
  const notify = () => {
    for (const wake of waiters) wake()
    waiters.clear()
  }
  socket.onmessage = (event) => {
    messages.push(typeof event.data === 'string' ? event.data : '[binary]')
    notify()
  }
  return {
    messages,
    waitFor: (count, timeoutMs = 3000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${messages.length} messages`)), timeoutMs)
      const check = () => {
        if (messages.length < count) return false
        clearTimeout(timer)
        waiters.delete(check)
        resolve(messages.slice(0, count))
        return true
      }
      if (check()) return
      waiters.add(check)
    }),
  }
}

export function waitForClose(socket: WebSocket, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('close timed out')), timeoutMs)
    socket.onclose = (event) => {
      clearTimeout(timer)
      resolve(event.code)
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('websocket error'))
    }
  })
}

export function nextMessages(socket: WebSocket, count: number, timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = []
    const timer = setTimeout(() => reject(new Error(`timed out after ${messages.length} messages`)), timeoutMs)
    socket.onmessage = (event) => {
      messages.push(typeof event.data === 'string' ? event.data : '[binary]')
      if (messages.length >= count) {
        clearTimeout(timer)
        resolve(messages)
      }
    }
    socket.onerror = () => {
      clearTimeout(timer)
      reject(new Error('websocket error'))
    }
  })
}
