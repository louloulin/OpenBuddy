import type { Context, Hono } from 'hono'

import {
  authenticateRequest,
  authenticateUser,
  hasScope,
  isScope,
  issueDesktopToken,
  issueDeviceToken,
  issueUserSession,
  type AuthenticatedUser,
  type Scope,
} from '../auth.js'
import type { GatewayConfig } from '../config.js'
import { readJsonBody } from '../bodyLimit.js'
import { policyAllowsScopes } from '../policy.js'
import { slidingWindow } from '../rateLimit.js'
import { deviceScopes, type DesktopRow, type Store, type UserRow } from '../store.js'

/**
 * Account and desktop enrollment.
 *
 * The gateway is the only component with a global view: it knows which user a
 * desktop belongs to, which phone may reach which desktop, and which of those
 * desktops is online. Everything in this file exists so a phone that has never
 * seen a six-digit code can still reach exactly one computer.
 *
 * The desktop id is always derived from a credential. A caller can name a
 * desktop in a URL, but it is checked against the authenticated user before
 * anything is minted — never trusted because it appeared in a request.
 */

const DEVICE_SCOPES: Scope[] = ['sessions:read', 'sessions:write', 'approve']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200

type Dependencies = {
  store: Store
  config: GatewayConfig
  isDesktopOnline: (desktopId: string) => boolean
  /**
   * Device credentials that just died. A WebSocket authenticated at upgrade
   * would otherwise keep serving until the client reconnects, so the gateway
   * closes its tracked sockets the moment a revoke lands.
   */
  onDevicesRevoked: (deviceIds: string[]) => void
}

/**
 * The client IP a rate limit may key on.
 *
 * Forwarding headers are only believed when a trusted proxy is configured;
 * otherwise any caller could rotate `X-Forwarded-For` into a fresh bucket per
 * request and walk straight through every limiter here.
 */
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

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null
  return email
}

function readText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

function installationIdOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value) ? value : null
}

function publicUser(user: UserRow): { id: string; email: string; displayName: string | null } {
  return { id: user.id, email: user.email, displayName: user.display_name }
}

function publicDesktop(desktop: DesktopRow, online: boolean) {
  return {
    id: desktop.id,
    name: desktop.name,
    platform: desktop.platform,
    createdAt: new Date(desktop.created_at).toISOString(),
    lastSeenAt: desktop.last_seen_at ? new Date(desktop.last_seen_at).toISOString() : null,
    online,
  }
}

function requireUser(c: Context, store: Store): { auth: AuthenticatedUser } | { response: Response } {
  const auth = authenticateUser(c, store)
  if (!auth) return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  // A session list with no last-seen cannot answer "is this login still
  // mine"; every authenticated call is the cheapest possible heartbeat.
  store.touchUserSession(auth.session.id)
  return { auth }
}

