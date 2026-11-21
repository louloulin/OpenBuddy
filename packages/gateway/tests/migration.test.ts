import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Store, SCHEMA_VERSION, type DeviceRow } from '../src/store.js'
import { ADMIN_TOKEN, authHeader, startGateway, type Harness } from './helpers.js'

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const close of cleanup.splice(0)) close()
})

/**
 * A database exactly as the pre-account gateway left it: `user_version = 0`,
 * no users/desktops, and a device that the operator paired by hand.
 */
function writeLegacyDatabase(directory: string): string {
  const file = path.join(directory, 'gateway.sqlite')
  const db = new Database(file)
  db.exec(`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      revoked_at INTEGER
    );
    CREATE TABLE pair_codes (
      code_hash TEXT PRIMARY KEY,
      scopes_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      action TEXT NOT NULL,
      device_id TEXT,
      target TEXT,
      meta_json TEXT
    );
    CREATE TABLE push_registrations (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT,
      failed_at INTEGER
    );
    INSERT INTO devices (id, name, platform, token_hash, scopes_json, created_at)
      VALUES ('legacy-device', 'Old Phone', 'ios', 'unused-hash', '["sessions:read"]', 1);
  `)
  db.close()
  return file
}

describe('database migration', () => {
  test('opens a legacy database in place and keeps its device', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lumos-gateway-migration-'))
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const file = writeLegacyDatabase(directory)

    const store = new Store(file)
    try {
      const device = store.getDevice('legacy-device') as DeviceRow | null
      expect(device?.name).toBe('Old Phone')
      // The new columns exist and are null for a legacy row.
      expect(device?.user_id).toBeNull()
      expect(device?.desktop_id).toBeNull()
      expect(device?.installation_id).toBeNull()

      expect(store.schemaVersion()).toBe(SCHEMA_VERSION)
    } finally {
      store.close()
    }
  })

  test('a migrated database still serves the legacy pairing code', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lumos-gateway-migration-'))
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const file = writeLegacyDatabase(directory)

    const harness: Harness = startGateway({ dbPath: file })
    cleanup.push(() => harness.close())

    // The old device is still reachable through the admin listing.
    const devices = await fetch(`${harness.url}/admin/devices`, { headers: authHeader(ADMIN_TOKEN) })
    const body = await devices.json() as { devices: Array<{ id: string }> }
    expect(body.devices.map((entry) => entry.id)).toContain('legacy-device')

    // And the six-digit flow still mints a device with no account owner.
    const start = await fetch(`${harness.url}/pair/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(ADMIN_TOKEN) },
      body: JSON.stringify({}),
    })
    const { code } = await start.json() as { code: string }
    const claim = await fetch(`${harness.url}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'Legacy Phone', platform: 'ios' }),
    })
    expect(claim.status).toBe(200)
    const paired = await claim.json() as { deviceId: string; deviceToken: string }

    const row = harness.gateway.store.getDevice(paired.deviceId) as DeviceRow
    expect(row.user_id).toBeNull()
    expect(row.desktop_id).toBeNull()

    const me = await fetch(`${harness.url}/device/me`, { headers: authHeader(paired.deviceToken) })
    const meBody = await me.json() as { desktop: unknown }
    expect(meBody.desktop).toBeNull()
  })

  test('reopening an already-migrated database is a no-op', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'lumos-gateway-migration-'))
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const file = path.join(directory, 'gateway.sqlite')

    const first = new Store(file)
    const id = first.createUser({
      id: 'user-1',
      email: 'a@example.com',
      passwordHash: 'hash',
      displayName: null,
    }).id
    first.close()

    const second = new Store(file)
    try {
      expect(second.getUser(id)?.email).toBe('a@example.com')
    } finally {
      second.close()
    }
  })
})

describe('retention', () => {
  function memoryStore(): Store {
    const store = new Store(':memory:')
    cleanup.push(() => store.close())
    return store
  }

  test('expired pairing codes go, live and freshly expired ones stay', () => {
    const store = memoryStore()
    const now = 1_000_000_000_000
    store.createPair('fresh', [], now + 60_000, now)
    store.createPair('recently-expired', [], now - Store.PAIR_CODE_RETENTION_MS + 1_000, now)
    store.createPair('long-expired', [], now - Store.PAIR_CODE_RETENTION_MS - 1_000, now)

    const pruned = store.pruneExpired(now)

    expect(pruned.pairCodes).toBe(1)
    expect(store.consumePair('fresh', now)).not.toBeNull()
    expect(store.consumePair('recently-expired', now)).toBeNull()
    expect(store.consumePair('long-expired', now)).toBeNull()
  })

  test('expired and long-revoked sessions go, live and fresh ones stay', () => {
    const store = memoryStore()
    const now = 1_000_000_000_000
    store.createUser({ id: 'u1', email: 'a@example.com', passwordHash: 'h', displayName: null })
    store.insertUserSession({ id: 'live', userId: 'u1', tokenHash: 't1', expiresAt: now + 60_000, now })
    store.insertUserSession({ id: 'expired', userId: 'u1', tokenHash: 't2', expiresAt: now - 1, now })
    store.insertUserSession({ id: 'revoked-old', userId: 'u1', tokenHash: 't3', expiresAt: now + 60_000, now })
    store.revokeUserSession('revoked-old', now - Store.REVOKED_SESSION_RETENTION_MS - 1_000)

    const pruned = store.pruneExpired(now)

    expect(pruned.userSessions).toBe(2)
    expect(store.getUserSession('live')).not.toBeNull()
    expect(store.getUserSession('expired')).toBeNull()
    expect(store.getUserSession('revoked-old')).toBeNull()
  })

  test('the audit trail keeps a month and loses anything older', () => {
    const store = memoryStore()
    const now = 1_000_000_000_000
    store.audit('recent', null, null, undefined, now - 1_000)
    store.audit('ancient', null, null, undefined, now - Store.AUDIT_RETENTION_MS - 1_000)

    const pruned = store.pruneExpired(now)

    expect(pruned.audit).toBe(1)
    expect(store.listAudit().map(row => row.action)).toEqual(['recent'])
  })

  test('a closed store prunes nothing and throws nowhere', () => {
    const store = new Store(':memory:')
    store.close()
    expect(store.pruneExpired()).toEqual({ pairCodes: 0, userSessions: 0, audit: 0 })
  })
})
