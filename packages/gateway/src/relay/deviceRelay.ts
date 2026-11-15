/**
 * Reverse tunnel for a phone acting as a relay node.
 *
 * A phone on the same LAN as a tablet can forward for it, but the phone is the
 * only one holding a device token and the only one with an outbound path to the
 * gateway. So the phone opens one WebSocket to `/relay/device` and pushes each
 * relayed request down it, reusing the exact frame format the desktop agent
 * already speaks (`http_req` / `http_head` / `http_chunk` / `http_end`).
 *
 * Two rules make this safe to expose to a LAN:
 *
 * - The credential is the socket, never the request. Anything the LAN client
 *   sends as `authorization` is dropped and replaced with the token the socket
 *   authenticated with, so a relayed client cannot escalate past the phone.
 * - The relayable surface is an allowlist of the API and proxy paths. Pairing,
 *   admin, and push registration are not reachable through a relay, because a
 *   LAN client must not be able to mint devices or redirect notifications.
 */

import type { Hono } from 'hono'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
])

/** Prefixes a relayed request may target. Everything else is refused. */
const RELAYABLE_PREFIXES = ['/api/', '/proxy/', '/sdk/', '/v1/']

/**
 * Decides on the resolved path, not the raw one.
 *
 * `new Request(origin + path)` normalizes dot segments, so `/api/../push/register`
 * starts with `/api/` here but lands on `/push/register` there — the allowlist
 * would say yes to a route it never meant to expose. Anything the URL parser
 * would move, or that hides traversal behind escapes, is refused outright.
 */
export function isRelayablePath(path: string): boolean {
  const raw = path.split('?')[0] ?? ''
  if (raw.includes('\\') || raw.includes('..')) return false
  let pathname: string
  try {
    pathname = new URL(raw, 'http://relay.invalid').pathname
  } catch {
    return false
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return false
  }
  if (decoded.includes('..') || decoded.includes('\\')) return false
  return RELAYABLE_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

export type RelayEmit = (frame: Record<string, unknown>) => void

export type RelayFrame = Record<string, unknown>

function decodeBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** Client headers, minus anything the socket itself is responsible for. */
function relayedHeaders(raw: unknown): Headers {
  const headers = new Headers()
  if (!raw || typeof raw !== 'object') return headers
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = name.toLowerCase()
    if (typeof value !== 'string') continue
    // The relayed client is untrusted: it never gets to assert an identity, and
    // it never gets to claim a device on the gateway's behalf. `x-relay-key` is
    // the phone's own LAN gate — it has no meaning past the phone and must not
    // leak to the desktop.
    if (
      lower === 'authorization' || lower === 'x-admin-token'
      || lower === 'x-gateway-device' || lower === 'x-relay-key'
    ) continue
    if (lower.startsWith('x-forwarded-')) continue
    if (HOP_BY_HOP.has(lower)) continue
    headers.set(lower, value)
  }
  // Framing is rewritten by the relay; ask for a body we can pass through.
  headers.set('accept-encoding', 'identity')
  return headers
}

export type DeviceRelayOptions = {
  app: Hono
  /** Bearer token the socket authenticated with; injected on every relay. */
  deviceToken: string
  emit: RelayEmit
  maxBodyBytes: number
  /** Local origin used to synthesize the request the app sees. */
  origin?: string
}

/**
 * One relay connection. Frames are answered in arrival order but requests run
 * concurrently, so a slow session list does not block a queued message.
 */
export function createDeviceRelay(options: DeviceRelayOptions) {
  const origin = options.origin ?? 'http://relay.invalid'
  const inFlight = new Map<string, AbortController>()
  let closed = false

  const fail = (id: string, message: string): void => {
    options.emit({ t: 'http_error', id, message })
  }

  const handleHttp = async (frame: RelayFrame): Promise<void> => {
    const id = typeof frame.id === 'string' ? frame.id : ''
    if (!id) return

    const method = typeof frame.method === 'string' ? frame.method.toUpperCase() : 'GET'
    const path = typeof frame.path === 'string' ? frame.path : ''
    if (!isRelayablePath(path)) {
      fail(id, 'path is not relayable')
      return
    }

    const body = decodeBase64(frame.body)
    if (body && body.byteLength > options.maxBodyBytes) {
      fail(id, 'request body too large')
      return
    }

    const controller = new AbortController()
    inFlight.set(id, controller)

    try {
      const headers = relayedHeaders(frame.headers)
      headers.set('authorization', `Bearer ${options.deviceToken}`)
      const request = new Request(`${origin}${path}`, {
        method,
        headers,
        ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
        signal: controller.signal,
      })

      const response = await options.app.fetch(request)
      if (closed) return

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        if (HOP_BY_HOP.has(name.toLowerCase())) return
        responseHeaders[name] = value
      })
      options.emit({ t: 'http_head', id, status: response.status, headers: responseHeaders })

      if (response.body) {
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (closed) {
            await reader.cancel().catch(() => {})
            return
          }
          if (value && value.byteLength > 0) {
            // Streamed as they arrive: an SSE turn must not be buffered until
            // the whole answer exists.
            options.emit({ t: 'http_chunk', id, data: Buffer.from(value).toString('base64') })
          }
        }
      }
      options.emit({ t: 'http_end', id })
    } catch (error) {
      if (controller.signal.aborted) return
      fail(id, error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.delete(id)
    }
  }

  return {
    /** Dispatches one frame from the relay socket. */
    receive(raw: string): void {
      let frame: RelayFrame
      try {
        frame = JSON.parse(raw) as RelayFrame
      } catch {
        return
      }
      if (frame.t === 'http_req') {
        void handleHttp(frame)
        return
      }
      if (frame.t === 'http_abort' && typeof frame.id === 'string') {
        inFlight.get(frame.id)?.abort()
      }
    },
    /** Aborts everything in flight when the relay socket goes away. */
    close(): void {
      closed = true
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
    },
  }
}