export function registerAccountRoutes(app: Hono, deps: Dependencies): void {
  const { store, config, isDesktopOnline, onDevicesRevoked } = deps
  const loginByIp = slidingWindow(config.loginLimitPerMinute)
  const loginByEmail = slidingWindow(config.loginEmailLimitPerMinute)
  const registerByIp = slidingWindow(config.registerLimitPerMinute)

  /** The address a client should use; an operator can pin a public URL. */
  const gatewayUrl = (c: Context): string => config.publicUrl ?? new URL(c.req.url).origin

  const issueSession = (userId: string) => {
    const session = issueUserSession(userId)
    store.insertUserSession({
      id: session.sessionId,
      userId,
      tokenHash: session.hash,
      expiresAt: Date.now() + config.sessionTtlMs,
    })
    return session.token
  }

  app.post('/auth/register', async (c) => {
    if (!config.allowRegistration) return Response.json({ error: 'registration is disabled' }, { status: 403 })
    if (!registerByIp.allow(clientIp(c, config))) return Response.json({ error: 'too many attempts' }, { status: 429 })

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return Response.json({ error: 'request body too large' }, { status: 413 })
    const body = parsed.body as
      { email?: unknown; password?: unknown; displayName?: unknown } | null
    const email = normalizeEmail(body?.email)
    if (!email) return Response.json({ error: 'invalid email address' }, { status: 400 })
    const password = typeof body?.password === 'string' ? body.password : ''
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return Response.json(
        { error: `password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters` },
        { status: 400 },
      )
    }
    if (store.getUserByEmail(email)) {
      return Response.json({ error: 'email already registered' }, { status: 409 })
    }

    const displayName = readText(body?.displayName, 80) || null
    let passwordHash: string
    try {
      passwordHash = await Bun.password.hash(password)
    } catch {
      return Response.json({ error: 'could not secure the password' }, { status: 500 })
    }

    const userId = crypto.randomUUID()
    let user: UserRow
    try {
      user = store.createUser({ id: userId, email, passwordHash, displayName })
    } catch {
      // The unique index is the real guard against two registrations racing.
      return Response.json({ error: 'email already registered' }, { status: 409 })
    }

    const token = issueSession(user.id)
    store.audit('user_registered', null, null, { email }, Date.now(), { userId: user.id })
    return c.json({ token, user: publicUser(user) }, 201)
  })

  app.post('/auth/login', async (c) => {
    const ip = clientIp(c, config)
    if (!loginByIp.allow(ip)) return Response.json({ error: 'too many attempts' }, { status: 429 })

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return Response.json({ error: 'request body too large' }, { status: 413 })
    const body = parsed.body as { email?: unknown; password?: unknown } | null
    const email = normalizeEmail(body?.email)
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email || !password) return Response.json({ error: 'invalid email or password' }, { status: 401 })
    // The email limiter counts an address, not an address at an address: a
    // caller that rotates its source must not get a fresh bucket for the same
    // account. The per-IP limiter above is what slows one source down; this
    // one is what stops one account from being sprayed from everywhere.
    if (!loginByEmail.allow(email)) return Response.json({ error: 'too many attempts' }, { status: 429 })

    const user = store.getUserByEmail(email)
    if (!user || user.disabled_at) {
      return Response.json({ error: 'invalid email or password' }, { status: 401 })
    }

    const valid = await Bun.password.verify(password, user.password_hash).catch(() => false)
    if (!valid) {
      store.audit('user_login_failed', null, null, { email, ip }, Date.now(), { userId: user.id })
      return Response.json({ error: 'invalid email or password' }, { status: 401 })
    }

    const token = issueSession(user.id)
    store.audit('user_login', null, null, { ip }, Date.now(), { userId: user.id })
    return c.json({ token, user: publicUser(user) })
  })

  app.post('/auth/logout', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    store.revokeUserSession(result.auth.session.id)
    store.audit('user_logout', null, null, undefined, Date.now(), { userId: result.auth.user.id })
    return c.json({ ok: true })
  })

  /**
   * Pushes the session's expiry out.
   *
   * A browser client has no native vault: clearing site data is enough to
   * lose its session, and a session that expires while the person is using it
   * every day is a password prompt nobody asked for. The session is already
   * the credential — this only extends the one that is being used, and never
   * beyond the configured lifetime measured from now.
   *
   * It is a sliding window, not a renewal: a session that goes unused still
   * expires on schedule, so an abandoned browser does not stay signed in
   * forever.
   */
  app.post('/auth/refresh', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const expiresAt = Date.now() + config.sessionTtlMs
    store.extendUserSession(result.auth.session.id, expiresAt)
    return c.json({
      user: publicUser(result.auth.user),
      expiresAt: new Date(expiresAt).toISOString(),
    })
  })

  app.get('/auth/me', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    return c.json({ user: publicUser(result.auth.user) })
  })

  /**
   * The account's live sessions.
   *
   * A person who thinks a device was stolen needs to see which sign-ins exist
   * and end the ones that are not theirs. The caller is told which row is the
   * one they are using, so the list is actionable rather than a list of ids.
   */
  app.get('/auth/sessions', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const now = Date.now()
    return c.json({
      currentSessionId: result.auth.session.id,
      sessions: store.listUserSessions(result.auth.user.id, now).map(session => ({
        id: session.id,
        current: session.id === result.auth.session.id,
        createdAt: new Date(session.created_at).toISOString(),
        lastSeenAt: session.last_seen_at ? new Date(session.last_seen_at).toISOString() : null,
        expiresAt: new Date(session.expires_at).toISOString(),
      })),
    })
  })

  /** Ends one of the caller's own sessions. */
  app.delete('/auth/sessions/:id', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const id = c.req.param('id')
    const session = store.getUserSession(id)
    // Another account's session is reported as missing, not as forbidden.
    if (!session || session.user_id !== result.auth.user.id) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    const revoked = store.revokeUserSession(id)
    store.audit('user_session_revoked', null, id, undefined, Date.now(), { userId: result.auth.user.id })
    return c.json({ revoked })
  })

  /**
   * Signs out every other session, keeping the caller's own.
   *
   * The password may be re-used on a device the person no longer has, so the
   * usual answer is "end every session but this one" — the one they are
   * standing at. The current session survives, or the command would log the
   * person performing it out of the device they are using.
   */
  app.post('/auth/logout-all', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const revoked = store.revokeUserSessions(result.auth.user.id, result.auth.session.id)
    store.audit('user_logout_all', null, null, { revoked }, Date.now(), { userId: result.auth.user.id })
    return c.json({ revoked })
  })

  /**
   * Changes the password.
   *
   * The current password is required: a session token alone must not be able
   * to take the account over. Every other session ends, because a password
   * change is usually a response to a credential being compromised.
   */
  app.post('/auth/password', async (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return Response.json({ error: 'request body too large' }, { status: 413 })
    const body = parsed.body as
      { currentPassword?: unknown; newPassword?: unknown } | null
    const current = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    const next = typeof body?.newPassword === 'string' ? body.newPassword : ''
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
      return Response.json(
        { error: `password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters` },
        { status: 400 },
      )
    }
    const valid = await Bun.password.verify(current, result.auth.user.password_hash).catch(() => false)
    if (!valid) {
      store.audit('user_password_change_failed', null, null, undefined, Date.now(), {
        userId: result.auth.user.id,
      })
      return Response.json({ error: 'invalid email or password' }, { status: 401 })
    }

    let hash: string
    try {
      hash = await Bun.password.hash(next)
    } catch {
      return Response.json({ error: 'could not secure the password' }, { status: 500 })
    }
    if (!store.updateUserPassword(result.auth.user.id, hash)) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    const revoked = store.revokeUserSessions(result.auth.user.id, result.auth.session.id)
    store.audit('user_password_changed', null, null, { revoked }, Date.now(), { userId: result.auth.user.id })
    return c.json({ ok: true, revoked })
  })

  /**
   * The account's own audit trail.
   *
   * The operator's view covers every account; a user asking what happened to
   * their own must not see anyone else's rows.
   */
  app.get('/auth/audit', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const limit = Math.min(Number(c.req.query('limit') ?? '50') || 50, 200)
    return c.json({ audit: store.listAuditForUser(result.auth.user.id, limit) })
  })

  app.get('/desktops', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    return c.json({
      desktops: store
        .listDesktops(result.auth.user.id)
        .filter((desktop) => !desktop.revoked_at)
        .map((desktop) => publicDesktop(desktop, isDesktopOnline(desktop.id))),
    })
  })

  /**
   * Enroll (or re-enroll) this computer.
   *
   * The caller supplies a stable installation id; logging out and back in on
   * the same machine therefore rotates one desktop's agent secret instead of
   * leaving an invisible duplicate behind.
   */
  app.post('/desktops', async (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return Response.json({ error: 'request body too large' }, { status: 413 })
    const body = parsed.body as
      { installationId?: unknown; name?: unknown; platform?: unknown } | null

    const installationId = installationIdOf(body?.installationId)
    if (!installationId) return Response.json({ error: 'invalid installation id' }, { status: 400 })
    const name = readText(body?.name, 80) || 'My computer'
    const platform = readText(body?.platform, 20) || 'desktop'

    // A token embeds the row id, so an existing installation keeps its id and
    // only the secret rotates; a new one gets a fresh id up front. A removed
    // installation is revived rather than duplicated — otherwise the old row's
    // devices stay revoked while the new row is unreachable under its old id.
    const existing = store.findDesktopByInstallation(result.auth.user.id, installationId)
    // Re-enrolling an installation the account already owns never counts
    // against the limit: it rotates one secret, it does not add a computer.
    const policy = store.getPolicy()
    if (!existing && policy.maxDesktopsPerUser > 0
      && store.countActiveDesktopsForUser(result.auth.user.id) >= policy.maxDesktopsPerUser) {
      store.audit('enroll_policy_denied', null, null, {
        reason: 'desktop-limit',
        limit: policy.maxDesktopsPerUser,
      }, Date.now(), { userId: result.auth.user.id })
      return Response.json({
        error: 'this account has reached its desktop limit (deployment policy)',
        code: 'policy-desktop-limit',
      }, { status: 403 })
    }
    const desktopId = existing?.id ?? crypto.randomUUID()
    const credential = issueDesktopToken(desktopId)
    const desktop = store.upsertDesktop({
      id: desktopId,
      userId: result.auth.user.id,
      installationId,
      name,
      platform,
      tokenHash: credential.hash,
    })
    const token = credential.token

    store.audit('desktop_enrolled', null, null, { name, platform }, Date.now(), {
      userId: result.auth.user.id,
      desktopId: desktop.id,
    })
    return c.json({
      desktop: {
        id: desktop.id,
        name: desktop.name,
        platform: desktop.platform,
        online: isDesktopOnline(desktop.id),
      },
      agentToken: token,
      gatewayUrl: gatewayUrl(c),
    })
  })

  app.delete('/desktops/:id', (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const id = c.req.param('id')
    const desktop = store.getDesktop(id)
    // Another user's desktop is reported as missing, not as forbidden.
    if (!desktop || desktop.user_id !== result.auth.user.id) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    store.revokeDesktop(id, result.auth.user.id)
    store.revokeDesktopDevices(id)
    // Dead credentials take their live sockets with them instead of serving
    // until the phone happens to reconnect.
    const deviceIds = store.listDesktopDevices(id).map(device => device.id)
    onDevicesRevoked(deviceIds)
    for (const device of store.listDesktopDevices(id)) {
      store.deleteDevicePushRegistrations(device.id)
    }
    store.audit('desktop_revoked', null, null, { devices: deviceIds }, Date.now(), {
      userId: result.auth.user.id,
      desktopId: id,
    })
    return c.json({ revoked: true, devices: deviceIds })
  })

  /**
   * Mint the device credential this phone will use for traffic.
   *
   * This is the endpoint both the QR flow and the automatic "same account"
   * flow call. It requires a real user session and a desktop owned by that
   * user, so a QR code is only an address, never a credential.
   */
  app.post('/desktops/:id/devices', async (c) => {
    const result = requireUser(c, store)
    if ('response' in result) return result.response
    const desktop = store.getDesktop(c.req.param('id'))
    if (!desktop || desktop.revoked_at || desktop.user_id !== result.auth.user.id) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    const parsed = await readJsonBody(c.req.raw)
    if (parsed.tooLarge) return Response.json({ error: 'request body too large' }, { status: 413 })
    const body = parsed.body as
      { installationId?: unknown; name?: unknown; platform?: unknown; scopes?: unknown; revive?: unknown } | null
    const installationId = installationIdOf(body?.installationId)
    if (!installationId) return Response.json({ error: 'invalid installation id' }, { status: 400 })

    const name = readText(body?.name, 80) || 'lumos phone'
    const platform = readText(body?.platform, 20) || 'android'
    // Reviving a revoked installation is a user gesture — the re-pair flow —
    // and only that flow sends it. A background "my token stopped working"
    // retry never does, which is what keeps an admin's revoke from healing
    // itself the moment the revoked phone notices.
    const revive = body?.revive === true
    const policy = store.getPolicy()
    // The installation being re-paired does not count against the limit: it
    // revives its own row instead of adding another device to the desktop.
    if (policy.maxDevicesPerDesktop > 0
      && store.countActiveDesktopDevices(desktop.id, installationId) >= policy.maxDevicesPerDesktop) {
      store.audit('provision_policy_denied', null, desktop.id, {
        reason: 'device-limit',
        limit: policy.maxDevicesPerDesktop,
        installationId,
      }, Date.now(), { userId: result.auth.user.id, desktopId: desktop.id })
      return Response.json({
        error: 'this computer has reached its device limit (deployment policy)',
        code: 'policy-device-limit',
      }, { status: 403 })
    }
    const requested = Array.isArray(body?.scopes)
      ? body.scopes.filter((scope): scope is Scope => typeof scope === 'string' && isScope(scope))
      : []
    const scopes = policyAllowsScopes(policy, requested.length > 0 ? requested : DEVICE_SCOPES)
    if (scopes.length === 0) {
      return Response.json({ error: 'no scopes allowed by deployment policy' }, { status: 400 })
    }

    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const tokenHash = new Bun.CryptoHasher('sha256').update(secret).digest('hex')
    const device = store.upsertDesktopDevice({
      userId: result.auth.user.id,
      desktopId: desktop.id,
      installationId,
      name,
      platform,
      tokenHash,
      scopesJson: JSON.stringify(scopes),
      allowRevived: revive,
    })
    if (!device) {
      return Response.json({
        error: 'this device was revoked on the computer; pair again to reconnect',
        code: 'device-revoked',
      }, { status: 403 })
    }
    const token = `dvc_${device.id}_${secret}`

    if (revive) {
      store.audit('device_revived', device.id, null, { platform, scopes }, Date.now(), {
        userId: result.auth.user.id,
        desktopId: desktop.id,
      })
    }
    store.audit('device_provisioned', device.id, null, { platform, scopes }, Date.now(), {
      userId: result.auth.user.id,
      desktopId: desktop.id,
    })

    store.audit('device_provisioned', device.id, null, { platform, scopes }, Date.now(), {
      userId: result.auth.user.id,
      desktopId: desktop.id,
    })
    return c.json({
      deviceId: device.id,
      deviceToken: token,
      desktopId: desktop.id,
      desktopName: desktop.name,
      gatewayUrl: gatewayUrl(c),
      scopes: deviceScopes(device),
    })
  })

  /**
   * What a device is allowed to reach.
   *
   * The phone can call this through the gateway even while the desktop is
   * offline: the answer comes from the gateway's own database, so a pairing
   * survives a computer that is asleep instead of being thrown away.
   */
  app.get('/device/me', (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return Response.json({ error: 'unauthorized' }, { status: 401 })
    store.touchDevice(device.id)

    const desktop = device.desktop_id ? store.getDesktop(device.desktop_id) : null
    return c.json({
      device: {
        id: device.id,
        name: device.name,
        platform: device.platform,
        scopes: deviceScopes(device),
        online: device.revoked_at === null,
      },
      desktop: desktop
        ? { id: desktop.id, name: desktop.name, online: isDesktopOnline(desktop.id) }
        : null,
      gatewayUrl: gatewayUrl(c),
    })
  })

  /**
   * Replaces this device's own token with a fresh one.
   *
   * Revoking was the only way to end a device credential, which meant a
   * leaked token cost the person their pairing: they had to sign in again and
   * pick the computer again. Rotation keeps the device and the pairing, and
   * changes only the secret — which is what a scheduled rotation, or a "this
   * token may have been seen" suspicion, actually calls for.
   *
   * The old token dies in the same transaction, so a copy of it is worthless
   * the moment this answers.
   */
  app.post('/device/rotate', (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return Response.json({ error: 'unauthorized' }, { status: 401 })
    if (device.revoked_at !== null) return Response.json({ error: 'device revoked' }, { status: 403 })

    const issued = issueDeviceToken(device.id)
    store.replaceDeviceToken(device.id, issued.hash)
    store.audit('device_rotated', device.id, device.desktop_id, undefined, Date.now(), {
      userId: device.user_id ?? null,
      desktopId: device.desktop_id ?? null,
    })
    return c.json({
      deviceId: device.id,
      deviceToken: issued.token,
      gatewayUrl: gatewayUrl(c),
      scopes: deviceScopes(device),
    })
  })

  /** The scopes a device token carries; exported for tests and diagnostics. */
  app.get('/device/scopes', (c) => {
    const device = authenticateRequest(c, store)
    if (!device) return Response.json({ error: 'unauthorized' }, { status: 401 })
    return c.json({
      scopes: deviceScopes(device),
      canRead: hasScope(device, 'sessions:read'),
      canWrite: hasScope(device, 'sessions:write'),
      canProxy: hasScope(device, 'proxy'),
    })
  })
}
