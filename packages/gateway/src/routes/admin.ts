/**
 * The admin console's API.
 *
 * Everything here is the same data `/admin/*` already exposed, reshaped for a
 * screen: an operator needs the list, not one resource at a time, and needs
 * "who owns this" next to "is it online". Nothing here decides policy the
 * gateway's own routes do not already enforce.
 *
 * Two rules are specific to this file:
 *
 * - **Live reads are on demand.** A background poller would touch every desktop
 *   forever whether or not anyone is looking; the console's board does it while
 *   a page is open, caches the answer briefly, and shares one in-flight request
 *   between tabs.
 * - **Account changes are audited with an actor.** A console action that
 *   demotes an admin or mints a pairing code records which account did it, so
 *   the audit trail answers the question the shared token cannot.
 */

import { deleteCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import type { Context, Hono } from 'hono'

import {
  ADMIN_COOKIE,
  ADMIN_CSRF_HEADER,
  authenticateAdminCredential,
  isAdminUser,
  issueUserSession,
  type AdminPrincipal,
} from '../auth.js'
import { readJsonBody } from '../bodyLimit.js'
import type { GatewayConfig } from '../config.js'
import { DesktopOfflineError } from '../proxy.js'
import type { PushDispatcher } from '../push/dispatcher.js'
import { createLiveStatusReader, type LiveSession } from '../push/watcher.js'
import { slidingWindow } from '../rateLimit.js'
import {
  deviceScopes,
  type DeviceRow,
  type Store,
  type UserRow,
} from '../store.js'
import type { AgentHub } from '../relay/hub.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200
/** How long one live snapshot is reused before another read is made. */
const LIVE_CACHE_MS = 2_500
/** How long a desktop gets to answer a live-status read. */
const LIVE_READ_TIMEOUT_MS = 4_000
/** How often the audit stream looks for new rows. */
const AUDIT_STREAM_POLL_MS = 2_000
/** Audit rows per SSE poll; a burst larger than this is reported as a gap. */
const AUDIT_STREAM_BATCH = 100

/**
 * Transcript reads are expensive twice: they cross the tunnel to a desktop,
 * and the desktop re-reads its own history. Two open tabs on the same session
 * therefore used to ask the computer twice as often as the screen refreshed.
 * The cache is deliberately short — an operator can always be two seconds
 * behind — and only successful answers are kept.
 */
const SESSION_READ_CACHE_MS = 2_000
/** Bodies above this are shared while in flight but not retained afterwards. */
const SESSION_READ_CACHE_MAX_BYTES = 2 * 1024 * 1024
/** Bound on retained reads; the keys are desktop+path, so a stale tab cannot grow this forever. */
const SESSION_READ_CACHE_MAX_ENTRIES = 32
/**
 * The desktop rejects a cursor longer than this before parsing it, so there is
 * no reason to send one: it would only inflate the cache key and the audit row.
 */
const SESSION_CURSOR_MAX_LENGTH = 2048

type CachedSessionRead = {
  at: number
  status: number
  body: ArrayBuffer
  contentType: string
}

type Dependencies = {
  store: Store
  config: GatewayConfig
  hub: AgentHub
  isDesktopOnline: (desktopId: string) => boolean
  /** Providers this gateway can actually deliver through, from the dispatcher. */
  pushProviders: () => string[]
  /** The dispatcher, for the console's per-registration test send. */
  push: PushDispatcher
}

/**
 * A failure the console can translate.
 *
 * `error` stays the English sentence existing clients already read; `code` is
 * the stable identifier the console maps to its own language. Only failures an
 * operator can act on carry one — an internal 500 has nothing useful to say.
 */
function jsonError(message: string, status: number, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, { status })
}

/** A query string integer, clamped; anything malformed falls back to `fallback`. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** A query string integer, or null when absent/malformed. */
function optionalInt(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? Math.trunc(value) : null
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

function readText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

function publicAccount(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: new Date(user.created_at).toISOString(),
  }
}

