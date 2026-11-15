import type { GatewayConfig } from './config.js'
import { LEGACY_ROUTE, type AgentHub } from './relay/hub.js'
import type { DeviceRow } from './store.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Gateway credentials must never reach the upstream; the configured token does.
  'host',
  'authorization',
  'cookie',
  // The client's own upstream key is the client's business, not the gateway's:
  // the desktop answers with the key it holds, so forwarding this would only
  // turn a shared gateway into a credential forwarder.
  'x-api-key',
])

/**
 * The Anthropic headers that carry real meaning on the wire.
 *
 * `anthropic-version` is required by the Anthropic surface and `anthropic-beta`
 * opts into features; the upstream server deliberately passes both on. Any
 * other `anthropic-*` header is the client trying to steer the upstream
 * account's request, and nothing downstream needs it.
 */
const ANTHROPIC_PASSTHROUGH = new Set(['anthropic-version', 'anthropic-beta'])

export class BodyTooLargeError extends Error {}

export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array | undefined> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError()
  if (!req.body) return undefined
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new BodyTooLargeError()
  return bytes.byteLength > 0 ? bytes : undefined
}

export function outgoingHeaders(
  req: Request,
  config: GatewayConfig,
  device: DeviceRow,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {}
  req.headers.forEach((value, name) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('x-forwarded-')) return
    if (HOP_BY_HOP.has(lower)) return
    if (lower.startsWith('anthropic-') && !ANTHROPIC_PASSTHROUGH.has(lower)) return
    headers[name] = value
  })
  // A shared gateway should not negotiate compressed responses it then streams
  // back untouched; identity keeps SSE frames arriving as the upstream wrote them.
  headers['accept-encoding'] = 'identity'
  headers['x-forwarded-proto'] = new URL(req.url).protocol.replace(':', '')
  headers['x-forwarded-host'] = req.headers.get('host') ?? new URL(req.url).host
  headers['x-gateway-device'] = device.id
  Object.assign(headers, extra)
  if (config.upstreamToken) headers.authorization = `Bearer ${config.upstreamToken}`
  return headers
}

function responseHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream)
  for (const name of HOP_BY_HOP) headers.delete(name)
  // Body framing is rewritten by the gateway; compression is already disabled.
  headers.delete('content-length')
  headers.delete('content-encoding')
  return headers
}

/**
 * Where a device's traffic has to go.
 *
 * An account device is pinned to the desktop it was paired with: if that
 * computer is offline the gateway says so instead of quietly using another
 * agent or the gateway's own upstream, which would hand one user's phone
 * another user's session data. Devices paired with the old six-digit code have
 * no desktop and keep the legacy behaviour.
 */
export type DeviceRoute =
  | { kind: 'desktop'; desktopId: string }
  | { kind: 'legacy' }

export function routeForDevice(device: DeviceRow): DeviceRoute {
  return device.desktop_id ? { kind: 'desktop', desktopId: device.desktop_id } : { kind: 'legacy' }
}

export class DesktopOfflineError extends Error {
  constructor(readonly desktopId: string) {
    super('desktop offline')
  }
}

export async function forwardHttp(
  req: Request,
  config: GatewayConfig,
  hub: AgentHub,
  device: DeviceRow,
  options: {
    body?: Uint8Array
    pathPrefix?: string
    /** Absolute upstream path, when the gateway rewrites the route itself. */
    path?: string
    /** Extra headers for the upstream hop. */
    headers?: Record<string, string>
  } = {},
): Promise<Response> {
  const url = new URL(req.url)
  const pathname = options.path
    ?? (options.pathPrefix
      ? `${options.pathPrefix}${url.pathname}`
      : url.pathname)
  const path = `${pathname}${url.search}`
  const headers = outgoingHeaders(req, config, device, options.headers)
  const method = req.method.toUpperCase()
  // The body may be a translated one, so the client's content-length no longer
  // describes what the upstream receives.
  if (options.body) headers['content-length'] = String(options.body.byteLength)

  const route = routeForDevice(device)
  if (route.kind === 'desktop') {
    if (!hub.isOnline(route.desktopId)) throw new DesktopOfflineError(route.desktopId)
    return hub.requestHttp(
      route.desktopId,
      { method, path, headers, body: options.body },
      req.signal,
    )
  }

  if (hub.legacyConnected) {
    return hub.requestHttp(
      LEGACY_ROUTE,
      { method, path, headers, body: options.body },
      req.signal,
    )
  }

  const target = `${config.upstreamUrl}${path}`
  const init: RequestInit = {
    method,
    headers,
    signal: req.signal,
    redirect: 'manual',
  }
  if (options.body && method !== 'GET' && method !== 'HEAD') {
    init.body = options.body
  }
  const upstream = await fetch(target, init)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream.headers),
  })
}

/** Rewrites an http(s) upstream base into the matching ws(s) origin. */
export function upstreamWsUrl(config: GatewayConfig, path: string): string {
  const base = new URL(config.upstreamUrl)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  const question = path.indexOf('?')
  base.pathname = question === -1 ? path : path.slice(0, question)
  base.search = question === -1 ? '' : path.slice(question)
  return base.toString()
}
