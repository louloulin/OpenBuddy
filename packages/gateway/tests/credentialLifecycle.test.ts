import { afterEach, describe, expect, test } from 'bun:test'

import {
  authHeader,
  enrollDesktop,
  pairDevice,
  provisionDevice,
  registerUser,
  startGateway,
  type Harness,
} from './helpers.js'

/**
 * Two credentials have a lifetime on this gateway: the account session a
 * browser signs in with, and the device token a phone carries afterwards.
 * Neither could be renewed without signing in again, which for a browser
 * means retyping a password and for a phone means pairing from scratch.
 */

let harness: Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
})

describe('an account session', () => {
  test('can be pushed out without a new password', async () => {
    harness = startGateway()
    const account = await registerUser(harness)

    const response = await fetch(`${harness.url}/auth/refresh`, {
      method: 'POST',
      headers: authHeader(account.token),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { user: { email: string }; expiresAt: string }
    expect(body.user.email).toBe('user@example.com')
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('still needs a live session to be refreshed', async () => {
    harness = startGateway()

    const response = await fetch(`${harness.url}/auth/refresh`, {
      method: 'POST',
      headers: authHeader('usr_00000000-0000-4000-8000-000000000000_nope'),
    })
    expect(response.status).toBe(401)
  })

  test('is not resurrected after signing out', async () => {
    harness = startGateway()
    const account = await registerUser(harness)

    await fetch(`${harness.url}/auth/logout`, { method: 'POST', headers: authHeader(account.token) })

    const response = await fetch(`${harness.url}/auth/refresh`, {
      method: 'POST',
      headers: authHeader(account.token),
    })
    expect(response.status).toBe(401)
  })
})

describe('a device token', () => {
  test('can be replaced without losing the pairing', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.id)

    const rotated = await fetch(`${harness.url}/device/rotate`, {
      method: 'POST',
      headers: authHeader(device.deviceToken),
    })
    expect(rotated.status).toBe(200)
    const body = await rotated.json() as { deviceToken: string; deviceId: string; scopes: string[] }
    expect(body.deviceId).toBe(device.deviceId)
    expect(body.deviceToken).not.toBe(device.deviceToken)
    expect(body.deviceToken).toStartWith('dvc_')
    expect(body.scopes).toEqual(device.scopes)

    // The new token works and still names the same computer.
    const me = await fetch(`${harness.url}/device/me`, { headers: authHeader(body.deviceToken) })
    expect(me.status).toBe(200)
    const meBody = await me.json() as { desktop: { id: string } }
    expect(meBody.desktop.id).toBe(desktop.id)

    // The old one does not.
    const old = await fetch(`${harness.url}/device/me`, { headers: authHeader(device.deviceToken) })
    expect(old.status).toBe(401)
  })

  test('is not resurrected by rotating a revoked device', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.id)

    await fetch(`${harness.url}/admin/devices/${device.deviceId}/revoke`, {
      method: 'POST',
      headers: authHeader('adm_test_admin'),
    })

    const rotated = await fetch(`${harness.url}/device/rotate`, {
      method: 'POST',
      headers: authHeader(device.deviceToken),
    })
    expect(rotated.status).toBe(401)
  })

  test('rotation is audited', async () => {
    harness = startGateway()
    const account = await registerUser(harness)
    const { desktop } = await enrollDesktop(harness, account.token)
    const device = await provisionDevice(harness, account.token, desktop.id)

    await fetch(`${harness.url}/device/rotate`, {
      method: 'POST',
      headers: authHeader(device.deviceToken),
    })

    const audit = await fetch(`${harness.url}/admin/audit`, { headers: authHeader('adm_test_admin') })
    const { audit: events } = await audit.json() as { audit: Array<{ action: string }> }
    expect(events.some(event => event.action === 'device_rotated')).toBe(true)
  })

  test('a code-paired device can rotate too', async () => {
    harness = startGateway()
    const device = await pairDevice(harness)

    const rotated = await fetch(`${harness.url}/device/rotate`, {
      method: 'POST',
      headers: authHeader(device.deviceToken),
    })
    expect(rotated.status).toBe(200)
    const body = await rotated.json() as { deviceToken: string; deviceId: string }
    expect(body.deviceId).toBe(device.deviceId)

    const listed = await fetch(`${harness.url}/api/sessions`, { headers: authHeader(body.deviceToken) })
    expect(listed.status).toBe(200)
  })
})
