import { afterEach, describe, expect, test } from 'bun:test'

import { loadConfig } from '../src/config.js'
import { DEFAULT_POLICY } from '../src/policy.js'
import { ADMIN_TOKEN, authHeader, enrollDesktop, registerUser, startGateway, type Harness } from './helpers.js'

/**
 * The shared route is the gateway's original single-tenant mode: a pairing
 * code that names no computer produces a device reading the gateway's own
 * upstream, whichever computer happens to be attached to it.
 *
 * That is safe on one machine with one account and wrong everywhere else, so
 * the gateway now refuses it by default and refuses it outright as soon as
 * the deployment stops being that one machine.
 */

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

function mintCode(h: Harness, body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${h.url}/pair/start`, {
    method: 'POST',
    headers: { ...authHeader(ADMIN_TOKEN), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('the shared route', () => {
  test('a fresh gateway does not offer it', () => {
    expect(loadConfig({}).pairAllowsSharedRoute).toBe(false)
    expect(DEFAULT_POLICY.allowSharedRoute).toBe(false)
  })

  test('a code that names no computer is refused', async () => {
    harness = startGateway({ pairAllowsSharedRoute: false })

    const response = await mintCode(harness)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('must name a desktop') })
  })

  test('a code that names a computer is still accepted', async () => {
    harness = startGateway({ pairAllowsSharedRoute: false })
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)

    const response = await mintCode(harness, { desktopId: desktop.id })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ desktopId: desktop.id })
  })

  test('an operator can turn it on for a single-machine deployment', async () => {
    harness = startGateway()

    const response = await mintCode(harness)
    expect(response.status).toBe(200)
  })

  test('a second account closes it even when the operator left it on', async () => {
    harness = startGateway()
    await registerUser(harness, { email: 'first@example.com' })
    await registerUser(harness, { email: 'second@example.com' })

    const response = await mintCode(harness)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('must name a desktop') })
  })

  test('a second computer closes it too — the shared upstream would be ambiguous', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    await enrollDesktop(harness, account.token, { installationId: 'installation-desktop-1' })
    await enrollDesktop(harness, account.token, { installationId: 'installation-desktop-2' })

    const response = await mintCode(harness)
    expect(response.status).toBe(400)
  })

  test('a code naming one of several computers still works', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    await enrollDesktop(harness, account.token, { installationId: 'installation-desktop-1' })
    const { desktop } = await enrollDesktop(harness, account.token, { installationId: 'installation-desktop-2' })

    const response = await mintCode(harness, { desktopId: desktop.id })
    expect(response.status).toBe(200)
  })

  test('the refusal is audited', async () => {
    harness = startGateway({ pairAllowsSharedRoute: false })
    await mintCode(harness)

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader(ADMIN_TOKEN) })
    const { audit: events } = await audit.json() as { audit: Array<{ action: string }> }
    expect(events.some(event => event.action === 'pair_policy_denied')).toBe(true)
  })
})
