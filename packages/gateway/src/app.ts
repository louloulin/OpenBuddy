import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { upgradeWebSocket } from 'hono/bun'
import type { WSContext } from 'hono/ws'

import pkg from '../package.json'
import {
  authenticateAdminCredential,
  authenticateDesktopToken,
  authenticateRequest,
  authenticateToken,
  authenticateUser,
  bearerToken,
  hasScope,
  isScope,
  isAdminCsrfViolation,
  issueDeviceToken,
  safeEqual,
  sha256,
  type Scope,
} from './auth.js'
import type { GatewayConfig } from './config.js'
import { createDeviceRelay } from './relay/deviceRelay.js'
import { AgentHub, LEGACY_ROUTE, TunnelBackpressureError } from './relay/hub.js'
import {
  BodyTooLargeError,
  DesktopOfflineError,
  forwardHttp,
  readBody,
  routeForDevice,
  upstreamWsUrl,
} from './proxy.js'
import {
  anthropicResponseToOpenAI,
  anthropicStreamToOpenAI,
  normalizeModelList,
  toAnthropicRequest,
} from './openaiCompat.js'
import { registerAccountRoutes } from './routes/accounts.js'
import { registerAdminRoutes } from './routes/admin.js'
import { DEFAULT_POLICY, parsePolicy, policyAllowsScopes } from './policy.js'
import { handleUiRequest, type UiAssetMap } from './ui.js'
import { handleH5Request } from './h5.js'
import { readJsonBody } from './bodyLimit.js'
import { slidingWindow } from './rateLimit.js'
import { Store, deviceScopes, type DeviceRow } from './store.js'
import { createPushDispatcher, type PushDispatcher } from './push/dispatcher.js'
import { buildPushProviders } from './push/providers.js'
import { isPushKind, isPushProviderName } from './push/types.js'
import { createPushWatchers } from './push/watchers.js'

const DEFAULT_SCOPES: Scope[] = ['sessions:read', 'sessions:write', 'approve']
const WS_AUTH_TIMEOUT_MS = 5_000

/**
 * The gateway's wire protocol, as `/version` reports it.
 *
 * Bump this only for a change that makes an older phone unable to speak to a
 * newer gateway at all — a reframe of an existing route, not an addition.
 * The phone blocks itself only when the gateway's number is higher than the
 * one it knows; a lower number means the gateway never heard of the check.
 */
export const GATEWAY_PROTOCOL_VERSION = 1

export type Gateway = {
  app: Hono
  store: Store
  hub: AgentHub
  push: PushDispatcher
  config: GatewayConfig
  close: () => void
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

/**
 * Errors on the OpenAI-compatible surface, in the shape its SDKs parse.
 *
 * `{ error: "…" }` makes every official client report an unknown failure; the
 * wire format is an object with `message` and `type`, so translation errors,
 * auth, and offline desktops all say what happened in the client's dialect.
 */
/**
 * The message inside an upstream error body, whatever shape it arrived in.
 *
 * The desktop's Anthropic proxy answers `{error:{type,message}}`; a plain
 * `{message}` and a bare string also occur on this hop. Only the message is
 * taken — status and classification stay the upstream's.
 */
async function readUpstreamErrorMessage(upstream: Response): Promise<string | null> {
  const text = await upstream.text().catch(() => '')
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'string' && error.trim()) return error.trim()
      if (error && typeof error === 'object') {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) return message.trim()
      }
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
  } catch {
    // Not JSON: the first line is still more useful than nothing.
  }
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 0 ? firstLine.slice(0, 500) : null
}

function openAiError(message: string, status: number, type = 'invalid_request_error'): Response {
  return Response.json({ error: { message, type, code: null } }, { status })
}

/**
 * The address the socket actually came from.
 *
 * Bun hands the fetch handler its `server`, which becomes Hono's `env`; the
 * gateway's entry point forwards it, so it is available here without ever
 * touching a header a client could have written.
 */
function socketIp(c: Context): string {
  const server = c.env as { requestIP?: (req: Request) => { address: string } | null } | undefined
  try {
    return server?.requestIP?.(c.req.raw)?.address ?? 'local'
  } catch {
    return 'local'
  }
}

/**
 * Where a websocket credential may travel, in order of preference.
 *
 * URLs outlive the requests that carried them — access logs, shell history,
 * QR printouts — so the token rides the `Sec-WebSocket-Protocol` header
 * instead. Bun's `server.upgrade` echoes the first requested protocol back,
 * which is what makes this work for a Node/Electron client: undici fails the
 * handshake with 1006 when a requested protocol is not selected, so the echo
 * is not optional for the desktop. The query parameter stays as the
 * deprecated fallback for agents predating the header, and a browser-based
 * phone keeps its auth frame (a browser has the same echo requirement, and
 * `/ws/:sessionId` never offers this).
 */
function wsCredential(c: Context): { token: string | null; via: 'header' | 'subprotocol' | 'query' } {
  const bearer = bearerToken(c.req.header('authorization'))
  if (bearer) return { token: bearer, via: 'header' }
  const protocol = c.req.header('sec-websocket-protocol')?.trim() ?? ''
  if (protocol && !protocol.includes(',')) return { token: protocol, via: 'subprotocol' }
  return { token: c.req.query('token') ?? null, via: 'query' }
}

