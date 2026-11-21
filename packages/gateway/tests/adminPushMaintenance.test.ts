import { afterEach, describe, expect, test } from 'bun:test'

import { createPushDispatcher } from '../src/push/dispatcher.js'
import type { PushProvider } from '../src/push/types.js'
import { ADMIN_TOKEN, pairDevice, startGateway, type Harness } from './helpers.js'

/**
 * The console's push maintenance actions.
 *
 * Two operator questions:
 * - "is this phone reachable?" → a test send to exactly one registration;
 * - "this row is dead, remove it" → a delete that refuses to unplug a phone
 *   that is still receiving.
 */

const open: Harness[] = []

function gateway(): Harness {
  const harness = startGateway()
  open.push(harness)
  return harness
}

afterEach(() => {
  for (const harness of open.splice(0)) harness.close()
})

const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` }

async function register(
  harness: Harness,
  options: { dead?: boolean } = {},
): Promise<{ id: string; deviceId: string }> {
  const device = await pairDevice(harness)
  const registration = harness.gateway.store.upsertPushRegistration({
    deviceId: device.deviceId,
    provider: 'webhook',
    token: `tok-${crypto.randomUUID()}`,
    platform: 'ios',
  })
  if (!registration) throw new Error('registration refused')
  if (options.dead) {
    harness.gateway.store.markPushRegistrationDead(registration.id, 'invalid token')
  }
  return { id: registration.id, deviceId: device.deviceId }
}

describe('per-registration test send', () => {
  test('a live registration is addressed on its own', async () => {
    const harness = gateway()
    const { id, deviceId } = await register(harness)

    const response = await fetch(`${harness.url}/admin/push/registrations/${id}/test`, {
      method: 'POST',
      headers: adminHeaders,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      report: { considered: number; delivered: number; retryable: number; dead: number; skipped: number }
    }
    // Either a configured provider tried and failed (this test gateway has no
    // reachable endpoint) or none was configured and the row was skipped; in
    // both cases exactly one registration was addressed.
    expect(body.report.considered).toBe(1)
    expect(
      body.report.delivered + body.report.retryable + body.report.dead + body.report.skipped,
    ).toBe(1)

    const audit = harness.gateway.store.queryAudit({
      limit: 10,
      prefixes: ['admin_push_registration_test'],
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.target).toBe(id)
    expect(audit[0]!.device_id).toBe(deviceId)
  })

  test('a dead registration is refused instead of hammered', async () => {
    const harness = gateway()
    const { id } = await register(harness, { dead: true })

    const response = await fetch(`${harness.url}/admin/push/registrations/${id}/test`, {
      method: 'POST',
      headers: adminHeaders,
    })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('registration_dead')
  })

  test('a registration on a revoked device is not found', async () => {
    const harness = gateway()
    const { id, deviceId } = await register(harness)
    await fetch(`${harness.url}/admin/devices/${deviceId}/revoke`, {
      method: 'POST',
      headers: adminHeaders,
    })

    const response = await fetch(`${harness.url}/admin/push/registrations/${id}/test`, {
      method: 'POST',
      headers: adminHeaders,
    })
    expect(response.status).toBe(404)
  })
})

describe('dead registration cleanup', () => {
  test('a live row cannot be deleted', async () => {
    const harness = gateway()
    const { id } = await register(harness)

    const response = await fetch(`${harness.url}/admin/push/registrations/${id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('registration_active')
    expect(harness.gateway.store.getPushRegistration(id)).not.toBeNull()
  })

  test('a dead row is removed and audited', async () => {
    const harness = gateway()
    const { id } = await register(harness, { dead: true })

    const response = await fetch(`${harness.url}/admin/push/registrations/${id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    })
    expect(response.status).toBe(200)
    expect(harness.gateway.store.getPushRegistration(id)).toBeNull()

    const audit = harness.gateway.store.queryAudit({
      limit: 10,
      prefixes: ['admin_push_registration_deleted'],
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.target).toBe(id)
  })

  test('deliveries now reports dead registrations (it used to be always empty)', async () => {
    const harness = gateway()
    const { id } = await register(harness, { dead: true })

    const response = await fetch(`${harness.url}/admin/push/deliveries`, { headers: adminHeaders })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { deadRegistrations: Array<{ id: string }> }
    expect(body.deadRegistrations.map(row => row.id)).toEqual([id])
  })
})

describe('dispatcher targeting', () => {
  test('registrationId reaches exactly one provider send', async () => {
    const harness = gateway()
    const first = await register(harness)
    const second = await register(harness)

    const sent: string[] = []
    const provider: PushProvider = {
      name: 'webhook',
      async send(message) {
        sent.push(message.sessionId)
        return { ok: true }
      },
    }
    const dispatcher = createPushDispatcher({
      store: harness.gateway.store,
      providers: { webhook: provider },
    })

    const report = await dispatcher.notify({
      kind: 'approval',
      sessionId: 'targeted',
      registrationId: first.id,
    })
    expect(report.considered).toBe(1)
    expect(report.delivered).toBe(1)
    expect(sent).toEqual(['targeted'])
    // The other phone was not involved.
    expect(second.id).not.toBe(first.id)
  })
})
