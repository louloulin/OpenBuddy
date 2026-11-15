import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

import {
  deviceScopes,
  type DesktopRow,
  type DeviceRow,
  type Store,
  type UserRow,
  type UserSessionRow,
} from './store.js'

export const SCOPES = ['sessions:read', 'sessions:write', 'approve', 'proxy'] as const
export type Scope = (typeof SCOPES)[number]

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value)
}

export function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

/** Constant-time comparison for short secrets (hashes / codes). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : null
}

/**
 * Device tokens are `dvc_<id>_<secret>`: the id is a lookup key, the secret is
 * only stored as a hash so a database leak does not yield usable credentials.
 */
export function issueDeviceToken(deviceId: string): { token: string; hash: string } {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  return { token: `dvc_${deviceId}_${secret}`, hash: sha256(secret) }
}

export function parseDeviceToken(token: string): { id: string; secret: string } | null {
  const match = /^dvc_([0-9a-f-]{8,64})_(.+)$/i.exec(token)
  return match ? { id: match[1]!, secret: match[2]! } : null
}

export function authenticateToken(token: string | null, store: Store): DeviceRow | null {
  if (!token) return null
  const parsed = parseDeviceToken(token)
  if (!parsed) return null
  const device = store.getDevice(parsed.id)
  if (!device || device.revoked_at) return null
  if (!safeEqual(device.token_hash, sha256(parsed.secret))) return null
  return device
}

export function authenticateRequest(c: Context, store: Store): DeviceRow | null {
  return authenticateToken(bearerToken(c.req.header('authorization')), store)
}

/** True when the device carries the scope. `sessions:write` implies reads. */
export function hasScope(device: DeviceRow, scope: Scope): boolean {
  const scopes = deviceScopes(device)
  if (scopes.includes(scope)) return true
  return scope === 'sessions:read' && scopes.includes('sessions:write')
}

// ── Account sessions ─────────────────────────────────────────
//
// A user session is the credential the desktop and the phone use to ask the
// gateway about *the account* (which desktops exist, mint this installation's
// device token). The device token remains the credential used for traffic, so
// signing out never breaks a phone that is already paired.

export function issueUserSession(userId: string): { sessionId: string; token: string; hash: string } {
  const sessionId = crypto.randomUUID()
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  return { sessionId, token: `usr_${sessionId}_${secret}`, hash: sha256(secret) }
}

export function parseUserToken(token: string): { id: string; secret: string } | null {
  const match = /^usr_([0-9a-f-]{8,64})_(.+)$/i.exec(token)
  return match ? { id: match[1]!, secret: match[2]! } : null
}

export type AuthenticatedUser = { session: UserSessionRow; user: UserRow }

export function authenticateUserToken(
  token: string | null,
  store: Store,
  now = Date.now(),
): AuthenticatedUser | null {
  if (!token) return null
  const parsed = parseUserToken(token)
  if (!parsed) return null
  const session = store.getUserSession(parsed.id)
  if (!session || session.revoked_at) return null
  if (session.expires_at <= now) return null
  if (!safeEqual(session.token_hash, sha256(parsed.secret))) return null
  const user = store.getUser(session.user_id)
  if (!user || user.disabled_at) return null
  return { session, user }
}

export function authenticateUser(c: Context, store: Store): AuthenticatedUser | null {
  return authenticateUserToken(bearerToken(c.req.header('authorization')), store)
}

// ── Admin console credentials ────────────────────────────────
//
// The console has to answer "who did this" for dangerous operations, which a
// single shared token cannot. So an admin is an ordinary account with
// `role = 'admin'`, and the shared token survives as break-glass: CI, a script,
// or the one boot before any account exists.

/** Name of the cookie the console's browser session rides in. */
export const ADMIN_COOKIE = 'lumos_admin'
/**
 * Header a cookie-authenticated write must carry.
 *
 * The cookie is `SameSite=Strict`, but that is not a CSRF proof on its own —
 * same-site includes sibling subdomains. A custom header is: cross-origin
 * script cannot set one without a CORS preflight the gateway never approves,
 * and an HTML form cannot set one at all.
 */
export const ADMIN_CSRF_HEADER = 'x-admin-csrf'

export function isAdminUser(user: UserRow): boolean {
  return user.role === 'admin' && user.disabled_at === null
}

export type AdminPrincipal =
  /** The shared `GATEWAY_ADMIN_TOKEN`: break-glass, no account, no session. */
  | { kind: 'token' }
  | { kind: 'session'; user: UserRow; session: UserSessionRow }

/**
 * Resolves the admin credential on a request, most specific first.
 *
 * A `usr_` token and the cookie both resolve to an account, so the console can
 * attribute an action; the shared token resolves to nothing but still works so
 * an operator locked out of the database is never locked out of the gateway.
 */
export function authenticateAdminCredential(
  c: Context,
  store: Store,
  adminToken: string,
): AdminPrincipal | null {
  const bearer = bearerToken(c.req.header('authorization'))
  if (bearer) {
    if (safeEqual(bearer, adminToken)) return { kind: 'token' }
    const session = authenticateUserToken(bearer, store)
    if (session && isAdminUser(session.user)) {
      return { kind: 'session', user: session.user, session: session.session }
    }
    return null
  }

  const cookie = getCookie(c, ADMIN_COOKIE)
  if (!cookie) return null
  const session = authenticateUserToken(cookie, store)
  if (!session || !isAdminUser(session.user)) return null
  return { kind: 'session', user: session.user, session: session.session }
}

/**
 * True when a cookie-authenticated write is missing its CSRF header.
 *
 * Applied as middleware over `/admin/*` rather than per handler: a new admin
 * route added later inherits the check without anyone remembering to copy it,
 * which is the only way this stays true. Bearer credentials are exempt — they
 * are not ambient, so a cross-site page cannot make a browser present one.
 */
export function isAdminCsrfViolation(c: Context, adminToken: string, store: Store): boolean {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  // A bearer credential of any kind means the caller is not relying on an
  // ambient cookie; nothing to forge.
  if (bearerToken(c.req.header('authorization'))) return false
  // An admin token in the legacy header is likewise deliberate.
  const legacy = c.req.header('x-admin-token')
  if (legacy && safeEqual(legacy, adminToken)) return false
  const principal = authenticateAdminCredential(c, store, adminToken)
  if (principal?.kind !== 'session') return false
  // Only a session that actually arrived via the cookie is ambient. A `usr_`
  // bearer token already returned above.
  return c.req.header(ADMIN_CSRF_HEADER) !== '1'
}

// ── Desktop (agent) credentials ──────────────────────────────
//
// Each desktop enrolls once and receives its own secret. Unlike the old shared
// agent token, this is what lets the gateway route a phone to exactly one
// computer and revoke one machine without disturbing the others.

export function issueDesktopToken(desktopId: string): { token: string; hash: string } {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  return { token: `dsk_${desktopId}_${secret}`, hash: sha256(secret) }
}

export function parseDesktopToken(token: string): { id: string; secret: string } | null {
  const match = /^dsk_([0-9a-f-]{8,64})_(.+)$/i.exec(token)
  return match ? { id: match[1]!, secret: match[2]! } : null
}

export function authenticateDesktopToken(token: string | null, store: Store): DesktopRow | null {
  if (!token) return null
  const parsed = parseDesktopToken(token)
  if (!parsed) return null
  const desktop = store.getDesktop(parsed.id)
  if (!desktop || desktop.revoked_at) return null
  if (!safeEqual(desktop.token_hash, sha256(parsed.secret))) return null
  return desktop
}