export function createGateway(
  config: GatewayConfig,
  options: { fetchImpl?: typeof fetch; embeddedUi?: UiAssetMap | null } = {},
): Gateway {
  const store = new Store(config.dbPath)
  // An operator who explicitly enabled the shared route at deployment level
  // meant it for this gateway as well, so it is part of the policy this
  // gateway falls back to. Without this the console's policy switch would
  // silently veto what the environment asked for and the two switches would
  // disagree; a policy stored in the console still replaces the fallback
  // whole, so the operator can turn it back off at runtime.
  store.setDefaultPolicy({ ...DEFAULT_POLICY, allowSharedRoute: config.pairAllowsSharedRoute })
  const hub = new AgentHub()
  // Claim codes are the only unauthenticated route on a public gateway, so its
  // limiter keys on raw IPs; the shared limiter sweeps expired keys instead of
  // letting the map grow with every address that ever connected.
  const claimLimiter = slidingWindow(config.claimLimitPerMinute)
  // The reverse proxy is the hot path: every session list, every message the
  // phone sends, every poll of the live status. The limits here are ceilings
  // against a single credential being turned into an amplifier, not a throttle
  // on normal use — a phone polling a running conversation stays well below
  // them.
  const apiLimiter = slidingWindow(config.apiLimitPerMinute)
  const apiIpLimiter = slidingWindow(config.apiIpLimitPerMinute)
  const relayLimiter = slidingWindow(config.relayLimitPerMinute)
  const app = new Hono()
  const push = createPushDispatcher({
    store,
    providers: buildPushProviders(config, options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    // A transient provider failure is retried a couple of times before the
    // notification is dropped; permanent failures still retire the registration.
    retry: {},
  })
  let pushSyncTimer: ReturnType<typeof setInterval> | null = null
  let relaySockets = 0

  /**
   * The client IP a rate limit may key on.
   *
   * Forwarding headers are only believed when the operator says a trusted
   * proxy sits in front and overwrites them; any public caller can otherwise
   * mint itself a fresh bucket per request and walk straight through a limiter.
   */
  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')
      if (forwarded?.trim()) return forwarded.split(',')[0]!.trim()
      const real = c.req.header('x-real-ip')
      if (real?.trim()) return real.trim()
    }
    return socketIp(c)
  }

  /**
   * Sockets a device token has opened, so revoking the device ends them.
   *
   * HTTP routes re-authenticate per request, but a WebSocket authenticated
   * once at upgrade would otherwise keep streaming — and approving — until the
   * client felt like reconnecting. Track every device-authenticated socket and
   * close the set when the credential dies.
   */
  const deviceSockets = new Map<string, Set<{ close: (code?: number, reason?: string) => void }>>()
  const trackDeviceSocket = (
    deviceId: string,
    socket: { close: (code?: number, reason?: string) => void },
  ): (() => void) => {
    let sockets = deviceSockets.get(deviceId)
    if (!sockets) {
      sockets = new Set()
      deviceSockets.set(deviceId, sockets)
    }
    sockets.add(socket)
    return () => {
      const current = deviceSockets.get(deviceId)
      if (!current) return
      current.delete(socket)
      if (current.size === 0) deviceSockets.delete(deviceId)
    }
  }
  const closeDeviceSockets = (deviceId: string): number => {
    const sockets = deviceSockets.get(deviceId)
    if (!sockets) return 0
    deviceSockets.delete(deviceId)
    let closed = 0
    for (const socket of sockets) {
      try {
        socket.close(4403, 'device revoked')
        closed += 1
      } catch {
        // Already gone; the count only reports sockets this acted on.
      }
    }
    return closed
  }

  // Only browsers enforce CORS — native apps, CLIs, and SDK calls send no
  // Origin header and are unaffected. Reflecting whatever origin arrives would
  // let any web page read a paired phone's responses, so unknown origins get
  // no header at all and the browser refuses to read them.
  const allowedOrigins = new Set(config.allowedOrigins.map(origin => origin.toLowerCase()))
  app.use('*', cors({
    origin: origin => (origin && allowedOrigins.has(origin.toLowerCase()) ? origin : ''),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'authorization', 'content-type',
      'anthropic-version', 'anthropic-beta', 'x-api-key',
      'x-claude-code-session-id',
    ],
    exposeHeaders: ['content-type', 'request-id'],
    maxAge: 600,
  }))

  // CSRF covers every admin write, including the ones defined in this file —
  // a per-handler check would be forgotten by the next route someone adds.
  // Registered here, before any route: Hono matches in registration order, so a
  // middleware appended after the handlers would never run.
  app.use('/admin/*', async (c, next) => {
    if (isAdminCsrfViolation(c, config.adminToken, store)) {
      return jsonError('missing csrf header', 403)
    }
    await next()
  })

  registerAccountRoutes(app, {
    store,
    config,
    isDesktopOnline: (desktopId) => hub.isOnline(desktopId),
    onDevicesRevoked: deviceIds => {
      for (const deviceId of deviceIds) closeDeviceSockets(deviceId)
    },
  })

  // The console's static shell. Registered before the API routes so `/ui` is
  // answered by the file handler and never falls through to a JSON 404. The
  // bundle is built with `base: '/ui/'`, so its asset URLs are absolute and a
  // bare `/ui` needs no redirect to resolve them.
  if (config.adminUiEnabled) {
    const uiMount = async (c: Context, next: () => Promise<void>) => {
      const response = await handleUiRequest(c.req.raw, new URL(c.req.url), {
        uiDir: config.uiDir,
        embedded: options.embeddedUi,
      })
      if (response) return response
      await next()
    }
    app.use('/ui', uiMount)
    app.use('/ui/*', uiMount)
    // The bare domain is the console's front door: an operator typing the
    // gateway host into a browser lands in the shell, not a JSON 404. The API
    // never lived at `/`, so nothing else can collide with this.
    app.get('/', (c) => c.redirect('/ui/'))
  }

  // The phone web client. It is served from the same origin as the API it
  // calls, so a phone on the far side of the NAT needs nothing but this
  // gateway's address: the page, the REST calls and the session socket all
  // live under one origin, and the browser never makes a cross-origin
  // request. Registered before the API routes so `/h5` is answered by the file
  // handler and never falls through to a JSON 404.
  const h5Mount = async (c: Context, next: () => Promise<void>) => {
    const response = await handleH5Request(c.req.raw, new URL(c.req.url), {
      h5Dir: config.h5Dir,
      enabled: config.h5Enabled,
    })
    if (response) return response
    await next()
  }
  app.use('/h5', h5Mount)
  app.use('/h5/*', h5Mount)

  /**
   * The operator credential, for the routes in this file.
   *
   * `routes/admin.ts` owns the console's own surface; this helper stays for the
   * endpoints that predate it. Both answer the same question, so both defer to
   * the one implementation: a shared token (break-glass, CI) or a signed-in
   * administrator's session. `x-admin-token` is kept for the scripts and load
   * balancers that already send it.
   */
  const requireAdmin = (c: Context): Response | null => {
    const headerToken = c.req.header('x-admin-token')
    if (headerToken && safeEqual(headerToken, config.adminToken)) return null
    if (!authenticateAdminCredential(c, store, config.adminToken)) return jsonError('unauthorized', 401)
    return null
  }

  // `status: 'ok'` is the lumos server readiness contract the app checks
  // before it will talk to anything. From the phone's side a gateway *is* the
  // server, so it has to answer in the same shape — without this the shell
  // treats a perfectly healthy gateway as unreachable. The endpoint is
  // unauthenticated, so it answers nothing about the gateway's state; the
  // topology lives behind the admin token on `/admin/health`.
  const readiness = { status: 'ok', ok: true }
  app.get('/-/ready', c => c.json(readiness))
  app.get('/health', c => c.json(readiness))

  // What the phone's compatibility gate reads. Unauthenticated on purpose —
  // a version and a protocol number say nothing worth protecting — so a phone
  // can decide whether it can work here before it presents a token. protocol
  // is the wire protocol and moves only when an older phone can no longer
  // talk to this gateway at all; the version string is informational.
  app.get('/version', c => c.json({ version: pkg.version, protocol: GATEWAY_PROTOCOL_VERSION }))

  app.get('/admin/health', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json({
      status: 'ok',
      ok: true,
      agentConnected: hub.connected,
      agentLegacy: hub.legacyConnected,
      desktopsOnline: hub.onlineRoutes().filter((route) => route !== LEGACY_ROUTE).length,
      devices: store.listDevices().filter(device => !device.revoked_at).length,
      relaySockets,
      push: {
        providers: push.availableProviders,
        watching: watchers.size() > 0,
        watchingDesktops: watchers.watched(),
        registrations: store.countPushRegistrations(),
      },
    })
  })

  // ── Pairing ────────────────────────────────────────────────

  /**
   * Mints a one-time code.
   *
   * `desktopId` is what makes the resulting device belong to one computer.
   * Without it the claim lands on the gateway's shared route, where every
   * code-paired phone on this gateway reads the same transcript — acceptable
   * for the old single-tenant setup, wrong for a gateway serving several
   * accounts. `pairAllowsSharedRoute` is the operator's switch for that.
   */
  app.post('/pair/start', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    // `requireAdmin` only answers yes/no. The audit row needs the actor, and a
    // desktop owner is not the actor: someone in the console minted this code,
    // possibly for a shared route with no desktop at all.
    const principal = authenticateAdminCredential(c, store, config.adminToken)
    const policy = store.getPolicy()
    if (!policy.pairingEnabled) {
      store.audit('pair_policy_denied', null, null, { reason: 'pairing-disabled' })
      return jsonError('pairing is disabled by deployment policy', 403)
    }
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const body = (parsed.body ?? {}) as { scopes?: unknown; desktopId?: unknown }
    const requested = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : DEFAULT_SCOPES
    // Policy narrows what a credential may carry before any other check: an
    // operator who allows only reads should not get a writable token because
    // the request asked politely.
    const scopes = policyAllowsScopes(policy, requested.filter(isScope))
    if (scopes.length === 0) return jsonError('no scopes allowed by deployment policy', 400)

    const requestedDesktop = typeof body.desktopId === 'string' ? body.desktopId.trim() : ''
    const desktop = requestedDesktop ? store.getDesktop(requestedDesktop) : null
    if (requestedDesktop && (!desktop || desktop.revoked_at)) {
      return jsonError('unknown desktop', 404)
    }
    const sharedAllowed = config.pairAllowsSharedRoute && policy.allowSharedRoute
    if (!desktop && !sharedAllowed) {
      store.audit('pair_policy_denied', null, null, { reason: 'shared-route-disabled' }, Date.now(), {
        userId: principal?.kind === 'session' ? principal.user.id : null,
      })
      return jsonError('a pairing code must name a desktop on this gateway', 400)
    }
    // The shared route reads one upstream for every code-paired phone. Once
    // this gateway holds a second account or a second computer, that upstream
    // is no longer "the one machine behind me": it is one person's sessions
    // in another person's pocket, or a device pointed at whichever computer
    // happens to be connected. The switch above is a deployment choice; this
    // is a fact about the data, so it is enforced here regardless.
    if (!desktop && (store.countUsers() > 1 || store.countDesktops() > 1)) {
      store.audit('pair_policy_denied', null, null, { reason: 'multi-tenant-gateway' }, Date.now(), {
        userId: principal?.kind === 'session' ? principal.user.id : null,
      })
      return jsonError('this gateway serves more than one account or computer, so a pairing code must name a desktop', 400)
    }

    // Eight digits, not six. A code is the only credential a stranger on the
    // network can try at will; 10^8 inside a two-minute TTL needs millions of
    // source addresses even before the per-IP limiter answers.
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 100_000_000).padStart(8, '0')
    const expiresAt = Date.now() + config.pairTtlMs
    store.createPair(sha256(code), scopes, expiresAt, Date.now(), {
      userId: desktop?.user_id ?? null,
      desktopId: desktop?.id ?? null,
    })
    store.audit('pair_started', null, desktop?.id ?? null, { scopes, shared: !desktop }, Date.now(), {
      // The shared token has no identity; the desktop owner is not the actor.
      userId: principal?.kind === 'session' ? principal.user.id : null,
      desktopId: desktop?.id ?? null,
    })
    // The code is returned exactly once; only its hash is stored.
    return c.json({
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      scopes,
      ...(desktop ? { desktopId: desktop.id } : {}),
    })
  })

  app.post('/pair/claim', async (c) => {
    const ip = clientIp(c)
    if (!claimLimiter.allow(ip)) return jsonError('too many attempts', 429)

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const body = parsed.body as
      { code?: unknown; deviceName?: unknown; platform?: unknown } | null
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : ''
    const platform = typeof body?.platform === 'string' ? body.platform.trim().slice(0, 20) : 'unknown'
    if (!/^\d{8}$/.test(code) || !deviceName) return jsonError('invalid pairing request', 400)

    const now = Date.now()
    const pair = store.consumePair(sha256(code), now)
    if (!pair) {
      store.audit('pair_failed', null, null, { ip })
      return jsonError('invalid or expired code', 404)
    }

    // Checked after the code burns: a claim attempt that would exceed the
    // policy limit must not leave a working code behind for the next try.
    const policy = store.getPolicy()
    if (pair.desktopId && policy.maxDevicesPerDesktop > 0
      && store.countActiveDesktopDevices(pair.desktopId) >= policy.maxDevicesPerDesktop) {
      store.audit('pair_policy_denied', null, pair.desktopId, {
        reason: 'device-limit',
        limit: policy.maxDevicesPerDesktop,
        ip,
      }, now, { userId: pair.userId, desktopId: pair.desktopId })
      return jsonError('this computer has reached its device limit (deployment policy)', 403)
    }

    const deviceId = crypto.randomUUID()
    const { token, hash } = issueDeviceToken(deviceId)
    // The code's desktop travels with it, so the phone this device belongs to
    // is the one the operator named — never "whichever computer the gateway
    // happens to share". A code without one keeps the legacy shared route.
    store.insertDevice({
      id: deviceId,
      name: deviceName,
      platform,
      token_hash: hash,
      scopes_json: JSON.stringify(pair.scopes),
      created_at: now,
      user_id: pair.userId,
      desktop_id: pair.desktopId,
    })
    store.audit('device_paired', deviceId, pair.desktopId, {
      platform,
      scopes: pair.scopes,
      ip,
      shared: pair.desktopId === null,
    }, now, { userId: pair.userId, desktopId: pair.desktopId })

    const origin = config.publicUrl ?? new URL(c.req.url).origin
    return c.json({
      deviceId,
      deviceToken: token,
      gatewayUrl: origin,
      scopes: pair.scopes,
      agentConnected: hub.connected,
    })
  })

  // ── Policy ─────────────────────────────────────────────────

  /**
   * Read-only policy view for any authenticated caller.
   *
   * Desktops fetch this at startup so the same rules the gateway enforces can
   * gate the client-side surface too; phones use it to explain a refusal
   * instead of surfacing a bare 403.
   */
  app.get('/policy', (c) => {
    const token = bearerToken(c.req.header('authorization'))
    const authorized = Boolean(
      (token && authenticateToken(token, store))
      || (token && authenticateDesktopToken(token, store))
      || authenticateAdminCredential(c, store, config.adminToken)
      || authenticateUser(c, store),
    )
    if (!authorized) return jsonError('unauthorized', 401)
    return c.json({ policy: store.getPolicy() })
  })

  app.get('/admin/policy', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json({
      policy: store.getPolicy(),
      defaults: store.getDefaultPolicy(),
      meta: store.getPolicyMeta(),
    })
  })

  app.put('/admin/policy', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const principal = authenticateAdminCredential(c, store, config.adminToken)
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const next = parsePolicy(parsed.body)
    if (!next) return jsonError('invalid policy', 400)

    const before = store.getPolicy()
    store.setPolicy(next, {
      at: Date.now(),
      updatedBy: principal?.kind === 'session' ? principal.user.email : null,
    })
    store.audit('policy_updated', null, null, {
      from: before,
      to: next,
    }, Date.now(), {
      userId: principal?.kind === 'session' ? principal.user.id : null,
    })
    return c.json({ policy: next })
  })

  // ── Admin ──────────────────────────────────────────────────

  // The list lives in `routes/admin.ts`, next to the rest of the console's
  // reads. Revoking stays here because it has to close live sockets, which only
  // this file owns.

  app.post('/admin/devices/:id/revoke', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const revoked = store.revokeDevice(c.req.param('id'))
    if (revoked) {
      // A credential that died mid-frame takes its sockets with it; the phone
      // reconnects into a 401 instead of streaming a session it no longer owns.
      const closed = closeDeviceSockets(c.req.param('id'))
      store.audit('device_revoked', c.req.param('id'), null, { closedSockets: closed })
    }
    return revoked ? c.json({ revoked: true }) : jsonError('not found', 404)
  })

  // `/admin/audit` lives in `routes/admin.ts` beside the stream that feeds the
  // same rows, so the two cannot drift into different wire shapes.

  // ── Push ───────────────────────────────────────────────────

  /**
   * Who may publish a notification, and which desktop it belongs to.
   *
   * A desktop's own agent may only notify that desktop's phones; otherwise one
   * signed-in computer could page every other user on the gateway. The admin
   * token keeps its gateway-wide reach, which is what the setup endpoint uses.
   */
  const publisherOf = (c: Context): { desktopId: string | null; admin: boolean } | null => {
    const token = bearerToken(c.req.header('authorization')) ?? null
    if (!token) return null
    if (safeEqual(token, config.adminToken)) return { desktopId: null, admin: true }
    const desktop = authenticateDesktopToken(token, store)
    if (desktop) return { desktopId: desktop.id, admin: false }
    if (safeEqual(token, config.agentToken)) return { desktopId: null, admin: false }
    return null
  }

  /**
   * A device declares where it wants to be reached. The token is opaque to the
   * gateway — an FCM registration token or a URL — which is what lets the same
   * endpoint serve both providers.
   */
  app.post('/push/register', async (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return jsonError('unauthorized', 401)
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const body = parsed.body as
      { provider?: unknown; token?: unknown; platform?: unknown } | null
    const provider = body?.provider
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!isPushProviderName(provider)) return jsonError('unknown push provider', 400)
    if (!token || token.length > 4096) return jsonError('invalid push token', 400)

    const registration = push.register({
      deviceId: device.id,
      provider,
      token,
      platform: typeof body?.platform === 'string' && body.platform
        ? body.platform.trim().slice(0, 20)
        : device.platform,
    })
    store.touchDevice(device.id)
    if (!registration) {
      // Another account already holds this address. Taking it over would
      // silently stop that phone's notifications, so the caller is refused
      // instead — and told so, rather than being left to wonder why nothing
      // arrives.
      store.audit('push_register_conflict', device.id, null, { provider })
      return jsonError('push token belongs to another account', 409)
    }
    store.audit('push_registered', device.id, registration.id, { provider })
    return c.json({ registration })
  })

  app.get('/push/registrations', (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return jsonError('unauthorized', 401)
    return c.json({ registrations: store.listDevicePushRegistrations(device.id) })
  })

  app.delete('/push/registrations/:id', (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return jsonError('unauthorized', 401)
    const id = c.req.param('id')
    // Scoped to the caller: a device may only forget its own destinations.
    const owned = store.listDevicePushRegistrations(device.id).some(entry => entry.id === id)
    if (!owned) return jsonError('not found', 404)
    push.unregister(id)
    store.audit('push_unregistered', device.id, id)
    return c.json({ removed: true })
  })

  /**
   * The publisher is whatever is closest to the session — the desktop agent,
   * which sees the same live-status the phone does. The gateway only carries
   * the decision, so it needs no idea what an "approval" means.
   */
  app.post('/push/notify', async (c) => {
    const publisher = publisherOf(c)
    if (!publisher) return jsonError('unauthorized', 401)
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const body = parsed.body as
      { kind?: unknown; sessionId?: unknown; title?: unknown; body?: unknown; deviceId?: unknown } | null
    if (!isPushKind(body?.kind)) return jsonError('unknown notification kind', 400)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) return jsonError('sessionId is required', 400)

    // A device id is a shortcut, not a permission. Who may name one:
    //
    // - the admin token, which has gateway-wide reach by design;
    // - a desktop agent, for the phones that desktop owns;
    // - the legacy shared agent, for the phones on the shared route — the
    //   desktop it effectively is.
    //
    // Anything else is "not found", so a caller cannot probe for ids it does
    // not own: naming an arbitrary device used to be enough to page a phone
    // belonging to another account.
    const requestedDeviceId = typeof body?.deviceId === 'string' && body.deviceId ? body.deviceId : null
    if (requestedDeviceId) {
      const device = store.getDevice(requestedDeviceId)
      const mine = device !== null && (
        publisher.admin
        || (publisher.desktopId !== null && device.desktop_id === publisher.desktopId)
        || (publisher.desktopId === null && device.desktop_id === null)
      )
      if (!mine) return jsonError('not found', 404)
    }

    const report = await push.notify({
      kind: body.kind,
      sessionId,
      ...(typeof body?.title === 'string' && body.title ? { title: body.title.slice(0, 200) } : {}),
      ...(typeof body?.body === 'string' && body.body ? { body: body.body.slice(0, 500) } : {}),
      ...(requestedDeviceId ? { deviceId: requestedDeviceId } : {}),
      ...(publisher.desktopId ? { desktopId: publisher.desktopId } : {}),
    })
    return c.json({ report })
  })

  // The console's push screen needs the watcher topology as well as the
  // registrations, and that only exists in this file — so this stays the one
  // implementation and `routes/admin.ts` adds the delivery history beside it.
  app.get('/admin/push', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json({
      providers: push.availableProviders,
      watching: watchers.size() > 0,
      watchingDesktops: watchers.watched(),
      counts: store.countPushRegistrations(),
      registrations: store.listPushRegistrations().map(registration => ({
        id: registration.id,
        deviceId: registration.deviceId,
        provider: registration.provider,
        platform: registration.platform,
        createdAt: new Date(registration.createdAt).toISOString(),
        updatedAt: new Date(registration.updatedAt).toISOString(),
        lastError: registration.lastError,
        failedAt: registration.failedAt ? new Date(registration.failedAt).toISOString() : null,
      })),
    })
  })

  /** Sends one notification through the real providers, for setup checks. */
  app.post('/admin/push/test', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413)
    const body = (parsed.body ?? {}) as
      { kind?: unknown; sessionId?: unknown; deviceId?: unknown } | null
    const report = await push.notify({
      kind: isPushKind(body?.kind) ? body.kind : 'approval',
      sessionId: typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId : 'test-session',
      title: 'lumos test notification',
      body: 'If you can read this, push delivery works.',
      ...(typeof body?.deviceId === 'string' && body.deviceId ? { deviceId: body.deviceId } : {}),
    })
    return c.json({ report })
  })

  // ── Agent tunnel (desktop dials out) ───────────────────────

  /**
   * The relay carries long-lived sockets, so its ceiling is on connections
   * rather than on traffic: a reconnect storm must not turn into a socket
   * flood. It is registered as a middleware so a refused client is answered
   * with a plain 429 and never gets upgraded in the first place.
   */
  app.use('/relay/*', async (c, next) => {
    if (!relayLimiter.allow(`relay:${clientIp(c)}`)) {
      return jsonError('too many relay connections', 429)
    }
    await next()
  })

  /**
   * A desktop dials out once and keeps the socket open.
   *
   * The credential decides which desktop this is: a `dsk_…` token names its own
   * row, and the old shared agent token takes the legacy slot. A caller can
   * never claim to be a desktop it does not hold the secret for.
   */
  app.get('/relay/agent', upgradeWebSocket((c) => {
    const { token, via } = wsCredential(c)
    const desktop = authenticateDesktopToken(token, store)
    const legacy = !desktop && token !== null && safeEqual(token, config.agentToken)
    if (!desktop && !legacy) {
      return { onOpen: (_event, ws) => ws.close(4401, 'unauthorized') }
    }
    const route = desktop?.id ?? LEGACY_ROUTE
    let socket: { send: (data: string) => void; close: (code?: number, reason?: string) => void } | null = null

    return {
      onOpen: (_event, ws) => {
        socket = {
          send: (data: string) => ws.send(data),
          close: (code?: number, reason?: string) => ws.close(code, reason),
          // Bun can report the kernel queue; other runtimes leave it undefined
          // and the hub then treats the tunnel as healthy.
          bufferedAmount: typeof (ws as { getBufferedAmount?: () => number }).getBufferedAmount === 'function'
            ? () => (ws as unknown as { getBufferedAmount: () => number }).getBufferedAmount()
            : undefined,
        }
        hub.attach(route, socket)
        if (desktop) store.touchDesktop(desktop.id)
        store.audit(
          'agent_connected',
          null,
          null,
          // A lingering 'query' here marks an agent that still needs updating.
          { auth: via },
          Date.now(),
          { userId: desktop?.user_id ?? null, desktopId: desktop?.id ?? null },
        )
      },
      onMessage: (event) => {
        if (typeof event.data === 'string') hub.receive(route, event.data)
      },
      onClose: () => {
        if (socket) hub.detach(route, socket)
        store.audit('agent_disconnected', null, null, undefined, Date.now(), {
          userId: desktop?.user_id ?? null,
          desktopId: desktop?.id ?? null,
        })
      },
    }
  }))

  // ── Phone relay tunnel (a phone forwarding for its LAN) ─────

  app.get('/relay/device', upgradeWebSocket((c) => {
    // The phone holds the device token; the LAN clients it forwards for never
    // see it, and cannot supply one of their own. The credential may arrive in
    // the handshake or as the first frame — never both at once.
    const { token: socketToken } = wsCredential(c)
    let device = authenticateToken(socketToken ?? null, store)
    let relay: ReturnType<typeof createDeviceRelay> | null = null
    let socket: { send: (data: string) => void; close: (code?: number, reason?: string) => void } | null = null

    let untrack: (() => void) | null = null

    const attach = (ws: WSContext, row: DeviceRow, token: string) => {
      store.touchDevice(row.id)
      relay = createDeviceRelay({
        app,
        // Every relayed request carries this token, so the LAN client behind
        // the phone inherits exactly the phone's scopes and nothing more.
        deviceToken: token,
        maxBodyBytes: config.maxBodyBytes,
        emit: frame => socket?.send(JSON.stringify(frame)),
      })
      socket = {
        send: data => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
      }
      untrack = trackDeviceSocket(row.id, socket)
      relaySockets += 1
      store.audit('relay_attached', row.id, null, { platform: row.platform })
    }

    return {
      onOpen: (_event, ws) => {
        if (device && socketToken) {
          attach(ws, device, socketToken)
          return
        }
        // A supplied-but-wrong token is final; a missing one may still arrive
        // as the first frame, so that socket gets a grace period instead.
        if (socketToken) {
          ws.close(4401, 'unauthorized')
          return
        }
        setTimeout(() => {
          if (!device) ws.close(4401, 'unauthorized')
        }, WS_AUTH_TIMEOUT_MS)
      },
      onMessage: (event, ws) => {
        if (typeof event.data !== 'string') return
        if (!device) {
          // A browser WebSocket cannot set headers, so the token may arrive as
          // the first frame instead — the same handshake `/ws/:sessionId` uses.
          try {
            const frame = JSON.parse(event.data) as { type?: string; token?: string }
            if (frame.type !== 'auth' || typeof frame.token !== 'string') {
              ws.close(4401, 'unauthorized')
              return
            }
            const row = authenticateToken(frame.token, store)
            if (!row) {
              ws.close(4401, 'unauthorized')
              return
            }
            device = row
            attach(ws, row, frame.token)
          } catch {
            ws.close(4401, 'unauthorized')
          }
          return
        }
        relay?.receive(event.data)
      },
      onClose: () => {
        untrack?.()
        untrack = null
        if (!relay) return
        relay.close()
        relay = null
        relaySockets -= 1
        store.audit('relay_detached', device?.id ?? null)
      },
    }
  }))

  // ── HTTP reverse proxy ─────────────────────────────────────

  /**
   * A paired desktop that is not reachable is a transient condition the phone
   * can show and retry, not a server error. 503 with a named code lets the app
   * distinguish "your computer is asleep" from "the gateway is broken".
   */
  const desktopOffline = (c: Context, device: DeviceRow, err: DesktopOfflineError): Response => {
    store.audit('proxy_desktop_offline', device.id, new URL(c.req.url).pathname, undefined, Date.now(), {
      userId: device.user_id ?? null,
      desktopId: err.desktopId,
    })
    return Response.json(
      { error: 'desktop offline', code: 'desktop_offline', desktopId: err.desktopId },
      { status: 503 },
    )
  }

  const proxyHandler = (mode: 'api' | 'proxy', pathPrefix?: string) => async (c: Context) => {
    const device = authenticateRequest(c, store)
    if (!device) return jsonError('unauthorized', 401)
    const method = c.req.method.toUpperCase()
    const needed: Scope = mode === 'proxy'
      ? 'proxy'
      : (method === 'GET' || method === 'HEAD' ? 'sessions:read' : 'sessions:write')
    if (!hasScope(device, needed)) return jsonError('forbidden', 403)
    // Both ceilings are checked after the credential is known, so an
    // unauthenticated flood never consumes a device's budget and a stolen
    // device token cannot spend the budget of the address it came from.
    if (!apiLimiter.allow(`device:${device.id}`)) {
      return jsonError('too many requests', 429)
    }
    if (!apiIpLimiter.allow(`ip:${clientIp(c)}`)) {
      return jsonError('too many requests', 429)
    }
    store.touchDevice(device.id)

    let body: Uint8Array | undefined
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await readBody(c.req.raw, config.maxBodyBytes)
      } catch (err) {
        if (err instanceof BodyTooLargeError) return jsonError('request body too large', 413)
        throw err
      }
    }

    try {
      return await forwardHttp(c.req.raw, config, hub, device, { body, pathPrefix })
    } catch (err) {
      if (err instanceof DesktopOfflineError) return desktopOffline(c, device, err)
      if (err instanceof TunnelBackpressureError) {
        // The desktop is connected but cannot keep up: retryable, and worth a
        // Retry-After so a well-behaved client backs off instead of hammering.
        return new Response(
          JSON.stringify({ error: 'desktop busy', code: 'desktop_busy', retryAfterMs: 1000 }),
          { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '1' } },
        )
      }
      if (process.env.OPENBUDDY_DEBUG_PROXY === '1') {
        console.error('[proxy] error:', err instanceof Error ? `${err.name}: ${err.message}` : String(err))
      }
      store.audit('proxy_error', device.id, new URL(c.req.url).pathname, {
        message: err instanceof Error ? err.message : String(err),
      })
      return jsonError('upstream unavailable', 502)
    }
  }

  app.all('/api/*', proxyHandler('api'))
  app.all('/proxy/*', proxyHandler('proxy'))
  app.all('/sdk/*', proxyHandler('api'))
  // Public gateway alias for third-party Anthropic clients; lumos serves the
  // same handler under /proxy.
  app.all('/v1/messages', proxyHandler('proxy', '/proxy'))

  // ── OpenAI-compatible endpoints ─────────────────────────────
  //
  // Third-party clients speak OpenAI; the desktop speaks Anthropic. These two
  // routes translate between the two so a client can point at the gateway
  // without knowing anything about lumos.

  app.get('/v1/models', async (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return openAiError('invalid API key', 401, 'authentication_error')
    if (!hasScope(device, 'proxy')) return openAiError('missing proxy scope', 403, 'permission_error')
    store.touchDevice(device.id)

    try {
      const upstream = await forwardHttp(c.req.raw, config, hub, device, { path: '/api/models' })
      // An upstream failure keeps the upstream's status (so client retry logic
      // is unchanged) but is re-shaped for this surface: an SDK pointed at
      // `/v1` parses OpenAI errors, not the Anthropic body the desktop sends.
      if (!upstream.ok) {
        const detail = await readUpstreamErrorMessage(upstream)
        return openAiError(detail ?? `upstream error ${upstream.status}`, upstream.status, 'api_error')
      }
      const payload = await upstream.json().catch(() => null)
      return c.json(normalizeModelList(payload))
    } catch (err) {
      if (err instanceof DesktopOfflineError) {
        return openAiError('desktop offline', 503, 'api_error')
      }
      store.audit('proxy_error', device.id, '/v1/models', {
        message: err instanceof Error ? err.message : String(err),
      })
      return openAiError('upstream unavailable', 502, 'api_error')
    }
  })

  app.post('/v1/chat/completions', async (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return openAiError('invalid API key', 401, 'authentication_error')
    if (!hasScope(device, 'proxy')) return openAiError('missing proxy scope', 403, 'permission_error')
    store.touchDevice(device.id)

    let raw: Uint8Array
    try {
      raw = (await readBody(c.req.raw, config.maxBodyBytes)) ?? new Uint8Array()
    } catch (err) {
      if (err instanceof BodyTooLargeError) return openAiError('request body too large', 413)
      throw err
    }

    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(raw))
    } catch {
      return openAiError('invalid JSON body', 400)
    }

    let translation
    try {
      translation = toAnthropicRequest(payload)
    } catch (err) {
      return openAiError(err instanceof Error ? err.message : 'invalid request', 400)
    }

    const created = Math.floor(Date.now() / 1000)
    const body = new TextEncoder().encode(JSON.stringify(translation.body))

    let upstream: Response
    try {
      upstream = await forwardHttp(c.req.raw, config, hub, device, {
        body,
        // The desktop serves the Anthropic proxy under /proxy.
        path: '/proxy/v1/messages',
        headers: { 'anthropic-version': '2023-06-01' },
      })
    } catch (err) {
      if (err instanceof DesktopOfflineError) return openAiError('desktop offline', 503, 'api_error')
      store.audit('proxy_error', device.id, '/v1/chat/completions', {
        message: err instanceof Error ? err.message : String(err),
      })
      return openAiError('upstream unavailable', 502, 'api_error')
    }

    if (!upstream.ok) {
      const detail = await readUpstreamErrorMessage(upstream)
      return openAiError(detail ?? `upstream error ${upstream.status}`, upstream.status, 'api_error')
    }

    if (translation.stream) {
      if (!upstream.body) return openAiError('upstream unavailable', 502, 'api_error')
      const stream = anthropicStreamToOpenAI(upstream.body, translation.model, created)
      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        },
      })
    }

    const answer = await upstream.json().catch(() => null)
    if (!answer) return openAiError('invalid upstream response', 502, 'api_error')
    return c.json(anthropicResponseToOpenAI(answer, translation.model, created))
  })

  // ── WebSocket reverse proxy ────────────────────────────────

  app.get('/ws/:sessionId', upgradeWebSocket((c) => {
    const sessionId = c.req.param('sessionId')!
    const url = new URL(c.req.url)
    // Preserve upstream-relevant params (channel/clientKind) but never the token.
    url.searchParams.delete('token')
    const path = pathWithSearch(`/ws/${sessionId}`, url.searchParams)
    const headers: Record<string, string> = {}
    if (config.upstreamToken) headers.authorization = `Bearer ${config.upstreamToken}`

    // A native client carries the device token in the Authorization header:
    // the browser WebSocket API cannot set headers, so the web client uses the
    // query parameter instead. Accepting both keeps a bearer token out of
    // access logs and proxy traces on the path that can avoid it.
    let device = authenticateToken(wsCredential(c).token, store)
    let bridge: { send: (data: string | Uint8Array) => void; close: (code?: number, reason?: string) => void } | null = null
    let upstream: WebSocket | null = null
    let closed = false
    /** Live while this socket serves an authenticated device. */
    let untrack: (() => void) | null = null

    const cleanup = () => {
      untrack?.()
      untrack = null
      bridge?.close(1000, 'gateway closed')
      try {
        upstream?.close()
      } catch {
        // already closed
      }
      bridge = null
      upstream = null
    }

    const connect = (ws: WSContext) => {
      if (!device || !hasScope(device, 'sessions:read')) {
        ws.close(4403, 'forbidden')
        return
      }
      store.touchDevice(device.id)
      // The handshake authenticated the device once; if the credential is
      // revoked later, the registry closes this socket with it.
      untrack = trackDeviceSocket(device.id, {
        close: (code, reason) => ws.close(code, reason),
      })
      const route = routeForDevice(device)
      if (route.kind === 'desktop') {
        if (!hub.isOnline(route.desktopId)) {
          ws.close(4503, 'desktop offline')
          return
        }
        bridge = hub.openWs(route.desktopId, path, headers, {
          onMessage: (data) => ws.send(typeof data === 'string' ? data : new Uint8Array(data)),
          onClose: (code, reason) => ws.close(code, reason),
        })
        return
      }
      if (hub.legacyConnected) {
        bridge = hub.openWs(LEGACY_ROUTE, path, headers, {
          onMessage: (data) => ws.send(typeof data === 'string' ? data : new Uint8Array(data)),
          onClose: (code, reason) => ws.close(code, reason),
        })
        return
      }
      // Bun accepts request options as the second argument; the desktop server
      // authorizes WS either by H5 token in the query or a bearer header.
      const socket = new WebSocket(upstreamWsUrl(config, path), { headers })
      socket.binaryType = 'arraybuffer'
      upstream = socket
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') ws.send(event.data)
        else ws.send(new Uint8Array(event.data as ArrayBuffer))
      }
      socket.onclose = (event) => {
        if (!closed) ws.close(event.code, event.reason)
      }
      socket.onerror = () => {
        if (!closed) ws.close(1011, 'upstream error')
      }
    }

    return {
      onOpen: (_event, ws) => {
        if (device) {
          connect(ws)
          return
        }
        setTimeout(() => {
          if (!device && !closed) ws.close(4401, 'unauthorized')
        }, WS_AUTH_TIMEOUT_MS)
      },
      onMessage: (event, ws) => {
        if (!device) {
          if (typeof event.data !== 'string') {
            ws.close(4401, 'unauthorized')
            return
          }
          try {
            const frame = JSON.parse(event.data) as { type?: string; token?: string }
            if (frame.type !== 'auth') {
              ws.close(4401, 'unauthorized')
              return
            }
            device = authenticateToken(frame.token ?? null, store)
            if (!device) {
              ws.close(4401, 'unauthorized')
              return
            }
          } catch {
            ws.close(4401, 'unauthorized')
            return
          }
          connect(ws)
          return
        }
        if (bridge) {
          if (typeof event.data === 'string') bridge.send(event.data)
          else if (event.data instanceof ArrayBuffer) bridge.send(new Uint8Array(event.data))
          else if (event.data instanceof Uint8Array) bridge.send(event.data)
          return
        }
        upstream?.send(event.data as string)
      },
      onClose: () => {
        closed = true
        cleanup()
      },
    }
  }))

  // Watching sessions is the only thing here that talks to a desktop
  // unprompted, so it stays off unless a notification could actually be
  // delivered. One watcher per computer keeps each user's events on their own
  // desktop; the desktop-less legacy path keeps a single watcher.
  const pushEnabled = config.pushWatch ?? (push.availableProviders.length > 0)
  const watchers = createPushWatchers({
    store,
    hub,
    upstreamUrl: config.upstreamUrl,
    ...(config.upstreamToken ? { upstreamToken: config.upstreamToken } : {}),
    intervalMs: config.pushWatchIntervalMs,
    legacyEnabled: pushEnabled,
    onEvents: async (desktopId, events) => {
      for (const event of events) {
        await push.notify({
          kind: event.kind,
          sessionId: event.sessionId,
          // Naming the tool turns "something needs you" into "Bash needs you".
          ...(event.kind === 'approval' && event.toolName
            ? { body: `${event.toolName} is waiting for your approval.` }
            : {}),
          // With it, the phone's Allow/Deny buttons can answer without opening.
          ...(event.kind === 'approval' && event.requestId ? { requestId: event.requestId } : {}),
          ...(desktopId ? { desktopId } : {}),
        })
      }
    },
    onError: (desktopId, error) => {
      store.audit('push_watch_error', null, null, {
        message: error instanceof Error ? error.message : String(error),
        ...(desktopId ? { desktopId } : {}),
      })
    },
  })

  if (pushEnabled) {
    watchers.sync()
    // A desktop coming online or a phone registering is what makes a watcher
    // worth running; re-evaluating periodically is cheaper than hooking every
    // socket event and covers both.
    const syncTimer = setInterval(() => watchers.sync(), config.pushWatchIntervalMs)
    pushSyncTimer = syncTimer
  }

  // The console's own API. Registered after the push wiring so its overview can
  // report what the dispatcher can actually deliver through.
  registerAdminRoutes(app, {
    store,
    config,
    hub,
    isDesktopOnline: desktopId => hub.isOnline(desktopId),
    pushProviders: () => push.availableProviders,
    push,
  })

  // Expired pairing codes, dead sessions and old audit rows delete themselves
  // on a schedule rather than growing forever on a gateway that simply runs.
  const pruneTimer = setInterval(() => store.pruneExpired(), config.pruneIntervalMs)

  return {
    app,
    store,
    hub,
    push,
    config,
    close: () => {
      if (pushSyncTimer) clearInterval(pushSyncTimer)
      clearInterval(pruneTimer)
      watchers.stop()
      // Pending retry timers may outlive an in-flight notify; the gateway is
      // going away, so none of them should fire against a closed store.
      push.dispose?.()
      store.close()
    },
  }
}

function pathWithSearch(pathname: string, search: URLSearchParams): string {
  const searchString = search.toString()
  return searchString ? `${pathname}?${searchString}` : pathname
}
