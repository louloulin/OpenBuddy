import { afterEach, describe, expect, test } from 'bun:test'

import {
  ADMIN_TOKEN,
  authHeader,
  enrollDesktop,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

const open: Harness[] = []

function gateway(overrides: Parameters<typeof startGateway>[0] = {}): Harness {
  const harness = startGateway(overrides)
  open.push(harness)
  return harness
}

afterEach(() => {
  for (const harness of open.splice(0)) harness.close()
})

describe('registration and login', () => {
  test('registering returns a session token and the account', async () => {
    const harness = gateway()
    const account = await registerUser(harness, { email: 'Alice@Example.com ' })

    expect(account.token.startsWith('usr_')).toBe(true)
    expect(account.user.email).toBe('alice@example.com')
    expect(account.user.displayName).toBe('Test User')

    const me = await fetch(`${harness.url}/auth/me`, { headers: authHeader(account.token) })
    expect(me.status).toBe(200)
    expect((await me.json() as { user: { email: string } }).user.email).toBe('alice@example.com')
  })

  test('the same email cannot register twice', async () => {
    const harness = gateway()
    await registerUser(harness, { email: 'a@example.com' })
    const again = await fetch(`${harness.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ' A@Example.com', password: 'another password' }),
    })
    expect(again.status).toBe(409)
  })

  test('weak passwords and malformed emails are rejected', async () => {
    const harness = gateway()
    const short = await fetch(`${harness.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'short' }),
    })
    expect(short.status).toBe(400)

    const badEmail = await fetch(`${harness.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'long enough password' }),
    })
    expect(badEmail.status).toBe(400)
  })

  test('registration can be turned off by the operator', async () => {
    const harness = gateway({ allowRegistration: false })
    const response = await fetch(`${harness.url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'long enough password' }),
    })
    expect(response.status).toBe(403)
  })

  test('login accepts the right password and rejects the wrong one', async () => {
    const harness = gateway()
    await registerUser(harness, { email: 'a@example.com', password: 'right password' })

    const wrong = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'wrong password' }),
    })
    expect(wrong.status).toBe(401)

    const right = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'right password' }),
    })
    expect(right.status).toBe(200)
    expect((await right.json() as { token: string }).token.startsWith('usr_')).toBe(true)
  })

  test('logout revokes only that session', async () => {
    const harness = gateway()
    const first = await registerUser(harness, { email: 'a@example.com' })
    const second = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    }).then((response) => response.json() as Promise<{ token: string }>)

    const logout = await fetch(`${harness.url}/auth/logout`, {
      method: 'POST',
      headers: authHeader(first.token),
    })
    expect(logout.status).toBe(200)

    const revoked = await fetch(`${harness.url}/auth/me`, { headers: authHeader(first.token) })
    expect(revoked.status).toBe(401)

    const stillValid = await fetch(`${harness.url}/auth/me`, { headers: authHeader(second.token) })
    expect(stillValid.status).toBe(200)
  })
})

describe('session management', () => {
  test('an account can list its live sessions and see which one it is using', async () => {
    const harness = gateway()
    const first = await registerUser(harness, { email: 'a@example.com' })
    const second = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    }).then((response) => response.json() as Promise<{ token: string }>)

    const listed = await fetch(`${harness.url}/auth/sessions`, { headers: authHeader(first.token) })
    expect(listed.status).toBe(200)
    const body = await listed.json() as {
      currentSessionId: string
      sessions: Array<{ id: string; current: boolean }>
    }
    expect(body.sessions).toHaveLength(2)
    expect(body.sessions.filter(session => session.current)).toHaveLength(1)
    expect(body.currentSessionId).toBe(body.sessions.find(session => session.current)!.id)
  })

  test('ending one session leaves the others alone', async () => {
    const harness = gateway()
    const first = await registerUser(harness, { email: 'a@example.com' })
    const second = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    }).then((response) => response.json() as Promise<{ token: string }>)

    const listed = await fetch(`${harness.url}/auth/sessions`, { headers: authHeader(first.token) })
      .then((response) => response.json() as Promise<{ sessions: Array<{ id: string; current: boolean }> }>)
    const other = listed.sessions.find(session => !session.current)!

    const removed = await fetch(`${harness.url}/auth/sessions/${other.id}`, {
      method: 'DELETE',
      headers: authHeader(first.token),
    })
    expect(removed.status).toBe(200)

    // The ended session stops working; the one performing the action does not.
    const revoked = await fetch(`${harness.url}/auth/me`, { headers: authHeader(second.token) })
    expect(revoked.status).toBe(401)
    const stillValid = await fetch(`${harness.url}/auth/me`, { headers: authHeader(first.token) })
    expect(stillValid.status).toBe(200)
  })

  test('an account cannot end another account\'s session', async () => {
    const harness = gateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const aliceSessions = await fetch(`${harness.url}/auth/sessions`, { headers: authHeader(alice.token) })
      .then((response) => response.json() as Promise<{ sessions: Array<{ id: string }> }>)

    const response = await fetch(`${harness.url}/auth/sessions/${aliceSessions.sessions[0]!.id}`, {
      method: 'DELETE',
      headers: authHeader(bob.token),
    })
    // Reported as missing, not as forbidden: Bob learns nothing about Alice.
    expect(response.status).toBe(404)

    const stillValid = await fetch(`${harness.url}/auth/me`, { headers: authHeader(alice.token) })
    expect(stillValid.status).toBe(200)
  })

  test('signing out everywhere keeps the session doing the signing out', async () => {
    const harness = gateway()
    const first = await registerUser(harness, { email: 'a@example.com' })
    const second = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    }).then((response) => response.json() as Promise<{ token: string }>)

    const response = await fetch(`${harness.url}/auth/logout-all`, {
      method: 'POST',
      headers: authHeader(first.token),
    })
    expect(response.status).toBe(200)
    expect((await response.json() as { revoked: number }).revoked).toBe(1)

    // The other session is gone; the caller keeps working.
    const revoked = await fetch(`${harness.url}/auth/me`, { headers: authHeader(second.token) })
    expect(revoked.status).toBe(401)
    const stillValid = await fetch(`${harness.url}/auth/me`, { headers: authHeader(first.token) })
    expect(stillValid.status).toBe(200)
  })
})

