import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_CSRF_HEADER } from '../src/auth.js'
import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * Who may administer the gateway.
 *
 * The one rule that must never bend: a running gateway always keeps at least one
 * administrator who can sign in. A console that could demote the last admin
 * would lock its operator out of the machine they are standing at.
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

const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` }

async function createAdmin(
  harness: Harness,
  body: { email: string; password?: string; displayName?: string },
) {
  return fetch(`${harness.url}/admin/admins`, {
    method: 'POST',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin lifecycle', () => {
  test('an administrator can be created and immediately sign in', async () => {
    const harness = gateway()
    const created = await createAdmin(harness, {
      email: 'Owner@Example.com',
      password: 'a good password',
      displayName: 'Owner',
    })
    expect(created.status).toBe(201)
    const { admin } = (await created.json()) as { admin: { email: string; role: string; displayName: string } }
    expect(admin.email).toBe('owner@example.com')
    expect(admin.role).toBe('admin')
    expect(admin.displayName).toBe('Owner')

    const login = await fetch(`${harness.url}/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'a good password' }),
    })
    expect(login.status).toBe(200)
  })

  test('an existing account is never silently promoted', async () => {
    const harness = gateway()
    harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'existing@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'user',
    })
    const response = await createAdmin(harness, {
      email: 'existing@example.com',
      password: 'another password',
    })
    expect(response.status).toBe(409)
    expect(harness.gateway.store.getUserByEmail('existing@example.com')?.role).toBe('user')
  })

  test('a short password is refused', async () => {
    const harness = gateway()
    const response = await createAdmin(harness, { email: 'a@example.com', password: 'short' })
    expect(response.status).toBe(400)
  })

  test('demoting an administrator ends their console sessions', async () => {
    const harness = gateway()
    const first = (await (await createAdmin(harness, {
      email: 'first@example.com',
      password: 'a good password',
    })).json()) as { admin: { id: string } }
    await createAdmin(harness, { email: 'second@example.com', password: 'a good password' })

    // Sign the first one in, then demote them.
    const login = await fetch(`${harness.url}/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'first@example.com', password: 'a good password' }),
    })
    const cookie = /lumos_admin=[^;]+/.exec(login.headers.get('set-cookie') ?? '')![0]

    const demoted = await fetch(`${harness.url}/admin/admins/${first.admin.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    })
    expect(demoted.status).toBe(200)
    const body = (await demoted.json()) as { demoted: boolean; revokedSessions: number }
    expect(body.demoted).toBe(true)
    expect(body.revokedSessions).toBe(1)

    // The cookie they were holding no longer opens anything.
    const after = await fetch(`${harness.url}/admin/session`, { headers: { cookie } })
    expect(after.status).toBe(401)
  })

  test('the last administrator cannot be demoted', async () => {
    const harness = gateway()
    const user = harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'only@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'admin',
    })

    const response = await fetch(`${harness.url}/admin/admins/${user.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain('last administrator')
    // Still an admin, still able to sign in.
    expect(harness.gateway.store.getUser(user.id)?.role).toBe('admin')
  })

  test('a disabled administrator does not count toward the last-admin guard', async () => {
    const harness = gateway()
    const enabled = harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'enabled@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'admin',
    })
    const disabled = harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'disabled@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'admin',
    })
    // A disabled account cannot sign in, so it must not be the reason a
    // demotion is allowed. There is no public way to disable an account yet, so
    // this reaches the database the way a future admin endpoint would.
    harness.gateway.store.disableUser(disabled.id)

    expect(harness.gateway.store.countAdmins()).toBe(1)

    const demote = await fetch(`${harness.url}/admin/admins/${enabled.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    })
    expect(demote.status).toBe(400)
  })
})

describe('role column migration', () => {
  test('a database written before roles existed opens with everyone as a user', async () => {
    // Simulate an old row: the migration must supply the column default rather
    // than leaving the account with a NULL role that breaks every check.
    const harness = gateway()
    const user = harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'old@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
    })
    expect(user.role).toBe('user')
    expect(harness.gateway.store.schemaVersion()).toBeGreaterThanOrEqual(4)
  })
})

describe('CSRF on admin management', () => {
  test('creating an admin through a cookie needs the CSRF header', async () => {
    const harness = gateway()
    const admin = harness.gateway.store.createUser({
      id: crypto.randomUUID(),
      email: 'me@example.com',
      passwordHash: await Bun.password.hash('a good password'),
      displayName: null,
      role: 'admin',
    })
    const login = await fetch(`${harness.url}/admin/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'me@example.com', password: 'a good password' }),
    })
    const cookie = /lumos_admin=[^;]+/.exec(login.headers.get('set-cookie') ?? '')![0]

    const refused = await fetch(`${harness.url}/admin/admins`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', password: 'a good password' }),
    })
    expect(refused.status).toBe(403)

    const allowed = await fetch(`${harness.url}/admin/admins`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', [ADMIN_CSRF_HEADER]: '1' },
      body: JSON.stringify({ email: 'other@example.com', password: 'a good password' }),
    })
    expect(allowed.status).toBe(201)
    expect(harness.gateway.store.getUserByEmail('other@example.com')?.role).toBe('admin')
    void admin
  })
})