function publicDevice(device: DeviceRow, desktops: Map<string, { id: string; name: string; ownerEmail: string | null }>) {
  const desktop = device.desktop_id ? desktops.get(device.desktop_id) : undefined
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    scopes: deviceScopes(device),
    createdAt: new Date(device.created_at).toISOString(),
    lastSeenAt: device.last_seen_at ? new Date(device.last_seen_at).toISOString() : null,
    revokedAt: device.revoked_at ? new Date(device.revoked_at).toISOString() : null,
    desktopId: device.desktop_id,
    desktopName: desktop?.name ?? null,
    ownerEmail: desktop?.ownerEmail ?? null,
  }
}

/**
 * A live snapshot of one desktop, and how fresh it is.
 *
 * `stale` says the last read failed; the sessions in the payload are the last
 * known good answer, not an empty board. A console that showed "nothing is
 * running" for a sleeping desktop would be telling the operator something the
 * gateway does not know.
 */
type LiveDesktopSnapshot = {
  desktopId: string
  desktopName: string | null
  online: boolean
  sessions: LiveSession[]
  fetchedAt: string
  stale: boolean
  error?: string
}

export function registerAdminRoutes(app: Hono, deps: Dependencies): void {
  const { store, config, hub, isDesktopOnline, pushProviders, push } = deps
  const loginByIp = slidingWindow(config.loginLimitPerMinute)

  /** Successful transcript reads, keyed by desktop + path. */
  const sessionReadCache = new Map<string, CachedSessionRead>()
  /** One upstream read per key, however many callers are waiting on it. */
  const sessionReadInFlight = new Map<
    string,
    Promise<{ status: number; body: ArrayBuffer; contentType: string }>
  >()

  const readCache = (key: string): CachedSessionRead | null => {
    const entry = sessionReadCache.get(key)
    if (!entry) return null
    if (Date.now() - entry.at >= SESSION_READ_CACHE_MS) {
      sessionReadCache.delete(key)
      return null
    }
    return entry
  }

  const writeCache = (key: string, entry: CachedSessionRead): void => {
    sessionReadCache.delete(key)
    sessionReadCache.set(key, entry)
    while (sessionReadCache.size > SESSION_READ_CACHE_MAX_ENTRIES) {
      const oldest = sessionReadCache.keys().next().value
      if (oldest === undefined) break
      sessionReadCache.delete(oldest)
    }
  }

  /**
   * The authenticated admin, or a response explaining why there is none.
   *
   * The CSRF check lives in middleware applied to all of `/admin/*` (see
   * `app.ts`), so it covers the routes in `app.ts` too; this helper only
   * authenticates.
   */
  const requireAdmin = (c: Context): { principal: AdminPrincipal } | { response: Response } => {
    const principal = authenticateAdminCredential(c, store, config.adminToken)
    if (!principal) return { response: jsonError('unauthorized', 401, 'unauthorized') }
    if (principal.kind === 'session') store.touchUserSession(principal.session.id)
    return { principal }
  }

  /** Who to write into the audit row: an account when there is one. */
  const actorOf = (principal: AdminPrincipal): { userId: string | null } => ({
    userId: principal.kind === 'session' ? principal.user.id : null,
  })

  // ── Session ────────────────────────────────────────────────

  /**
   * Signs an administrator in.
   *
   * The password is checked against the same hash `/auth/login` uses; the only
   * difference is the role gate and the cookie, which keeps the credential out
   * of reach of page scripts and out of every subsequent URL.
   */
  app.post('/admin/session', async (c) => {
    const ip = clientIp(c, config)
    if (!loginByIp.allow(ip)) return jsonError('too many attempts', 429, 'rate_limited')

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413, 'request_too_large')
    const body = parsed.body as { email?: unknown; password?: unknown } | null
    const email = normalizeEmail(body?.email)
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email || !password) return jsonError('invalid email or password', 401, 'invalid_credentials')

    const user = store.getUserByEmail(email)
    // An ordinary account is refused with the same message as a wrong password:
    // telling a caller "this exists but is not an admin" is an account oracle.
    if (!user || !isAdminUser(user)) {
      store.audit('admin_login_failed', null, null, { email, ip })
      return jsonError('invalid email or password', 401, 'invalid_credentials')
    }

    const valid = await Bun.password.verify(password, user.password_hash).catch(() => false)
    if (!valid) {
      store.audit('admin_login_failed', null, null, { email, ip }, Date.now(), { userId: user.id })
      return jsonError('invalid email or password', 401, 'invalid_credentials')
    }

    const session = issueUserSession(user.id)
    store.insertUserSession({
      id: session.sessionId,
      userId: user.id,
      tokenHash: session.hash,
      expiresAt: Date.now() + config.adminSessionTtlMs,
    })
    setCookie(c, ADMIN_COOKIE, session.token, {
      httpOnly: true,
      // `SameSite=Strict` keeps the cookie off cross-site requests entirely;
      // the CSRF header covers the same-site-but-not-same-origin case.
      sameSite: 'Strict',
      path: '/',
      maxAge: Math.floor(config.adminSessionTtlMs / 1000),
      // A console served over plain http on a LAN still has to work; the
      // cookie is marked Secure only when the request itself arrived over TLS.
      secure: new URL(c.req.url).protocol === 'https:',
    })
    // The email is repeated into meta so the audit table can name the actor
    // without a second lookup; the user id alone reads as an opaque string.
    store.audit('admin_login', null, null, { email: user.email, ip }, Date.now(), { userId: user.id })

    return c.json({ user: publicAccount(user), expiresAt: new Date(Date.now() + config.adminSessionTtlMs).toISOString() })
  })

  app.get('/admin/session', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    if (result.principal.kind === 'token') {
      // The break-glass token has no account behind it; the console says so
      // rather than inventing an identity.
      return c.json({ kind: 'token', user: null, expiresAt: null })
    }
    const { user, session } = result.principal
    return c.json({
      kind: 'session',
      user: publicAccount(user),
      expiresAt: new Date(session.expires_at).toISOString(),
    })
  })

  app.delete('/admin/session', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    if (result.principal.kind === 'session') {
      store.revokeUserSession(result.principal.session.id)
      store.audit('admin_logout', null, null, undefined, Date.now(), actorOf(result.principal))
    }
    deleteCookie(c, ADMIN_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // ── Overview ───────────────────────────────────────────────

  app.get('/admin/overview', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const desktops = store.listAllDesktops()
    const devices = store.listDevices()
    const onlineDesktops = desktops.filter(desktop => !desktop.revoked_at && isDesktopOnline(desktop.id))

    return c.json({
      health: {
        status: 'ok',
        agentConnected: hub.connected,
        agentLegacy: hub.legacyConnected,
        pushProviders: pushProviders(),
      },
      counts: {
        desktops: desktops.filter(desktop => !desktop.revoked_at).length,
        desktopsOnline: onlineDesktops.length,
        devices: devices.filter(device => !device.revoked_at).length,
        devicesOnline: devices.filter(device => !device.revoked_at && recentlySeen(device)).length,
        admins: store.countAdmins(),
        pushRegistrations: store.countPushRegistrations(),
      },
      desktopsOnline: onlineDesktops.map(desktop => ({
        id: desktop.id,
        name: desktop.name,
        platform: desktop.platform,
        ownerEmail: desktop.owner_email,
      })),
      recentAudit: store.listAudit(8).map(serializeAudit),
    })
  })

  // ── Desktops ───────────────────────────────────────────────

  app.get('/admin/desktops', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    return c.json({
      desktops: store.listAllDesktops().map(desktop => ({
        id: desktop.id,
        name: desktop.name,
        platform: desktop.platform,
        ownerEmail: desktop.owner_email,
        devices: desktop.device_count,
        online: !desktop.revoked_at && isDesktopOnline(desktop.id),
        revokedAt: desktop.revoked_at ? new Date(desktop.revoked_at).toISOString() : null,
        createdAt: new Date(desktop.created_at).toISOString(),
        lastSeenAt: desktop.last_seen_at ? new Date(desktop.last_seen_at).toISOString() : null,
      })),
    })
  })

  // ── Devices ────────────────────────────────────────────────

  app.get('/admin/devices', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const directory = new Map(
      store.listAllDesktops().map(desktop => [
        desktop.id,
        { id: desktop.id, name: desktop.name, ownerEmail: desktop.owner_email },
      ]),
    )
    return c.json({ devices: store.listDevices().map(device => publicDevice(device, directory)) })
  })

  // ── Live board ─────────────────────────────────────────────

  /**
   * The live board: what every online computer is working on right now.
   *
   * Reads happen here and only here, because this is the one thing in the
   * console that costs each desktop a request. The cache and the shared
   * in-flight promise are what keep three open tabs from tripling that cost.
   */
  const liveCache = new Map<string, { at: number; snapshot: LiveDesktopSnapshot }>()
  const liveInFlight = new Map<string, Promise<LiveDesktopSnapshot>>()

  const readDesktopLive = (desktopId: string, desktopName: string | null): Promise<LiveDesktopSnapshot> => {
    const reader = createLiveStatusReader({
      hub,
      upstreamUrl: config.upstreamUrl,
      ...(config.upstreamToken ? { upstreamToken: config.upstreamToken } : {}),
      route: desktopId,
    })

    const withTimeout = async (): Promise<LiveSession[]> => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('live-status timed out')), LIVE_READ_TIMEOUT_MS)
      })
      try {
        return await Promise.race([reader(), timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    return withTimeout().then(
      (sessions) => ({
        desktopId,
        desktopName,
        online: true,
        sessions,
        fetchedAt: new Date().toISOString(),
        stale: false,
      }),
      (error: unknown) => ({
        // The computer is reachable but did not answer in time: report the
        // last good board, marked stale, rather than an empty one.
        ...(liveCache.get(desktopId)?.snapshot ?? {
          desktopId,
          desktopName,
          online: true,
          sessions: [] as LiveSession[],
          fetchedAt: new Date().toISOString(),
        }),
        stale: true,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  const liveFor = (desktopId: string, desktopName: string | null): Promise<LiveDesktopSnapshot> => {
    const cached = liveCache.get(desktopId)
    if (cached && Date.now() - cached.at < LIVE_CACHE_MS) return Promise.resolve(cached.snapshot)

    const existing = liveInFlight.get(desktopId)
    if (existing) return existing

    const pending = readDesktopLive(desktopId, desktopName)
      .then((snapshot) => {
        liveCache.set(desktopId, { at: Date.now(), snapshot })
        return snapshot
      })
      .finally(() => {
        liveInFlight.delete(desktopId)
      })
    liveInFlight.set(desktopId, pending)
    return pending
  }

  app.get('/admin/live', async (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const desktops = store.listAllDesktops().filter(desktop => !desktop.revoked_at)
    const online = desktops.filter(desktop => isDesktopOnline(desktop.id))

    const snapshots = await Promise.all(
      online.map(desktop => liveFor(desktop.id, desktop.name)),
    )

    // An offline desktop is still a row an operator expects to see; it is
    // simply not asked anything.
    const offline = desktops
      .filter(desktop => !isDesktopOnline(desktop.id))
      .map<LiveDesktopSnapshot>(desktop => ({
        desktopId: desktop.id,
        desktopName: desktop.name,
        online: false,
        sessions: [],
        fetchedAt: new Date().toISOString(),
        stale: false,
      }))

    const all = [...snapshots, ...offline]
    const waiting = all.flatMap(snapshot =>
      snapshot.sessions
        .filter(session => session.activityState === 'waiting')
        .map(session => ({
          desktopId: snapshot.desktopId,
          desktopName: snapshot.desktopName,
          sessionId: session.id,
          pendingToolName: session.pendingToolName ?? null,
        })),
    )

    return c.json({
      generatedAt: new Date().toISOString(),
      waiting,
      desktops: all,
    })
  })

  // ── Session browser (through the desktop's own tunnel) ─────
  //
  // There is no gateway-side session store: the desktop owns the transcripts.
  // These routes forward a read through the same tunnel the phone uses, which
  // means the console sees exactly what the desktop would show its own user.

  const forwardToDesktop = async (
    _c: Context,
    desktopId: string,
    path: string,
    principal: AdminPrincipal,
    // The audit row describes *what* was read, not the opaque cursor that
    // happened to select a page, so callers may keep the two apart.
    auditTarget: string = path,
  ): Promise<Response> => {
    const desktop = store.getDesktop(desktopId)
    if (!desktop || desktop.revoked_at) return jsonError('not found', 404, 'not_found')
    if (!hub.isOnline(desktopId)) {
      return Response.json(
        { error: 'desktop offline', code: 'desktop_offline', desktopId },
        { status: 503 },
      )
    }

    const key = `${desktopId}\u0000${path}`
    // The audit row records that an operator read the session, not how many
    // times the gateway asked the desktop. A cache hit is still a read.
    const auditRead = (cache: 'hit' | 'miss' | 'shared') => {
      store.audit('admin_session_read', null, auditTarget, { cache }, Date.now(), {
        ...actorOf(principal),
        desktopId,
      })
    }

    const cached = readCache(key)
    if (cached) {
      auditRead('hit')
      return new Response(cached.body, {
        status: cached.status,
        headers: { 'content-type': cached.contentType, 'x-gateway-cache': 'hit' },
      })
    }

    let pending = sessionReadInFlight.get(key)
    const owned = pending === undefined
    if (!pending) {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'accept-encoding': 'identity',
      }
      if (config.upstreamToken) headers.authorization = `Bearer ${config.upstreamToken}`

      const read = (async () => {
        const response = await hub.requestHttp(desktopId, { method: 'GET', path, headers })
        // Buffer the answer so it can be both returned and cached: a stream
        // can only be consumed once, and the second tab needs the same bytes.
        const body = await response.arrayBuffer()
        return {
          status: response.status,
          body,
          contentType: response.headers.get('content-type') ?? 'application/json',
        }
      })()
      const tracked = read.finally(() => {
        // Delete before a later read can join this settled promise; otherwise
        // a request arriving in the microtask gap would reuse stale bytes.
        sessionReadInFlight.delete(key)
      })
      // Waiters observe the rejection; this swallows only the extra branch.
      tracked.catch(() => {})
      sessionReadInFlight.set(key, tracked)
      pending = tracked
    }

    try {
      const result = await pending
      auditRead(owned ? 'miss' : 'shared')
      if (
        result.status >= 200 &&
        result.status < 300 &&
        result.body.byteLength > 0 &&
        result.body.byteLength <= SESSION_READ_CACHE_MAX_BYTES
      ) {
        writeCache(key, { at: Date.now(), ...result })
      }
      // Pass the desktop's own answer through: its 404 is the truth about a
      // session, and rewriting it would make the console guess.
      return new Response(result.body, {
        status: result.status,
        headers: {
          'content-type': result.contentType,
          'x-gateway-cache': owned ? 'miss' : 'shared',
        },
      })
    } catch (err) {
      if (err instanceof DesktopOfflineError) {
        return Response.json(
          { error: 'desktop offline', code: 'desktop_offline', desktopId },
          { status: 503 },
        )
      }
      store.audit('admin_session_read_failed', null, auditTarget, {
        message: err instanceof Error ? err.message : String(err),
      }, Date.now(), { ...actorOf(principal), desktopId })
      return jsonError('upstream unavailable', 502, 'upstream_unavailable')
    }
  }

  app.get('/admin/desktops/:id/sessions', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    const limit = Math.min(Number(c.req.query('limit') ?? '50') || 50, 200)
    return forwardToDesktop(c, c.req.param('id'), `/api/sessions?limit=${limit}`, result.principal)
  })

  app.get('/admin/desktops/:id/sessions/:sessionId', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    const sessionId = encodeURIComponent(c.req.param('sessionId'))
    return forwardToDesktop(c, c.req.param('id'), `/api/sessions/${sessionId}`, result.principal)
  })

  app.get('/admin/desktops/:id/sessions/:sessionId/messages', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    const sessionId = encodeURIComponent(c.req.param('sessionId'))
    const cursor = c.req.query('cursor')
    if (cursor !== undefined && cursor.length > SESSION_CURSOR_MAX_LENGTH) {
      return jsonError('invalid cursor', 400, 'invalid_cursor')
    }

    // Only `cursor` is forwarded. `mode=full` is deliberately unavailable to
    // the console: the drawer reads the newest bounded page and asks for older
    // turns one cursor at a time, so a 20 MB transcript never crosses the
    // tunnel in one answer. The desktop's default (no mode) is already paged.
    //
    // The cursor is part of the path, and therefore of the cache key, so each
    // page is cached independently; a cursor that has gone stale reaches the
    // desktop and its 409 HISTORY_CHANGED is passed through unchanged.
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const basePath = `/api/sessions/${sessionId}/messages`
    return forwardToDesktop(
      c,
      c.req.param('id'),
      `${basePath}${query}`,
      result.principal,
      basePath,
    )
  })

  // ── Pairing ────────────────────────────────────────────────

  /**
   * Recent codes, with a status an operator can act on.
   *
   * The three states are the whole point: "waiting" means a phone may still
   * claim it, "claimed" means it is spent, "expired" means the operator should
   * mint another. Nothing here reveals the code itself.
   */
  app.get('/admin/pair/recent', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const now = Date.now()
    const codes = store.listRecentPairCodes(20).map((row) => {
      const status = row.consumed_at !== null
        ? 'claimed'
        : row.expires_at <= now ? 'expired' : 'waiting'
      return {
        createdAt: new Date(row.created_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString(),
        consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
        desktopId: row.desktop_id,
        desktopName: row.desktop_name,
        scopes: parseScopes(row.scopes_json),
        status,
      }
    })

    const failures = store
      .listAudit(200)
      .filter(row => row.action === 'pair_failed')
      .slice(0, 10)
      .map(row => ({
        at: new Date(row.at).toISOString(),
        // The IP is the only detail a failure carries; it is what tells an
        // operator whether a burst of failures is one scanner or several.
        ip: safeMetaField(row.meta_json, 'ip'),
      }))

    return c.json({ codes, failures })
  })

  // ── Admins ─────────────────────────────────────────────────

  app.get('/admin/admins', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response
    return c.json({ admins: store.listAdmins().map(publicAccount) })
  })

  app.post('/admin/admins', async (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return jsonError('request body too large', 413, 'request_too_large')
    const body = parsed.body as { email?: unknown; password?: unknown; displayName?: unknown } | null
    const email = normalizeEmail(body?.email)
    if (!email) return jsonError('invalid email address', 400, 'invalid_email')
    const password = typeof body?.password === 'string' ? body.password : ''
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return jsonError(
        `password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
        400,
        'password_length',
      )
    }

    const existing = store.getUserByEmail(email)
    if (existing) {
      // Promoting an account that already exists is a deliberate, separate
      // decision — this endpoint never silently upgrades a phone's account.
      return jsonError('email already registered', 409, 'email_taken')
    }

    let passwordHash: string
    try {
      passwordHash = await Bun.password.hash(password)
    } catch {
      return jsonError('could not secure the password', 500)
    }

    const user = store.createUser({
      id: crypto.randomUUID(),
      email,
      passwordHash,
      displayName: readText(body?.displayName, 80) || null,
      role: 'admin',
    })
    store.audit('admin_created', null, user.id, { email }, Date.now(), actorOf(result.principal))
    return c.json({ admin: publicAccount(user) }, 201)
  })

  app.delete('/admin/admins/:id', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const id = c.req.param('id')
    const user = store.getUser(id)
    if (!user) return jsonError('not found', 404, 'not_found')

    // Locking every administrator out of a running gateway is not a state the
    // console may reach, however the request is shaped.
    if (store.countAdmins() <= 1 && user.role === 'admin') {
      return jsonError('this is the last administrator', 400, 'last_admin')
    }

    if (!store.setUserRole(id, 'user')) return jsonError('not found', 404, 'not_found')
    // A demotion must not leave the demoted account holding a live console
    // session; their cookie is still valid until the sessions die.
    const revoked = store.revokeUserSessions(id)
    store.audit('admin_demoted', null, id, { revokedSessions: revoked }, Date.now(), actorOf(result.principal))
    return c.json({ demoted: true, revokedSessions: revoked })
  })

  // ── Push diagnostics ───────────────────────────────────────
  //
  // `/admin/push` itself stays in `app.ts`: only that file knows the watcher
  // topology. This adds the delivery history the console reads beside it.

  /**
   * The delivery history, read back out of the audit trail.
   *
   * The dispatcher already records one `push_notified` row per fan-out with its
   * four outcome counts; presenting them is what turns "notifications are not
   * arriving" into "three registrations are dead, eleven retryable".
   */
  app.get('/admin/push/deliveries', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const limit = Math.min(Number(c.req.query('limit') ?? '30') || 30, 200)
    // Filter in SQL: reading the newest 500 rows and then discarding the
    // non-push ones hides older fan-outs whenever the gateway has been busy.
    const rows = store
      .queryAudit({ limit: 500, prefixes: ['push_notified'] })
      .slice(0, limit)
      .map((row) => {
        const meta = parseMeta(row.meta_json)
        return {
          at: new Date(row.at).toISOString(),
          sessionId: row.target,
          kind: typeof meta.kind === 'string' ? meta.kind : null,
          delivered: numberField(meta, 'delivered'),
          retryable: numberField(meta, 'retryable'),
          dead: numberField(meta, 'dead'),
          skipped: numberField(meta, 'skipped'),
          considered: numberField(meta, 'considered'),
        }
      })

    return c.json({ deliveries: rows, deadRegistrations: store.listDeadPushRegistrations() })
  })

  /**
   * Send a test notification to exactly one registration.
   *
   * The page-wide test proves the provider configuration works; this one
   * proves *this phone* is reachable, which is the question an operator has
   * when one device is silent and the others are fine. A dead registration is
   * refused: its token is already known not to work.
   */
  app.post('/admin/push/registrations/:id/test', async (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const registration = store.getPushRegistration(c.req.param('id'))
    if (!registration || registration.deviceRevokedAt !== null) {
      return jsonError('not found', 404, 'not_found')
    }
    if (registration.failedAt !== null) {
      return jsonError('this registration is dead', 409, 'registration_dead')
    }

    const report = await push.notify({
      kind: 'approval',
      sessionId: `admin-test-${Date.now()}`,
      title: 'lumos test notification',
      body: 'If you can read this, this device is reachable.',
      registrationId: registration.id,
    })
    store.audit('admin_push_registration_test', registration.deviceId, registration.id, {
      ...report,
      provider: registration.provider,
    }, Date.now(), actorOf(result.principal))
    return c.json({ report })
  })

  /**
   * Remove a dead registration.
   *
   * Only dead ones: deleting a working row would silently unsubscribe a phone
   * that is still eating notifications, which is a worse outcome than leaving
   * a broken row for an operator to look at.
   */
  app.delete('/admin/push/registrations/:id', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    const registration = store.getPushRegistration(c.req.param('id'))
    if (!registration) return jsonError('not found', 404, 'not_found')
    if (registration.failedAt === null) {
      return jsonError('this registration is still live', 409, 'registration_active')
    }

    push.unregister(registration.id)
    store.audit('admin_push_registration_deleted', registration.deviceId, registration.id, {
      provider: registration.provider,
      lastError: registration.lastError,
    }, Date.now(), actorOf(result.principal))
    return c.json({ deleted: true })
  })

  /**
   * Recorded events.
   *
   * Parsed `meta` rather than the raw `meta_json` string: the SQLite column is
   * an implementation detail, and a console that had to `JSON.parse` it would
   * break the first time a row carried a malformed value. Parsing here means a
   * bad row degrades to `{}` instead of taking the page down.
   */
  app.get('/admin/audit', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    // The console pages by id, not by offset: rows arrive while an operator
    // reads, and an offset over a changing table both repeats and skips.
    const limit = clampInt(c.req.query('limit'), 100, 1, 500)
    const beforeId = optionalInt(c.req.query('beforeId'))
    const since = optionalInt(c.req.query('since'))
    const until = optionalInt(c.req.query('until'))
    const actor = c.req.query('actor')?.trim() || null
    const prefixes = (c.req.queries('prefix') ?? []).filter(prefix => prefix.length > 0)
    const failuresOnly = c.req.query('failures') === '1'

    const rows = store.queryAudit({
      limit,
      ...(beforeId != null ? { beforeId } : {}),
      ...(prefixes.length > 0 ? { prefixes } : {}),
      ...(actor ? { actor } : {}),
      ...(since != null ? { since } : {}),
      ...(until != null ? { until } : {}),
      ...(failuresOnly ? { failuresOnly } : {}),
    })
    return c.json({
      audit: rows.map(serializeAudit),
      // Only advertise a cursor when this page was full; a short page means
      // the caller has reached the end of what it filtered for.
      nextBeforeId: rows.length === limit ? rows[rows.length - 1]!.id : null,
    })
  })

  // ── Audit stream ───────────────────────────────────────────

  /**
   * Live audit rows over SSE.
   *
   * A poll of the audit table would be simpler, but each new row is an event an
   * operator wants to see the moment it happens — a pairing claim, a revoke, a
   * failed login. The stream is read-only and short-lived: it ends when the tab
   * closes, and the first poll only establishes the cursor so the page is not
   * flooded with history it already rendered.
   */
  app.get('/admin/events', (c) => {
    const result = requireAdmin(c)
    if ('response' in result) return result.response

    return streamSSE(c, async (stream) => {
      let lastId = store.listAudit(1)[0]?.id ?? 0
      let closed = false
      stream.onAbort(() => {
        closed = true
      })

      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ lastId }) })

      while (!closed) {
        await new Promise(resolve => setTimeout(resolve, AUDIT_STREAM_POLL_MS))
        if (closed) break

        const rows = store.listAudit(AUDIT_STREAM_BATCH)
          .filter(row => row.id > lastId)
          .reverse()
        if (rows.length === 0) {
          // A comment frame keeps the connection alive through proxies that
          // would otherwise time it out during a quiet period.
          await stream.write(': keepalive\n\n')
          continue
        }

        for (const row of rows) {
          if (closed) break
          await stream.writeSSE({ event: 'audit', data: JSON.stringify(serializeAudit(row)) })
          lastId = row.id
        }
      }
    })
  })
}

// ── helpers ──────────────────────────────────────────────────

function clientIp(c: Context, config: GatewayConfig): string {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded?.trim()) return forwarded.split(',')[0]!.trim()
    const real = c.req.header('x-real-ip')
    if (real?.trim()) return real.trim()
  }
  const server = c.env as { requestIP?: (req: Request) => { address: string } | null } | undefined
  try {
    return server?.requestIP?.(c.req.raw)?.address ?? 'local'
  } catch {
    return 'local'
  }
}

/** A device counts as online if it was seen within the last two minutes. */
function recentlySeen(device: DeviceRow, now = Date.now()): boolean {
  return device.last_seen_at !== null && now - device.last_seen_at < 120_000
}

function parseScopes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function parseMeta(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function safeMetaField(json: string | null, field: string): string | null {
  const value = parseMeta(json)[field]
  return typeof value === 'string' ? value : null
}

function numberField(meta: Record<string, unknown>, field: string): number {
  const value = meta[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function serializeAudit(row: {
  id: number
  at: number
  action: string
  device_id: string | null
  target: string | null
  meta_json: string | null
  user_id: string | null
  desktop_id: string | null
}) {
  return {
    id: row.id,
    at: new Date(row.at).toISOString(),
    action: row.action,
    deviceId: row.device_id,
    target: row.target,
    meta: parseMeta(row.meta_json),
    userId: row.user_id,
    desktopId: row.desktop_id,
  }
}