describe('login rate limiting', () => {
  test('the email limiter counts the address, not the address at an address', async () => {
    // The proxy header is trusted here so each attempt can come from a
    // different source: that is exactly the case a per-source key would miss.
    const harness = gateway({
      loginLimitPerMinute: 100,
      loginEmailLimitPerMinute: 2,
      trustProxy: true,
    })
    await registerUser(harness, { email: 'victim@example.com' })

    const attempt = (ip: string, email: string) => fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password: 'wrong password' }),
    }).then(response => response.status)

    expect(await attempt('10.0.0.1', 'victim@example.com')).toBe(401)
    expect(await attempt('10.0.0.2', 'victim@example.com')).toBe(401)
    // The third attempt is refused even though it comes from a fresh source.
    expect(await attempt('10.0.0.3', 'victim@example.com')).toBe(429)
    // Another account keeps its own bucket.
    expect(await attempt('10.0.0.4', 'other@example.com')).toBe(401)
  })
})

describe('password change', () => {
  test('the current password is required', async () => {
    const harness = gateway()
    const account = await registerUser(harness, { email: 'a@example.com' })

    const response = await fetch(`${harness.url}/auth/password`, {
      method: 'POST',
      headers: { ...authHeader(account.token), 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'not the password', newPassword: 'a whole new secret' }),
    })
    expect(response.status).toBe(401)

    // The old password still works.
    const login = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    })
    expect(login.status).toBe(200)
  })

  test('changing the password ends the other sessions and takes effect', async () => {
    const harness = gateway()
    const first = await registerUser(harness, { email: 'a@example.com' })
    const second = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    }).then((response) => response.json() as Promise<{ token: string }>)

    const changed = await fetch(`${harness.url}/auth/password`, {
      method: 'POST',
      headers: { ...authHeader(first.token), 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'correct horse battery', newPassword: 'a whole new secret' }),
    })
    expect(changed.status).toBe(200)
    expect((await changed.json() as { revoked: number }).revoked).toBe(1)

    // The other session is gone: a password change is what a person does when
    // a credential was compromised.
    const revoked = await fetch(`${harness.url}/auth/me`, { headers: authHeader(second.token) })
    expect(revoked.status).toBe(401)

    const oldPassword = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery' }),
    })
    expect(oldPassword.status).toBe(401)

    const newPassword = await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'a whole new secret' }),
    })
    expect(newPassword.status).toBe(200)
  })

  test('a weak new password is refused', async () => {
    const harness = gateway()
    const account = await registerUser(harness, { email: 'a@example.com' })
    const response = await fetch(`${harness.url}/auth/password`, {
      method: 'POST',
      headers: { ...authHeader(account.token), 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'correct horse battery', newPassword: 'short' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('per-account audit', () => {
  test('an account sees its own trail and nobody else\'s', async () => {
    const harness = gateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })

    const aliceAudit = await fetch(`${harness.url}/auth/audit`, { headers: authHeader(alice.token) })
    expect(aliceAudit.status).toBe(200)
    const rows = (await aliceAudit.json() as { audit: Array<{ action: string; user_id: string | null }> }).audit
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.user_id === null || row.user_id === alice.user.id)).toBe(true)
    expect(rows.some(row => row.action === 'user_registered')).toBe(true)

    // Bob's login must not appear in Alice's trail.
    await fetch(`${harness.url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'correct horse battery' }),
    })
    const again = await fetch(`${harness.url}/auth/audit`, { headers: authHeader(alice.token) })
      .then((response) => response.json() as Promise<{ audit: Array<{ user_id: string | null }> }>)
    expect(again.audit.every(row => row.user_id === null || row.user_id === alice.user.id)).toBe(true)
  })

  test('the account endpoints reject anonymous callers', async () => {
    const harness = gateway()
    for (const path of ['/auth/sessions', '/auth/audit']) {
      expect((await fetch(`${harness.url}${path}`)).status).toBe(401)
    }
    for (const path of ['/auth/logout-all', '/auth/password']) {
      expect((await fetch(`${harness.url}${path}`, { method: 'POST' })).status).toBe(401)
    }
  })
})

describe('desktop enrollment', () => {
  test('enrolling returns a desktop and its own agent credential', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const enrolled = await enrollDesktop(harness, account.token)

    expect(enrolled.desktop.id).toBeString()
    expect(enrolled.agentToken.startsWith(`dsk_${enrolled.desktop.id}_`)).toBe(true)
    expect(enrolled.gatewayUrl).toBe(harness.url)

    const list = await fetch(`${harness.url}/desktops`, { headers: authHeader(account.token) })
    const body = await list.json() as { desktops: Array<{ id: string; online: boolean }> }
    expect(body.desktops.map((desktop) => desktop.id)).toEqual([enrolled.desktop.id])
    // No agent is connected in this test.
    expect(body.desktops[0]!.online).toBe(false)
  })

  test('logging in again from the same installation rotates one desktop', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const first = await enrollDesktop(harness, account.token, { installationId: 'machine-a' })
    const second = await enrollDesktop(harness, account.token, { installationId: 'machine-a' })

    expect(second.desktop.id).toBe(first.desktop.id)
    expect(second.agentToken).not.toBe(first.agentToken)

    const list = await fetch(`${harness.url}/desktops`, { headers: authHeader(account.token) })
    expect((await list.json() as { desktops: unknown[] }).desktops).toHaveLength(1)
  })

  test('re-enrolling after removal revives the same desktop and keeps its id', async () => {
    // A new row would leave the agent credential pointing at an id that no
    // device can route to, so the tunnel would look connected and answer 503.
    const harness = gateway()
    const account = await registerUser(harness)
    const first = await enrollDesktop(harness, account.token, { installationId: 'machine-a' })

    await fetch(`${harness.url}/desktops/${first.desktop.id}`, {
      method: 'DELETE',
      headers: authHeader(account.token),
    })

    const again = await enrollDesktop(harness, account.token, { installationId: 'machine-a' })
    expect(again.desktop.id).toBe(first.desktop.id)
    expect(again.agentToken.startsWith(`dsk_${first.desktop.id}_`)).toBe(true)

    const list = await fetch(`${harness.url}/desktops`, { headers: authHeader(account.token) })
    expect((await list.json() as { desktops: unknown[] }).desktops).toHaveLength(1)
  })

  test('two installations are two desktops', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const first = await enrollDesktop(harness, account.token, { installationId: 'machine-a' })
    const second = await enrollDesktop(harness, account.token, { installationId: 'machine-b' })

    expect(second.desktop.id).not.toBe(first.desktop.id)
    const list = await fetch(`${harness.url}/desktops`, { headers: authHeader(account.token) })
    expect((await list.json() as { desktops: unknown[] }).desktops).toHaveLength(2)
  })

  test('desktops are invisible to another account', async () => {
    const harness = gateway()
    const alice = await registerUser(harness, { email: 'alice@example.com' })
    const bob = await registerUser(harness, { email: 'bob@example.com' })
    const desktop = await enrollDesktop(harness, alice.token)

    const list = await fetch(`${harness.url}/desktops`, { headers: authHeader(bob.token) })
    expect((await list.json() as { desktops: unknown[] }).desktops).toEqual([])

    const provision = await fetch(`${harness.url}/desktops/${desktop.desktop.id}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(bob.token) },
      body: JSON.stringify({ installationId: 'bob-phone', name: 'Bob Phone' }),
    })
    expect(provision.status).toBe(404)
  })

  test('removing a desktop revokes its devices', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.desktop.id)

    const removed = await fetch(`${harness.url}/desktops/${desktop.desktop.id}`, {
      method: 'DELETE',
      headers: authHeader(account.token),
    })
    expect(removed.status).toBe(200)

    const me = await fetch(`${harness.url}/device/me`, { headers: authHeader(device.deviceToken) })
    expect(me.status).toBe(401)
  })
})

