import { afterEach, describe, expect, test } from 'bun:test'

import { SCOPES } from '../src/auth.js'
import { DEFAULT_POLICY, SUPPORTED_SCOPES, parsePolicy, type GatewayPolicy } from '../src/policy.js'
import {
  ADMIN_TOKEN,
  authHeader,
  enrollDesktop,
  pairDevice,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

function getPolicy(h: Harness, token = ADMIN_TOKEN): Promise<Response> {
  return fetch(`${h.url}/admin/policy`, { headers: authHeader(token) })
}

function putPolicy(h: Harness, body: unknown): Promise<Response> {
  return fetch(`${h.url}/admin/policy`, {
    method: 'PUT',
    headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A full policy body; PUT replaces the whole object, it does not merge. */
function fullPolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pairingEnabled: true,
    allowSharedRoute: true,
    maxDevicesPerDesktop: 0,
    maxDesktopsPerUser: 0,
    allowedScopes: ['sessions:read', 'sessions:write', 'approve', 'proxy'],
    disabledTools: [],
    allowedBrowserSites: [],
    ...overrides,
  }
}

describe('policy', () => {
  test('the local scope list stays pinned to the auth source of truth', () => {
    expect(SUPPORTED_SCOPES).toEqual([...SCOPES])
    expect(DEFAULT_POLICY.allowedScopes).toEqual([...SCOPES])
    expect(DEFAULT_POLICY.disabledTools).toEqual([])
    expect(DEFAULT_POLICY.allowedBrowserSites).toEqual([])
  })

  test('a stored policy from before the desktop-only fields keeps its other fields', () => {
    const legacy: Omit<GatewayPolicy, 'disabledTools' | 'allowedBrowserSites'> = {
      pairingEnabled: false,
      allowSharedRoute: false,
      maxDevicesPerDesktop: 3,
      maxDesktopsPerUser: 2,
      allowedScopes: ['sessions:read'],
    }

    expect(parsePolicy(legacy)).toEqual({
      ...legacy,
      disabledTools: [],
      allowedBrowserSites: [],
    })
  })

  test('the tool denylist round-trips and is readable by a device', async () => {
    harness = startGateway()
    const next = fullPolicy({ disabledTools: ['Bash', 'Edit'] })
    expect((await putPolicy(harness, next)).status).toBe(200)

    const device = await pairDevice(harness)
    const res = await fetch(`${harness.url}/policy`, { headers: authHeader(device.deviceToken) })
    const { policy } = await res.json() as { policy: { disabledTools: string[] } }
    expect(policy.disabledTools).toEqual(['Bash', 'Edit'])
  })

  test('tool names are trimmed and deduplicated, keeping first-seen order', () => {
    expect(parsePolicy(fullPolicy({ disabledTools: [' Bash ', 'Edit', 'Bash', 'Edit'] }))?.disabledTools)
      .toEqual(['Bash', 'Edit'])
  })

  test('invalid tool denylists are refused', async () => {
    harness = startGateway()
    for (const disabledTools of [
      'Bash',
      [1],
      [''],
      ['   '],
      [null],
      ['Bash\nEdit'],
      ['x'.repeat(129)],
      Array.from({ length: 201 }, (_, index) => `Tool${index}`),
    ]) {
      const res = await putPolicy(harness, fullPolicy({ disabledTools }))
      expect(res.status).toBe(400)
    }
    const { policy } = await (await getPolicy(harness)).json() as { policy: { disabledTools: string[] } }
    expect(policy.disabledTools).toEqual([])
  })

  test('the browser allowlist round-trips to a device', async () => {
    harness = startGateway()
    const sites = ['example.com', '*.example.org', 'https://docs.example.net/guide']
    expect((await putPolicy(harness, fullPolicy({ allowedBrowserSites: sites }))).status).toBe(200)

    const device = await pairDevice(harness)
    const res = await fetch(`${harness.url}/policy`, { headers: authHeader(device.deviceToken) })
    const { policy } = await res.json() as { policy: { allowedBrowserSites: string[] } }
    expect(policy.allowedBrowserSites).toEqual(sites)
  })

  test('browser site entries are trimmed and deduplicated case-insensitively', () => {
    expect(parsePolicy(fullPolicy({
      allowedBrowserSites: [' Example.com ', 'example.com', 'EXAMPLE.com'],
    }))?.allowedBrowserSites).toEqual(['Example.com'])
  })

  test('invalid browser allowlists are refused', async () => {
    harness = startGateway()
    for (const allowedBrowserSites of [
      'example.com',
      [1],
      [''],
      ['   '],
      [null],
      ['exa mple.com'],
      ['file:///etc/passwd'],
      ['javascript:alert(1)'],
      [`https://${'a'.repeat(501)}.com`],
      Array.from({ length: 201 }, (_, index) => `site${index}.example`),
    ]) {
      const res = await putPolicy(harness, fullPolicy({ allowedBrowserSites }))
      expect(res.status).toBe(400)
    }
    const { policy } = await (await getPolicy(harness)).json() as {
      policy: { allowedBrowserSites: string[] }
    }
    expect(policy.allowedBrowserSites).toEqual([])
  })

  test('reading the policy requires a credential', async () => {
    harness = startGateway()
    const res = await fetch(`${harness.url}/policy`)
    expect(res.status).toBe(401)
  })

  test('a paired device reads the default policy', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)
    const res = await fetch(`${harness.url}/policy`, { headers: authHeader(device.deviceToken) })
    expect(res.status).toBe(200)
    const { policy } = await res.json() as { policy: { pairingEnabled: boolean; maxDevicesPerDesktop: number } }
    expect(policy.pairingEnabled).toBe(true)
    expect(policy.maxDevicesPerDesktop).toBe(0)
  })

  test('the admin reads the policy and its metadata', async () => {
    harness = startGateway()
    const res = await getPolicy(harness)
    expect(res.status).toBe(200)
    const { policy, defaults, meta } = await res.json() as {
      policy: object
      defaults: object
      meta: object | null
    }
    expect(policy).toEqual(defaults)
    expect(meta).toBeNull()
  })

  test('updating the policy persists, records the actor time, and audits', async () => {
    harness = startGateway()
    const next = fullPolicy({ allowSharedRoute: false, maxDevicesPerDesktop: 2, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] })
    const put = await putPolicy(harness, next)
    expect(put.status).toBe(200)

    const { policy, meta } = await (await getPolicy(harness)).json() as {
      policy: { allowSharedRoute: boolean; maxDevicesPerDesktop: number }
      meta: { updatedAt: number; updatedBy: string | null } | null
    }
    expect(policy.allowSharedRoute).toBe(false)
    expect(policy.maxDevicesPerDesktop).toBe(2)
    expect(meta?.updatedAt).toBeGreaterThan(0)

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader(ADMIN_TOKEN) })
    const { audit: events } = await audit.json() as { audit: Array<{ action: string }> }
    expect(events.some(event => event.action === 'policy_updated')).toBe(true)
  })

  test('an invalid policy is refused without changing anything', async () => {
    harness = startGateway()
    for (const body of [
      { pairingEnabled: 'yes' },
      { pairingEnabled: true, allowSharedRoute: true, maxDevicesPerDesktop: -1 },
      { pairingEnabled: true, allowSharedRoute: true, maxDevicesPerDesktop: 0, maxDesktopsPerUser: 0, allowedScopes: ['root'] },
      { pairingEnabled: true, allowSharedRoute: true, maxDevicesPerDesktop: 0, maxDesktopsPerUser: 0, allowedScopes: [] },
      'not an object',
    ]) {
      const res = await putPolicy(harness, body)
      expect(res.status).toBe(400)
    }
    // Defaults survived every rejected write.
    const { policy } = await (await getPolicy(harness)).json() as { policy: { pairingEnabled: boolean } }
    expect(policy.pairingEnabled).toBe(true)
  })

  test('the pairing kill switch blocks pair/start', async () => {
    harness = startGateway()
    expect((await putPolicy(harness, { ...fullPolicy(), pairingEnabled: false })).status).toBe(200)

    const start = await fetch(`${harness.url}/pair/start`, { method: 'POST', headers: authHeader(ADMIN_TOKEN) })
    expect(start.status).toBe(403)

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader(ADMIN_TOKEN) })
    const { audit: events } = await audit.json() as { audit: Array<{ action: string }> }
    expect(events.some(event => event.action === 'pair_policy_denied')).toBe(true)
  })

  test('allowedScopes narrow what a new credential may carry', async () => {
    harness = startGateway()
    await putPolicy(harness, fullPolicy({ allowedScopes: ['sessions:read'] }))

    const start = await fetch(`${harness.url}/pair/start`, { method: 'POST', headers: authHeader(ADMIN_TOKEN) })
    expect(start.status).toBe(200)
    const { scopes } = await start.json() as { scopes: string[] }
    expect(scopes).toEqual(['sessions:read'])
  })

  test('policy can forbid the shared route even when the config allows it', async () => {
    harness = startGateway({ pairAllowsSharedRoute: true })
    await putPolicy(harness, { pairingEnabled: true, allowSharedRoute: false, maxDevicesPerDesktop: 0, maxDesktopsPerUser: 0, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] })

    const start = await fetch(`${harness.url}/pair/start`, { method: 'POST', headers: authHeader(ADMIN_TOKEN) })
    expect(start.status).toBe(400)
  })

  test('maxDevicesPerDesktop is enforced at claim time', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    await putPolicy(harness, fullPolicy({ maxDevicesPerDesktop: 1, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] }))

    const first = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ desktopId: desktop.id }),
    })
    const { code } = await first.json() as { code: string }
    const claim = await fetch(`${harness.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'Phone 1', platform: 'ios' }),
    })
    expect(claim.status).toBe(200)

    const second = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
      body: JSON.stringify({ desktopId: desktop.id }),
    })
    const { code: code2 } = await second.json() as { code: string }
    const claim2 = await fetch(`${harness.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code2, deviceName: 'Phone 2', platform: 'ios' }),
    })
    expect(claim2.status).toBe(403)
  })

  test('maxDevicesPerDesktop is enforced at provisioning time', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    await putPolicy(harness, fullPolicy({ maxDevicesPerDesktop: 1, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] }))

    const first = await provisionDevice(harness, account.token, desktop.id, { installationId: 'phone-alpha-1' })
    expect(first.deviceToken).toStartWith('dvc_')

    const raw = await fetch(`${harness.url}/desktops/${desktop.id}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(account.token) },
      body: JSON.stringify({ installationId: 'phone-bravo-2', name: 'Phone 2', platform: 'android' }),
    })
    expect(raw.status).toBe(403)
    expect(((await raw.json()) as { code?: string }).code).toBe('policy-device-limit')
  })

  test('re-provisioning the same installation never hits the device limit', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    await putPolicy(harness, fullPolicy({ maxDevicesPerDesktop: 1, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] }))

    await provisionDevice(harness, account.token, desktop.id, { installationId: 'phone-alpha-1' })
    const again = await provisionDevice(harness, account.token, desktop.id, { installationId: 'phone-alpha-1' })
    expect(again.deviceToken).toStartWith('dvc_')
  })

  test('maxDesktopsPerUser caps enrollments but not re-enrollment', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    await putPolicy(harness, fullPolicy({ maxDesktopsPerUser: 1, allowedScopes: ['sessions:read', 'sessions:write', 'approve'] }))

    await enrollDesktop(harness, account.token, { installationId: 'macbook-one-1' })
    const raw = await fetch(`${harness.url}/desktops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(account.token) },
      body: JSON.stringify({ installationId: 'macbook-two-2', name: 'Second', platform: 'macos' }),
    })
    expect(raw.status).toBe(403)

    // The same installation rotating its secret is not a new desktop.
    const same = await enrollDesktop(harness, account.token, { installationId: 'macbook-one-1' })
    expect(same.agentToken).toStartWith('dsk_')
  })

  test('provisioning is refused when policy allows no requested scope', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    await putPolicy(harness, fullPolicy({ allowedScopes: ['proxy'] }))

    const raw = await fetch(`${harness.url}/desktops/${desktop.id}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(account.token) },
      body: JSON.stringify({ installationId: 'phone-alpha-1', name: 'Phone', platform: 'android' }),
    })
    expect(raw.status).toBe(400)
  })
})

describe('policy · white-label branding', () => {
  test('an absent branding block is "default identity", not an error', () => {
    const parsed = parsePolicy(fullPolicy())
    expect(parsed).not.toBeNull()
    expect(parsed!.branding).toBeUndefined()
  })

  test('branding round-trips through the console API and is readable by a device', async () => {
    harness = startGateway()
    const branding = { displayName: 'Acme Workbench', accentColor: '#1F6FEB' }
    expect((await putPolicy(harness, fullPolicy({ branding }))).status).toBe(200)

    const device = await pairDevice(harness)
    const res = await fetch(`${harness.url}/policy`, { headers: authHeader(device.deviceToken) })
    const { policy } = await res.json() as { policy: { branding?: unknown } }
    expect(policy.branding).toEqual(branding)
  })

  test('the accent is normalized to one canonical spelling', () => {
    // Uppercase hex and stray whitespace are the same color; storing two
    // spellings would make the console's dirty check flicker.
    const parsed = parsePolicy(fullPolicy({ branding: { displayName: '  Acme  ', accentColor: '#1f6feb ' } }))
    expect(parsed!.branding).toEqual({ displayName: 'Acme', accentColor: '#1F6FEB' })
  })

  test('a malformed branding block is refused rather than silently dropped', () => {
    // Silently dropping it would let the operator see "saved" while the
    // desktop keeps painting the default brand.
    for (const branding of [
      { displayName: '', accentColor: '#1F6FEB' },
      { displayName: 'Acme', accentColor: 'blue' },
      { displayName: 'Acme', accentColor: '#1F6FE' },
      { displayName: 'Acme', accentColor: '#1F6FEB00' },
      { displayName: 'Acme', accentColor: 'rgb(31,111,235)' },
      { displayName: 'Ac\nme', accentColor: '#1F6FEB' },
      { displayName: 'x'.repeat(49), accentColor: '#1F6FEB' },
      { displayName: 'Acme' },
      { accentColor: '#1F6FEB' },
      'Acme',
      ['Acme'],
    ]) {
      expect(parsePolicy(fullPolicy({ branding }))).toBeNull()
    }
  })

  test('a policy stored before branding existed still parses and keeps its other fields', () => {
    const legacy = fullPolicy({ disabledTools: ['Bash'] })
    delete (legacy as Record<string, unknown>).branding
    const parsed = parsePolicy(legacy)
    expect(parsed!.disabledTools).toEqual(['Bash'])
    expect(parsed!.branding).toBeUndefined()
  })
})
