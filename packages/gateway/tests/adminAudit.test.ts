import { afterEach, describe, expect, test } from 'bun:test'

import { ADMIN_TOKEN, startGateway, type Harness } from './helpers.js'

/**
 * The audit endpoint the console pages through.
 *
 * Paging is by id because the table grows while an operator reads: an offset
 * over a changing table repeats and skips. The limits are clamped on the
 * server because the console is not the only caller — a token holder can ask
 * for any number, and the answer must stay bounded.
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

type AuditPage = {
  audit: Array<{
    id: number
    action: string
    at: string
    userId: string | null
    meta: Record<string, unknown>
  }>
  nextBeforeId: number | null
}

async function read(harness: Harness, query = ''): Promise<AuditPage> {
  const response = await fetch(`${harness.url}/admin/audit${query}`, { headers: adminHeaders })
  expect(response.status).toBe(200)
  return (await response.json()) as AuditPage
}

/** Seeds `count` rows, with an action/actor/timestamp that the filters can find. */
function seed(harness: Harness, count: number): void {
  const store = harness.gateway.store
  const base = 1_700_000_000_000
  for (let index = 0; index < count; index += 1) {
    const pair = index % 2 === 0
    store.audit(
      pair ? 'pair_started' : 'device_revoked',
      null,
      `row-${index}`,
      index % 5 === 0 ? { email: 'ops@example.com' } : undefined,
      base + index,
      { userId: index % 3 === 0 ? 'user-a' : null },
    )
  }
}

describe('audit paging', () => {
  test('a page carries a cursor only when it is full', async () => {
    const harness = gateway()
    seed(harness, 250)

    const first = await read(harness, '?limit=100')
    expect(first.audit).toHaveLength(100)
    expect(first.nextBeforeId).toBe(first.audit[99]!.id)

    const second = await read(harness, `?limit=100&beforeId=${first.nextBeforeId}`)
    expect(second.audit).toHaveLength(100)
    expect(second.nextBeforeId).toBe(second.audit[99]!.id)
    // No overlap between pages.
    expect(second.audit[0]!.id).toBeLessThan(first.audit[99]!.id)

    const last = await read(harness, `?limit=100&beforeId=${second.nextBeforeId}`)
    expect(last.audit).toHaveLength(50)
    expect(last.nextBeforeId).toBeNull()
  })

  test('the default is 100 and the server clamps to 500', async () => {
    const harness = gateway()
    seed(harness, 620)

    const fallback = await read(harness)
    expect(fallback.audit).toHaveLength(100)

    const clamped = await read(harness, '?limit=9999')
    expect(clamped.audit).toHaveLength(500)

    // A malformed value falls back rather than returning everything.
    const malformed = await read(harness, '?limit=many')
    expect(malformed.audit).toHaveLength(100)
  })
})

describe('audit filters', () => {
  test('prefix matches action families', async () => {
    const harness = gateway()
    seed(harness, 40)

    const page = await read(harness, '?prefix=pair_&limit=100')
    expect(page.audit.length).toBe(20)
    expect(page.audit.every(row => row.action.startsWith('pair_'))).toBe(true)
  })

  test('actor matches an account id or the email in meta', async () => {
    const harness = gateway()
    seed(harness, 30)

    const byEmail = await read(harness, '?actor=ops@example.com&limit=100')
    expect(byEmail.audit.length).toBeGreaterThan(0)
    expect(byEmail.audit.every(row => row.meta.email === 'ops@example.com')).toBe(true)

    const byUser = await read(harness, '?actor=user-a&limit=100')
    expect(byUser.audit.length).toBeGreaterThan(0)
    expect(byUser.audit.every(row => row.userId === 'user-a')).toBe(true)
  })

  test('time bounds are inclusive', async () => {
    const harness = gateway()
    seed(harness, 10)
    const base = 1_700_000_000_000

    const page = await read(harness, `?since=${base + 3}&until=${base + 5}&limit=100`)
    expect(page.audit.map(row => Date.parse(row.at))).toEqual([
      base + 5,
      base + 4,
      base + 3,
    ])
  })

  test('failures-only keeps failed and revoked events', async () => {
    const harness = gateway()
    const store = harness.gateway.store
    store.audit('admin_login_failed', null, null, { email: 'x@example.com' })
    store.audit('device_revoked', null, 'd1')
    store.audit('pair_started', null, 'code')

    const page = await read(harness, '?failures=1&limit=100')
    expect(page.audit.map(row => row.action).sort()).toEqual(['admin_login_failed', 'device_revoked'])
  })

  test('filters compose', async () => {
    const harness = gateway()
    seed(harness, 40)

    const page = await read(harness, '?prefix=pair_&actor=ops@example.com&limit=100')
    expect(page.audit.length).toBeGreaterThan(0)
    expect(
      page.audit.every(
        row => row.action.startsWith('pair_') && row.meta.email === 'ops@example.com',
      ),
    ).toBe(true)
  })
})