describe('device provisioning', () => {
  test('a provisioned device knows which desktop it belongs to', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.desktop.id)

    expect(device.deviceToken.startsWith(`dvc_${device.deviceId}_`)).toBe(true)
    expect(device.desktopId).toBe(desktop.desktop.id)
    expect(device.scopes).toContain('sessions:read')

    const me = await fetch(`${harness.url}/device/me`, { headers: authHeader(device.deviceToken) })
    expect(me.status).toBe(200)
    const body = await me.json() as {
      device: { id: string; scopes: string[] }
      desktop: { id: string; online: boolean } | null
    }
    expect(body.device.id).toBe(device.deviceId)
    expect(body.desktop?.id).toBe(desktop.desktop.id)
    expect(body.desktop?.online).toBe(false)
  })

  test('re-provisioning the same installation rotates the token for one row', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const first = await provisionDevice(harness, account.token, desktop.desktop.id)
    const second = await provisionDevice(harness, account.token, desktop.desktop.id)

    expect(second.deviceId).toBe(first.deviceId)
    expect(second.deviceToken).not.toBe(first.deviceToken)

    const oldToken = await fetch(`${harness.url}/device/me`, { headers: authHeader(first.deviceToken) })
    expect(oldToken.status).toBe(401)
    const newToken = await fetch(`${harness.url}/device/me`, { headers: authHeader(second.deviceToken) })
    expect(newToken.status).toBe(200)
  })

  test('two phones are two devices', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const first = await provisionDevice(harness, account.token, desktop.desktop.id, { installationId: 'phone-aaaa' })
    const second = await provisionDevice(harness, account.token, desktop.desktop.id, { installationId: 'phone-bbbb' })

    expect(second.deviceId).not.toBe(first.deviceId)
  })

  test('scopes are validated and default to the phone set', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.desktop.id, {
      scopes: ['sessions:read', 'not-a-scope'],
    })

    expect(device.scopes).toEqual(['sessions:read'])
  })

  test('a missing installation id is rejected', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const response = await fetch(`${harness.url}/desktops/${desktop.desktop.id}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(account.token) },
      body: JSON.stringify({ name: 'No installation' }),
    })
    expect(response.status).toBe(400)
  })

  test('account endpoints reject anonymous callers', async () => {
    const harness = gateway()
    expect((await fetch(`${harness.url}/desktops`)).status).toBe(401)
    expect((await fetch(`${harness.url}/auth/me`)).status).toBe(401)
    expect((await fetch(`${harness.url}/device/me`)).status).toBe(401)
  })
})

describe('revocation is not self-healing', () => {
  async function revoke(harness: Harness, deviceId: string): Promise<void> {
    const response = await fetch(`${harness.url}/admin/devices/${deviceId}/revoke`, {
      method: 'POST',
      headers: authHeader(ADMIN_TOKEN),
    })
    expect(response.ok).toBe(true)
  }

  test('a revoked installation cannot re-provision itself in the background', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const first = await provisionDevice(harness, account.token, desktop.desktop.id)
    await revoke(harness, first.deviceId)

    // The revoked credential dies immediately.
    expect((await fetch(`${harness.url}/device/me`, { headers: authHeader(first.deviceToken) })).status).toBe(401)

    // A background retry (what gatewayRecovery does) carries no `revive` flag,
    // so the gateway refuses and the phone falls back to the sign-in screen
    // instead of silently resurrecting a pairing the computer removed.
    const silent = await fetch(`${harness.url}/desktops/${desktop.desktop.id}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(account.token) },
      body: JSON.stringify({
        installationId: 'installation-phone-1',
        name: 'Test Phone',
        platform: 'android',
      }),
    })
    expect(silent.status).toBe(403)
    expect((await silent.json() as { code?: string }).code).toBe('device-revoked')
  })

  test('an explicit revive from a pairing gesture reconnects the installation', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const first = await provisionDevice(harness, account.token, desktop.desktop.id)
    await revoke(harness, first.deviceId)

    // Sign-in, the picker, and the wait screen all count as the user asking to
    // pair with this computer again, so they may revive.
    const revived = await provisionDevice(harness, account.token, desktop.desktop.id, { revive: true })
    expect(revived.deviceToken).not.toBe(first.deviceToken)
    expect((await fetch(`${harness.url}/device/me`, { headers: authHeader(revived.deviceToken) })).status).toBe(200)
  })

  test('reviving leaves a device_revived audit entry', async () => {
    const harness = gateway()
    const account = await registerUser(harness)
    const desktop = await enrollDesktop(harness, account.token)
    const first = await provisionDevice(harness, account.token, desktop.desktop.id)
    await revoke(harness, first.deviceId)
    await provisionDevice(harness, account.token, desktop.desktop.id, { revive: true })

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader(ADMIN_TOKEN) })
    const entries = await audit.json() as { audit: Array<{ action: string }> }
    expect(entries.audit.some((entry) => entry.action === 'device_revived')).toBe(true)
  })
})
