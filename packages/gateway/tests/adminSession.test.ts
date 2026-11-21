import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_COOKIE, ADMIN_CSRF_HEADER } from '../src/auth.js'
import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * The console's credential.
 *
 * Two properties matter and are defended here: an administrator gets a session
 * cookie that a page script cannot read, and every write that relies on that
 * cookie must prove the caller could read the console's own script. The shared
 * token keeps working throughout — it is the way back in.
 */

const open: Harness[] = []

function gateway(overrides: Parameters<typeof startGateway>[0] = {}): Harness {
  const harness = startGateway(overrides)
  open.push(harness)
  return harness
}

afterEach(() => {
  for (const harness of open.splice(0)) harness.close()
})

async function createAdmin(harness: Harness, email = 'admin@example.com', password = 'a good password') {
  const user = harness.gateway.store.createUser({
    id: crypto.randomUUID(),
    email,
    passwordHash: await Bun.password.hash(password),
    displayName: null,
    role: 'admin',
  })
  return { user, email, password }
}

/** Signs in and returns the cookie value plus the raw Set-Cookie header. */
async function signIn(harness: Harness, email: string, password: string) {
  const response = await fetch(`${harness.url}/admin/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return { response, cookie: extractCookie(response.headers.get('set-cookie')) }
}

function extractCookie(header: string | null): string | null {
  if (!header) return null
  const match = new RegExp(`${ADMIN_COOKIE}=([^;]+)`).exec(header)
  return match ? `${ADMIN_COOKIE}=${match[1]}` : null
}

describe('admin sign-in', () => {
  test('an administrator gets an HttpOnly, Strict cookie and their identity', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { response, cookie } = await signIn(harness, admin.email, admin.password)

    expect(response.status).toBe(200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(cookie).not.toBeNull()

    const body = (await response.json()) as { user: { email: string; role: string } }
    expect(body.user.email).toBe(admin.email)
    expect(body.user.role).toBe('admin')

    const me = await fetch(`${harness.url}/admin/session`, { headers: { cookie: cookie! } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { kind: string }).kind).toBe('session')
  })

  test('a code minted from the console is attributed to the signed-in admin', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { cookie } = await signIn(harness, admin.email, admin.password)

    const response = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: {
        cookie: cookie!,
        [ADMIN_CSRF_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ scopes: ['sessions:read'] }),
    })
    expect(response.status).toBe(200)

    const row = harness.gateway.store.listAudit(20).find(entry => entry.action === 'pair_started')
    // The actor is the console user, not the desktop owner (a shared code has
    // no desktop at all, so the old attribution was simply absent).
    expect(row?.user_id).toBe(admin.user.id)
  })

  test('an ordinary account is refused, and the answer does not reveal that it exists', async () => {
    const harness = gateway()
    harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'user@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'user',
    })

    const ordinary = await signIn(harness, 'user@example.com', 'a good password')
    const missing = await signIn(harness, 'nobody@example.com', 'a good password')
    expect(ordinary.response.status).toBe(401)
    expect(missing.response.status).toBe(401)
    // Same message for both: no account oracle.
    expect(await ordinary.response.json()).toEqual(await missing.response.json())
  })

  test('a wrong password is refused and recorded', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { response } = await signIn(harness, admin.email, 'not the password')
    expect(response.status).toBe(401)

    const actions = harness.gateway.store.listAudit(10).map(row => row.action)
    expect(actions).toContain('admin_login_failed')
  })

  test('repeated failures are rate limited', async () => {
    const harness = gateway({ loginLimitPerMinute: 3 })
    const admin = await createAdmin(harness)
    const statuses: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await signIn(harness, admin.email, 'wrong')).response.status)
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
    expect(statuses[3]).toBe(429)
  })

  test('the shared admin token still works, with no account behind it', async () => {
    const harness = gateway()
    const response = await fetch(`${harness.url}/admin/session`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { kind: string; user: unknown }
    expect(body.kind).toBe('token')
    expect(body.user).toBeNull()
  })

  test('a user session token is not an admin credential', async () => {
    const harness = gateway()
    harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'user@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'user',
    })
    const login = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'a good password' }),
    })
    const { token } = (await login.json()) as { token: string }

    const response = await fetch(`${harness.url}/admin/overview`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(401)
  })
})

describe('CSRF', () => {
  test('a cookie-authenticated write without the header is refused', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { cookie } = await signIn(harness, admin.email, admin.password)

    const withoutHeader = await fetch(`${harness.url}/admin/devices/anything/revoke`, {
      method: 'POST',
      headers: { cookie: cookie! },
    })
    expect(withoutHeader.status).toBe(403)

    const withHeader = await fetch(`${harness.url}/admin/devices/anything/revoke`, {
      method: 'POST',
      headers: { cookie: cookie!, [ADMIN_CSRF_HEADER]: '1' },
    })
    // Past the CSRF gate, and then the device genuinely does not exist.
    expect(withHeader.status).toBe(404)
  })

  test('a bearer credential needs no CSRF header', async () => {
    const harness = gateway()
    const response = await fetch(`${harness.url}/admin/devices/anything/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(response.status).toBe(404)
  })

  test('reads never require it', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { cookie } = await signIn(harness, admin.email, admin.password)
    const response = await fetch(`${harness.url}/admin/overview`, { headers: { cookie: cookie! } })
    expect(response.status).toBe(200)
  })
})

describe('sign-out', () => {
  test('ends the session and clears the cookie', async () => {
    const harness = gateway()
    const admin = await createAdmin(harness)
    const { cookie } = await signIn(harness, admin.email, admin.password)

    const out = await fetch(`${harness.url}/admin/session`, {
      method: 'DELETE',
      headers: { cookie: cookie!, [ADMIN_CSRF_HEADER]: '1' },
    })
    expect(out.status).toBe(200)

    const after = await fetch(`${harness.url}/admin/session`, { headers: { cookie: cookie! } })
    expect(after.status).toBe(401)
  })
})
