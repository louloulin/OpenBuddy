import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Scope } from './auth.js'
import { DEFAULT_POLICY, parsePolicy, type GatewayPolicy } from './policy.js'
import type { PushProviderName, PushRegistration } from './push/types.js'

export type DeviceRow = {
  id: string
  name: string
  platform: string
  token_hash: string
  scopes_json: string
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
  /** Set for devices that belong to an account; null for legacy pairings. */
  user_id: string | null
  /** The desktop this device is allowed to reach; null for legacy pairings. */
  desktop_id: string | null
  /** Client-generated stable id, so re-pairing rotates one row instead of adding another. */
  installation_id: string | null
}

/**
 * What an account may do.
 *
 * `user` is what every phone or desktop sign-in produces: it can enumerate and
 * mint credentials for its own computers. `admin` additionally reaches
 * `/admin/*`, which sees every account on the gateway — so this is the only
 * privilege boundary the gateway has, and it is deliberately a column rather
 * than a separate table.
 */
export type UserRole = 'user' | 'admin'

export type UserRow = {
  id: string
  email: string
  password_hash: string
  display_name: string | null
  created_at: number
  disabled_at: number | null
  role: UserRole
}

/** A desktop row joined with the account that owns it, for the admin console. */
export type AdminDesktopRow = DesktopRow & { owner_email: string | null; device_count: number }

/**
 * A pairing code's lifecycle, without the hash.
 *
 * `code_hash` is the credential itself — half of it is the code — so an admin
 * listing never returns it. What an operator needs is whether a code is still
 * unused, who it was minted for, and when it dies.
 */
export type PairCodeSummaryRow = {
  created_at: number
  expires_at: number
  consumed_at: number | null
  desktop_id: string | null
  desktop_name: string | null
  scopes_json: string
}

export type UserSessionRow = {
  id: string
  user_id: string
  token_hash: string
  created_at: number
  last_seen_at: number | null
  expires_at: number
  revoked_at: number | null
}

export type DesktopRow = {
  id: string
  user_id: string
  installation_id: string
  name: string
  platform: string
  token_hash: string
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
}

/** Schema generation written to `PRAGMA user_version`.
 * 3: the `audit_user` index, so per-account audit reads stop scanning.
 * 4: `users.role`, the admin console's only privilege boundary.
 * 5: the single-row `policy` table (deployment policy enforced at the gateway). */
export const SCHEMA_VERSION = 5

export type PushRegistrationRow = {
  id: string
  device_id: string
  provider: string
  token: string
  platform: string
  created_at: number
  updated_at: number
  last_error: string | null
  failed_at: number | null
}

function toPushRegistration(row: PushRegistrationRow): PushRegistration {
  return {
    id: row.id,
    deviceId: row.device_id,
    provider: row.provider as PushProviderName,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
    failedAt: row.failed_at,
  }
}

export type AuditRow = {
  id: number
  at: number
  action: string
  device_id: string | null
  target: string | null
  meta_json: string | null
  /** The account this row belongs to; null for operator-level events. */
  user_id: string | null
  desktop_id: string | null
}

/** Filters the console can push into SQL; see `Store.queryAudit`. */
export type AuditQuery = {
  limit: number
  /** Exclusive upper bound on `id`, for "load older" paging. */
  beforeId?: number | null
  /** Action prefixes (`pair_`, `device_`, …), OR-ed together. */
  prefixes?: string[]
  /** Account id or email; matches `user_id` or `meta.email`. */
  actor?: string | null
  since?: number | null
  until?: number | null
  failuresOnly?: boolean
}

export function deviceScopes(device: DeviceRow): Scope[] {
  try {
    const parsed: unknown = JSON.parse(device.scopes_json)
    return Array.isArray(parsed) ? (parsed as Scope[]) : []
  } catch {
    return []
  }
}

export class Store {
  private readonly db: Database
  private closed = false
  /**
   * The policy a gateway applies when its operator has not stored one.
   *
   * It is a field rather than a constant because part of the default is a
   * deployment decision — whether a pairing code may name no computer — and
   * the gateway knows that from its configuration, not from the database.
   */
  private defaultPolicy: GatewayPolicy = { ...DEFAULT_POLICY }

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  /**
   * Bring an existing gateway database up to the current schema.
   *
   * `CREATE TABLE IF NOT EXISTS` alone is not a migration: a database written
   * by an older gateway already has the base tables, so new columns would
   * silently never appear. The version gate is what lets an old database be
   * opened in place without losing paired devices or pending codes.
   */
  private migrate(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | null)?.user_version ?? 0

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          platform TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          scopes_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER,
          revoked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS pair_codes (
          code_hash TEXT PRIMARY KEY,
          scopes_json TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          action TEXT NOT NULL,
          device_id TEXT,
          target TEXT,
          meta_json TEXT
        );
        CREATE INDEX IF NOT EXISTS audit_at ON audit (at DESC);
        CREATE TABLE IF NOT EXISTS push_registrations (
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
        CREATE UNIQUE INDEX IF NOT EXISTS push_registration_token ON push_registrations (provider, token);
        CREATE INDEX IF NOT EXISTS push_registration_device ON push_registrations (device_id);
        CREATE TABLE IF NOT EXISTS policy (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          updated_by TEXT
        );
      `)
    })()

    if (version >= SCHEMA_VERSION) return

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT,
          created_at INTEGER NOT NULL,
          disabled_at INTEGER,
          role TEXT NOT NULL DEFAULT 'user'
        );
        CREATE TABLE IF NOT EXISTS user_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER,
          expires_at INTEGER NOT NULL,
          revoked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions (user_id);
        CREATE INDEX IF NOT EXISTS user_sessions_expiry ON user_sessions (expires_at);
        CREATE TABLE IF NOT EXISTS desktops (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          installation_id TEXT NOT NULL,
          name TEXT NOT NULL,
          platform TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER,
          revoked_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS desktops_installation ON desktops (user_id, installation_id);
        CREATE INDEX IF NOT EXISTS desktops_user ON desktops (user_id);
      `)

      for (const [table, column, definition] of [
        ['devices', 'user_id', 'TEXT'],
        ['devices', 'desktop_id', 'TEXT'],
        ['devices', 'installation_id', 'TEXT'],
        ['pair_codes', 'user_id', 'TEXT'],
        ['pair_codes', 'desktop_id', 'TEXT'],
        ['audit', 'user_id', 'TEXT'],
        ['audit', 'desktop_id', 'TEXT'],
        // v4: existing accounts become ordinary users; an operator promotes one
        // through the console or GATEWAY_ADMIN_EMAIL/PASSWORD on next boot.
        ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
      ] as const) {
        if (!this.hasColumn(table, column)) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
        }
      }

      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS devices_installation
          ON devices (desktop_id, installation_id)
          WHERE desktop_id IS NOT NULL AND installation_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS devices_desktop ON devices (desktop_id);
        CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id);
        CREATE INDEX IF NOT EXISTS pair_codes_desktop ON pair_codes (desktop_id);
        CREATE INDEX IF NOT EXISTS audit_user ON audit (user_id);
      `)

      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })()
  }

  /** The schema generation currently stored in this database. */
  schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | null)?.user_version ?? 0
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return columns.some((entry) => entry.name === column)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  /**
   * Stores a one-time code, optionally for a specific desktop.
   *
   * A code that names its desktop produces a device bound to that computer. A
   * code with no desktop keeps the pre-account behaviour, where the claim ends
   * up on the gateway's shared route — see `pairAllowsSharedRoute`.
   */
  createPair(
    codeHash: string,
    scopes: Scope[],
    expiresAt: number,
    now = Date.now(),
    owner?: { userId?: string | null; desktopId?: string | null },
  ): void {
    this.db.prepare(
      `INSERT INTO pair_codes (code_hash, scopes_json, expires_at, consumed_at, created_at, user_id, desktop_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      codeHash,
      JSON.stringify(scopes),
      expiresAt,
      now,
      owner?.userId ?? null,
      owner?.desktopId ?? null,
    )
  }

  /** Atomically consumes a code; returns its scopes and owner, or null when unusable. */
  consumePair(
    codeHash: string,
    now = Date.now(),
  ): { scopes: Scope[]; userId: string | null; desktopId: string | null } | null {
    const row = this.db.prepare(
      `UPDATE pair_codes SET consumed_at = ?
       WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING scopes_json, user_id, desktop_id`,
    ).get(now, codeHash, now) as
      { scopes_json: string; user_id: string | null; desktop_id: string | null } | null
    if (!row) return null
    let scopes: Scope[] = []
    try {
      const parsed: unknown = JSON.parse(row.scopes_json)
      if (Array.isArray(parsed)) scopes = parsed as Scope[]
    } catch {
      // A corrupt row is still consumed; the caller gets no scopes.
    }
    return { scopes, userId: row.user_id, desktopId: row.desktop_id }
  }

  insertDevice(device: {
    id: string
    name: string
    platform: string
    token_hash: string
    scopes_json: string
    created_at: number
    user_id?: string | null
    desktop_id?: string | null
    installation_id?: string | null
  }): void {
    this.db.prepare(
      `INSERT INTO devices
         (id, name, platform, token_hash, scopes_json, created_at, last_seen_at, revoked_at,
          user_id, desktop_id, installation_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    ).run(
      device.id,
      device.name,
      device.platform,
      device.token_hash,
      device.scopes_json,
      device.created_at,
      device.user_id ?? null,
      device.desktop_id ?? null,
      device.installation_id ?? null,
    )
  }

  /**
   * Create or refresh the device row for one app installation.
   *
   * A phone that reconnects (or re-pairs) presents the same installation id, so
   * the gateway rotates that one row's secret instead of accumulating tokens
   * that can never be revoked together. The row id stays stable, which keeps
   * push registrations and audit history attached to the same device.
   */
  /**
   * Creates or rotates the device row for one installation of one desktop.
   *
   * Revocation is where this method gets careful. An installation the
   * operator revoked must not come back to life because its phone still held
   * a user session — that would make "revoke" mean "force one reconnection",
   * which is not what anyone pressing the button means. Rebirth needs the
   * caller to say a user explicitly asked to pair again; a silent re-sign
   * does not get to say that.
   *
   * Returns null when the row exists but is revoked and revival was not
   * explicitly allowed.
   */
  upsertDesktopDevice(device: {
    userId: string
    desktopId: string
    installationId: string
    name: string
    platform: string
    tokenHash: string
    scopesJson: string
    now?: number
    /** A user asked to pair again; a background self-heal never sets this. */
    allowRevived?: boolean
  }): DeviceRow | null {
    const now = device.now ?? Date.now()
    const existing = this.db.prepare(
      'SELECT * FROM devices WHERE desktop_id = ? AND installation_id = ?',
    ).get(device.desktopId, device.installationId) as DeviceRow | null

    if (existing?.revoked_at != null && device.allowRevived !== true) return null

    if (existing) {
      this.db.prepare(
        `UPDATE devices
         SET user_id = ?, name = ?, platform = ?, token_hash = ?, scopes_json = ?,
             revoked_at = NULL
         WHERE id = ?`,
      ).run(device.userId, device.name, device.platform, device.tokenHash, device.scopesJson, existing.id)
      return { ...existing, user_id: device.userId, name: device.name, platform: device.platform, token_hash: device.tokenHash, scopes_json: device.scopesJson, revoked_at: null }
    }

    const id = crypto.randomUUID()
    this.insertDevice({
      id,
      name: device.name,
      platform: device.platform,
      token_hash: device.tokenHash,
      scopes_json: device.scopesJson,
      created_at: now,
      user_id: device.userId,
      desktop_id: device.desktopId,
      installation_id: device.installationId,
    })
    return {
      id,
      name: device.name,
      platform: device.platform,
      token_hash: device.tokenHash,
      scopes_json: device.scopesJson,
      created_at: now,
      last_seen_at: null,
      revoked_at: null,
      user_id: device.userId,
      desktop_id: device.desktopId,
      installation_id: device.installationId,
    }
  }

  /** Every device that can reach one desktop; used to revoke a removed desktop. */
  listDesktopDevices(desktopId: string): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices WHERE desktop_id = ?').all(desktopId) as DeviceRow[]
  }

  /** Active (non-revoked) devices reachable through one desktop. */
  countActiveDesktopDevices(desktopId: string, excludeInstallationId?: string): number {
    const row = excludeInstallationId
      ? this.db.prepare(
          'SELECT COUNT(*) AS n FROM devices WHERE desktop_id = ? AND revoked_at IS NULL AND (installation_id IS NULL OR installation_id != ?)',
        ).get(desktopId, excludeInstallationId)
      : this.db.prepare(
          'SELECT COUNT(*) AS n FROM devices WHERE desktop_id = ? AND revoked_at IS NULL',
        ).get(desktopId)
    return (row as { n?: number } | null)?.n ?? 0
  }

  /** Active (non-revoked) desktops owned by one user. */
  countActiveDesktopsForUser(userId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM desktops WHERE user_id = ? AND revoked_at IS NULL',
    ).get(userId)
    return (row as { n?: number } | null)?.n ?? 0
  }

  /**
   * The deployment policy, or the default when nothing is stored yet or the
   * stored row cannot be parsed (a corrupted row must not lock the deployment
   * out of its own gateway).
   */
  getPolicy(): GatewayPolicy {
    const row = this.db.prepare('SELECT json FROM policy WHERE id = 1').get() as { json?: string } | null
    if (!row?.json) return { ...this.defaultPolicy }
    try {
      return parsePolicy(JSON.parse(row.json)) ?? { ...this.defaultPolicy }
    } catch {
      return { ...this.defaultPolicy }
    }
  }

  /** The policy this gateway falls back to when nothing is stored. */
  getDefaultPolicy(): GatewayPolicy {
    return { ...this.defaultPolicy }
  }

  /**
   * Sets the fallback policy.
   *
   * The deployment's own configuration decides part of it — most visibly
   * whether a pairing code may name no computer — so an operator who turned
   * that on in the environment must not also have to write it into the
   * console before it takes effect.
   */
  setDefaultPolicy(policy: GatewayPolicy): void {
    this.defaultPolicy = { ...policy }
  }

  setPolicy(policy: GatewayPolicy, opts: { at?: number; updatedBy?: string | null } = {}): void {
    this.db.prepare(
      `INSERT INTO policy (id, json, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(JSON.stringify(policy), opts.at ?? Date.now(), opts.updatedBy ?? null)
  }

  /** Who last changed the policy and when; null while only defaults apply. */
  getPolicyMeta(): { updatedAt: number; updatedBy: string | null } | null {
    const row = this.db.prepare('SELECT updated_at, updated_by FROM policy WHERE id = 1').get() as
      | { updated_at?: number; updated_by?: string | null }
      | null
    if (!row?.updated_at) return null
    return { updatedAt: row.updated_at, updatedBy: row.updated_by ?? null }
  }

  revokeDesktopDevices(desktopId: string, now = Date.now()): number {
    return this.db.prepare(
      'UPDATE devices SET revoked_at = ? WHERE desktop_id = ? AND revoked_at IS NULL',
    ).run(now, desktopId).changes
  }

  getDevice(id: string): DeviceRow | null {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | null
  }

  touchDevice(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, id)
  }

  revokeDevice(id: string, now = Date.now()): boolean {
    const result = this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id)
    return result.changes > 0
  }

  /**
   * Swaps one device's secret while keeping everything that identifies it.
   *
   * The device keeps its id, its name, its computer and its scopes — only the
   * hash of the secret changes, so every copy of the old token stops working
   * on the next request. A revoked device is not resurrected here: rotation
   * replaces a live credential, it does not undo an explicit revocation.
   */
  replaceDeviceToken(id: string, tokenHash: string, now = Date.now()): boolean {
    return this.db.prepare(
      'UPDATE devices SET token_hash = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL',
    ).run(tokenHash, now, id).changes > 0
  }

  listDevices(): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices ORDER BY created_at DESC').all() as DeviceRow[]
  }

  audit(
    action: string,
    deviceId: string | null,
    target: string | null = null,
    meta?: unknown,
    now = Date.now(),
    owner?: { userId?: string | null; desktopId?: string | null },
  ): void {
    // Shutdown closes the store before sockets finish closing; an audit write
    // during teardown must not throw.
    if (this.closed) return
    this.db.prepare(
      `INSERT INTO audit (at, action, device_id, target, meta_json, user_id, desktop_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      now,
      action,
      deviceId,
      target,
      meta === undefined ? null : JSON.stringify(meta),
      owner?.userId ?? null,
      owner?.desktopId ?? null,
    )
  }

  listAudit(limit = 50): AuditRow[] {
    return this.queryAudit({ limit })
  }

  /**
   * One page of the audit trail, newest first.
   *
   * The console pages by id (`beforeId`) rather than by offset: rows arrive
   * while an operator reads, and an offset over a changing table both repeats
   * and skips rows. `prefixes`/`actor`/`since`/`until`/`failuresOnly` are the
   * filters the console pushes down so it is not sentenced to reading the
   * whole table to answer "who revoked things last week".
   */
  queryAudit(query: AuditQuery): AuditRow[] {
    const limit = Math.min(Math.max(Math.trunc(query.limit) || 50, 1), 500)
    const clauses: string[] = []
    const values: Array<string | number> = []

    if (query.beforeId != null) {
      clauses.push('id < ?')
      values.push(query.beforeId)
    }
    const prefixes = (query.prefixes ?? []).filter(prefix => prefix.length > 0).slice(0, 12)
    if (prefixes.length > 0) {
      clauses.push(`(${prefixes.map(() => "action LIKE ? ESCAPE '\\'").join(' OR ')})`)
      for (const prefix of prefixes) {
        values.push(`${prefix.replace(/[\\%_]/g, '\\$&')}%`)
      }
    }
    if (query.actor) {
      // The actor is either an account id or the email recorded in `meta`. The
      // `json_valid` guard keeps one malformed historical row from turning the
      // whole query into a 500.
      clauses.push(
        `(user_id = ? OR (json_valid(meta_json) AND json_extract(meta_json, '$.email') = ?))`,
      )
      values.push(query.actor, query.actor)
    }
    if (query.since != null) {
      clauses.push('at >= ?')
      values.push(query.since)
    }
    if (query.until != null) {
      clauses.push('at <= ?')
      values.push(query.until)
    }
    if (query.failuresOnly) {
      clauses.push(
        "(action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%denied%' OR action LIKE '%revoked%')",
      )
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    values.push(limit)
    return this.db
      .prepare(`SELECT * FROM audit ${where} ORDER BY id DESC LIMIT ?`)
      .all(...values) as AuditRow[]
  }

  // ── Retention ─────────────────────────────────────────────

  /** Expired pairing codes stay for forensics for a day, then go. */
  static readonly PAIR_CODE_RETENTION_MS = 24 * 60 * 60 * 1000
  /** Revoked sessions age out like expired ones. */
  static readonly REVOKED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000
  /** The audit trail is the long memory; a month is what an operator reads. */
  static readonly AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

  /**
   * Deletes rows whose usefulness has a natural end.
   *
   * None of these tables has a lifetime of its own: expired codes, dead
   * sessions and old audit rows accumulate forever on a gateway that simply
   * runs, and the database would grow to the size of its history rather than
   * the size of its live data. Every deletion is bounded by an index or by a
   * table that stays small, so the sweep is cheap enough to run hourly.
   */
  pruneExpired(now = Date.now()): { pairCodes: number; userSessions: number; audit: number } {
    if (this.closed) return { pairCodes: 0, userSessions: 0, audit: 0 }
    const pairCodes = this.db
      .prepare('DELETE FROM pair_codes WHERE expires_at < ?')
      .run(now - Store.PAIR_CODE_RETENTION_MS).changes
    const userSessions = this.db
      .prepare(
        `DELETE FROM user_sessions
          WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
      )
      .run(now, now - Store.REVOKED_SESSION_RETENTION_MS).changes
    const audit = this.db
      .prepare('DELETE FROM audit WHERE at < ?')
      .run(now - Store.AUDIT_RETENTION_MS).changes
    return { pairCodes, userSessions, audit }
  }

  // ── Push registrations ─────────────────────────────────────

  /**
   * Register (or re-register) how one device wants to be reached.
   *
   * A token is unique per provider: the same phone re-registering after an app
   * update must update its row rather than accumulate duplicates that would
   * each fire a notification. Re-registering also clears any recorded failure,
   * because reaching this code again means the app is alive and asking.
   *
   * Returns null when the token already belongs to a different account. A push
   * token is an address, not a secret, so a caller that merely knows it must
   * not be able to redirect another user's notifications to itself: the row
   * would follow the new device and the original phone would go silent.
   */
  upsertPushRegistration(registration: {
    deviceId: string
    provider: PushProviderName
    token: string
    platform: string
  }, now = Date.now()): PushRegistration | null {
    const existing = this.db.prepare(
      'SELECT * FROM push_registrations WHERE provider = ? AND token = ?',
    ).get(registration.provider, registration.token) as PushRegistrationRow | null

    if (existing) {
      if (existing.device_id !== registration.deviceId && this.devicesHaveDifferentOwners(existing.device_id, registration.deviceId)) {
        return null
      }
      this.db.prepare(
        `UPDATE push_registrations
         SET device_id = ?, platform = ?, updated_at = ?, last_error = NULL, failed_at = NULL
         WHERE id = ?`,
      ).run(registration.deviceId, registration.platform, now, existing.id)
      return toPushRegistration({
        ...existing,
        device_id: registration.deviceId,
        platform: registration.platform,
        updated_at: now,
        last_error: null,
        failed_at: null,
      })
    }

    const id = crypto.randomUUID()
    this.db.prepare(
      `INSERT INTO push_registrations
         (id, device_id, provider, token, platform, created_at, updated_at, last_error, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(id, registration.deviceId, registration.provider, registration.token, registration.platform, now, now)

    return {
      id,
      deviceId: registration.deviceId,
      provider: registration.provider,
      token: registration.token,
      platform: registration.platform,
      createdAt: now,
      updatedAt: now,
      lastError: null,
      failedAt: null,
    }
  }

  /**
   * Whether two devices belong to accounts that must not share a destination.
   *
   * Both ids must resolve to `user_id`s that differ. A legacy device (paired
   * with a code before accounts existed) has no owner, and the single-tenant
   * gateway it belongs to is the only one that can reach this code anyway —
   * so an unknown owner never blocks the update.
   */
  private devicesHaveDifferentOwners(leftId: string, rightId: string): boolean {
    const row = this.db.prepare(
      `SELECT
         (SELECT user_id FROM devices WHERE id = ?) AS left_user,
         (SELECT user_id FROM devices WHERE id = ?) AS right_user`,
    ).get(leftId, rightId) as { left_user: string | null; right_user: string | null }
    if (!row.left_user || !row.right_user) return false
    return row.left_user !== row.right_user
  }

  /**
   * Every live destination, or only those of one desktop.
   *
   * A shared gateway must not deliver one user's session events to another
   * user's phone, so a scoped call filters by the device's desktop (or account,
   * when the caller knows only that). An unscoped call remains for the admin
   * diagnostics endpoint and for legacy devices, which have no desktop.
   */
  listPushRegistrations(scope?: { desktopId?: string; userId?: string }): PushRegistration[] {
    if (!scope?.desktopId && !scope?.userId) {
      const rows = this.db.prepare(
        `SELECT r.* FROM push_registrations r
         JOIN devices d ON d.id = r.device_id
         WHERE d.revoked_at IS NULL AND r.failed_at IS NULL
         ORDER BY r.created_at ASC`,
      ).all() as PushRegistrationRow[]
      return rows.map(toPushRegistration)
    }

    const clauses = ['d.revoked_at IS NULL', 'r.failed_at IS NULL']
    const values: string[] = []
    if (scope.desktopId) {
      clauses.push('d.desktop_id = ?')
      values.push(scope.desktopId)
    }
    if (scope.userId) {
      clauses.push('d.user_id = ?')
      values.push(scope.userId)
    }
    const rows = this.db.prepare(
      `SELECT r.* FROM push_registrations r
       JOIN devices d ON d.id = r.device_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY r.created_at ASC`,
    ).all(...values) as PushRegistrationRow[]
    return rows.map(toPushRegistration)
  }

  /** Desktops that have at least one live push destination. */
  desktopsWithPushRegistrations(): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT d.desktop_id AS desktop_id FROM push_registrations r
       JOIN devices d ON d.id = r.device_id
       WHERE d.revoked_at IS NULL AND r.failed_at IS NULL AND d.desktop_id IS NOT NULL`,
    ).all() as Array<{ desktop_id: string }>
    return rows.map((row) => row.desktop_id)
  }

  listDevicePushRegistrations(deviceId: string): PushRegistration[] {
    const rows = this.db.prepare(
      'SELECT * FROM push_registrations WHERE device_id = ? ORDER BY created_at ASC',
    ).all(deviceId) as PushRegistrationRow[]
    return rows.map(toPushRegistration)
  }

  /**
   * Registrations that were marked dead, newest failure first.
   *
   * `listPushRegistrations` deliberately hides them (they must never be
   * retried), so the console needs a separate read for the "why did this phone
   * stop getting notifications" panel. Without it that panel could only ever
   * be empty.
   */
  listDeadPushRegistrations(): PushRegistration[] {
    const rows = this.db.prepare(
      'SELECT * FROM push_registrations WHERE failed_at IS NOT NULL ORDER BY failed_at DESC',
    ).all() as PushRegistrationRow[]
    return rows.map(toPushRegistration)
  }

  /**
   * One registration by id, dead ones included.
   *
   * The console needs both halves: "test this live destination" must not
   * reach a revoked device, while "remove this dead row" only makes sense for
   * a row that is already dead. Revocation is therefore reported rather than
   * hidden.
   */
  getPushRegistration(id: string): (PushRegistration & { deviceRevokedAt: number | null }) | null {
    const row = this.db.prepare(
      `SELECT r.*, d.revoked_at AS device_revoked_at
         FROM push_registrations r
         LEFT JOIN devices d ON d.id = r.device_id
        WHERE r.id = ?`,
    ).get(id) as (PushRegistrationRow & { device_revoked_at: number | null }) | null
    if (!row) return null
    return { ...toPushRegistration(row), deviceRevokedAt: row.device_revoked_at }
  }

  deletePushRegistration(id: string): boolean {
    return this.db.prepare('DELETE FROM push_registrations WHERE id = ?').run(id).changes > 0
  }

  /** Forget every registration a device owns; used when it unpairs. */
  deleteDevicePushRegistrations(deviceId: string): number {
    return this.db.prepare('DELETE FROM push_registrations WHERE device_id = ?').run(deviceId).changes
  }

  /**
   * Record that a delivery failed for good. The row is kept so an operator can
   * see why the phone stopped getting notifications; `listPushRegistrations`
   * skips it, so it is never retried.
   */
  markPushRegistrationDead(id: string, error: string, now = Date.now()): void {
    this.db.prepare('UPDATE push_registrations SET last_error = ?, failed_at = ? WHERE id = ?')
      .run(error, now, id)
  }

  countPushRegistrations(): { active: number; dead: number } {
    const row = this.db.prepare(
      `SELECT
         SUM(CASE WHEN failed_at IS NULL THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN failed_at IS NOT NULL THEN 1 ELSE 0 END) AS dead
       FROM push_registrations`,
    ).get() as { active: number | null; dead: number | null } | null
    return { active: row?.active ?? 0, dead: row?.dead ?? 0 }
  }

  // ── Accounts ───────────────────────────────────────────────

  createUser(user: {
    id: string
    email: string
    passwordHash: string
    displayName: string | null
    /** Defaults to an ordinary account; only the admin console passes 'admin'. */
    role?: UserRole
    now?: number
  }): UserRow {
    const now = user.now ?? Date.now()
    const role: UserRole = user.role ?? 'user'
    this.db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, created_at, disabled_at, role)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(user.id, user.email, user.passwordHash, user.displayName, now, role)
    return {
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      display_name: user.displayName,
      created_at: now,
      disabled_at: null,
      role,
    }
  }

  getUser(id: string): UserRow | null {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | null
  }

  getUserByEmail(email: string): UserRow | null {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | null
  }

  insertUserSession(session: {
    id: string
    userId: string
    tokenHash: string
    expiresAt: number
    now?: number
  }): UserSessionRow {
    const now = session.now ?? Date.now()
    this.db.prepare(
      `INSERT INTO user_sessions
         (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
    ).run(session.id, session.userId, session.tokenHash, now, session.expiresAt)
    return {
      id: session.id,
      user_id: session.userId,
      token_hash: session.tokenHash,
      created_at: now,
      last_seen_at: null,
      expires_at: session.expiresAt,
      revoked_at: null,
    }
  }

  getUserSession(id: string): UserSessionRow | null {
    return this.db.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as UserSessionRow | null
  }

  touchUserSession(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(now, id)
  }

  /**
   * Pushes one live session's expiry out to `expiresAt`.
   *
   * Only a session that is still usable is extended: extending a revoked or
   * already-expired row would resurrect a credential the owner ended.
   */
  extendUserSession(id: string, expiresAt: number, now = Date.now()): boolean {
    return this.db.prepare(
      `UPDATE user_sessions SET expires_at = ?, last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    ).run(expiresAt, now, id, now).changes > 0
  }

  revokeUserSession(id: string, now = Date.now()): boolean {
    return this.db.prepare(
      'UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    ).run(now, id).changes > 0
  }

  /**
   * Every live session of one account.
   *
   * A user who suspects a device was stolen needs to see which sessions exist
   * and end the ones that are not theirs. Only live rows are returned: an
   * expired or already-revoked session is not something to act on.
   */
  listUserSessions(userId: string, now = Date.now()): UserSessionRow[] {
    return this.db.prepare(
      `SELECT * FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`,
    ).all(userId, now) as UserSessionRow[]
  }

  /**
   * Ends an account's sessions, optionally sparing one.
   *
   * The spared id is the caller's own session: "sign out everywhere else"
   * must not log the person performing it out of the device they are using.
   */
  revokeUserSessions(userId: string, exceptSessionId: string | null = null, now = Date.now()): number {
    const statement = exceptSessionId
      ? 'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL'
      : 'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
    const args = exceptSessionId ? [now, userId, exceptSessionId] : [now, userId]
    return this.db.prepare(statement).run(...args).changes
  }

  /** Replaces the stored password hash; the account keeps its id. */
  updateUserPassword(userId: string, passwordHash: string, now = Date.now()): boolean {
    return this.db.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ? AND disabled_at IS NULL',
    ).run(passwordHash, userId).changes > 0
  }

  /**
   * The audit trail of one account.
   *
   * The admin view covers every row; a user asking what happened to their own
   * account must not see anyone else's. Rows are filtered by the account that
   * owns them, and the newest come first.
   */
  listAuditForUser(userId: string, limit = 50): AuditRow[] {
    return this.db.prepare(
      'SELECT * FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    ).all(userId, limit) as AuditRow[]
  }

  // ── Admin console ──────────────────────────────────────────

  /**
   * Promotes or demotes one account.
   *
   * The caller must not use this to demote the last admin; that check lives in
   * the route, where the refusal can explain itself. A missing row reports
   * false so the console can answer 404 instead of pretending success.
   */
  setUserRole(userId: string, role: UserRole): boolean {
    return this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId).changes > 0
  }

  /**
   * Disables an account without deleting it.
   *
   * Used by tests today and by an operator surface later; the important part is
   * that a disabled account is not a usable admin, which `countAdmins` and the
   * login path both already treat as true.
   */
  disableUser(userId: string, now = Date.now()): boolean {
    return this.db.prepare(
      'UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL',
    ).run(now, userId).changes > 0
  }

  listAdmins(): UserRow[] {
    return this.db.prepare(
      "SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC",
    ).all() as UserRow[]
  }

  /** How many usable admins exist — disabled accounts cannot sign in, so they do not count. */
  countAdmins(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL",
    ).get() as { n: number } | null
    return row?.n ?? 0
  }

  /**
   * How many accounts exist on this gateway.
   *
   * The shared route reads one upstream for every code-paired phone, so it is
   * only safe while this number is one. A deployment that grows to a second
   * account must stop offering it — that is a fact about the data, not a
   * setting an operator can forget to revisit.
   */
  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | null
    return row?.n ?? 0
  }

  /**
   * How many computers are enrolled on this gateway.
   *
   * Two desktops mean the shared route is ambiguous rather than merely
   * leaky: a device on it reads whichever computer the gateway happens to
   * share, so even a single account must name the machine it wants.
   */
  countDesktops(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM desktops WHERE revoked_at IS NULL',
    ).get() as { n: number } | null
    return row?.n ?? 0
  }

  /**
   * Every desktop with its owner and device count, for the console's list.
   *
   * A LEFT JOIN keeps a desktop whose owner row is somehow gone visible to an
   * operator instead of silently dropping a machine they are paying for.
   */
  listAllDesktops(): AdminDesktopRow[] {
    return this.db.prepare(
      `SELECT d.*, u.email AS owner_email,
              (SELECT COUNT(*) FROM devices v
                WHERE v.desktop_id = d.id AND v.revoked_at IS NULL) AS device_count
         FROM desktops d
         LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.created_at DESC`,
    ).all() as AdminDesktopRow[]
  }

  countDevicesForDesktop(desktopId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS n FROM devices WHERE desktop_id = ? AND revoked_at IS NULL',
    ).get(desktopId) as { n: number } | null
    return row?.n ?? 0
  }

  /**
   * Recent pairing codes, newest first, with no credential material.
   *
   * `code_hash` never leaves the database: the code is the secret, and an
   * operator screen only needs the lifecycle to see whether a code is still
   * claimable, who it was minted for, and whether it died unused.
   */
  listRecentPairCodes(limit = 20): PairCodeSummaryRow[] {
    return this.db.prepare(
      `SELECT p.created_at, p.expires_at, p.consumed_at, p.desktop_id, p.scopes_json,
              d.name AS desktop_name
         FROM pair_codes p
         LEFT JOIN desktops d ON d.id = p.desktop_id
        ORDER BY p.created_at DESC
        LIMIT ?`,
    ).all(limit) as PairCodeSummaryRow[]
  }

  // ── Desktops ───────────────────────────────────────────────

  /**
   * Create or refresh the desktop row for one app installation.
   *
   * The installation id is stable across logins, so signing in again rotates
   * this desktop's agent secret rather than registering a second machine the
   * user never sees.
   */
  upsertDesktop(desktop: {
    /** Id to use when the row is new; ignored for an existing installation. */
    id?: string
    userId: string
    installationId: string
    name: string
    platform: string
    tokenHash: string
    now?: number
  }): DesktopRow {
    const now = desktop.now ?? Date.now()
    const existing = this.db.prepare(
      'SELECT * FROM desktops WHERE user_id = ? AND installation_id = ?',
    ).get(desktop.userId, desktop.installationId) as DesktopRow | null

    if (existing) {
      this.db.prepare(
        `UPDATE desktops
         SET name = ?, platform = ?, token_hash = ?, revoked_at = NULL
         WHERE id = ?`,
      ).run(desktop.name, desktop.platform, desktop.tokenHash, existing.id)
      return {
        ...existing,
        name: desktop.name,
        platform: desktop.platform,
        token_hash: desktop.tokenHash,
        revoked_at: null,
      }
    }

    const id = desktop.id ?? crypto.randomUUID()
    this.db.prepare(
      `INSERT INTO desktops
         (id, user_id, installation_id, name, platform, token_hash, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(id, desktop.userId, desktop.installationId, desktop.name, desktop.platform, desktop.tokenHash, now)
    return {
      id,
      user_id: desktop.userId,
      installation_id: desktop.installationId,
      name: desktop.name,
      platform: desktop.platform,
      token_hash: desktop.tokenHash,
      created_at: now,
      last_seen_at: null,
      revoked_at: null,
    }
  }

  getDesktop(id: string): DesktopRow | null {
    return this.db.prepare('SELECT * FROM desktops WHERE id = ?').get(id) as DesktopRow | null
  }

  listDesktops(userId: string): DesktopRow[] {
    return this.db.prepare(
      'SELECT * FROM desktops WHERE user_id = ? ORDER BY created_at ASC',
    ).all(userId) as DesktopRow[]
  }

  /**
   * The row for one installation, including a revoked one.
   *
   * Signing in again after removing a computer must revive that same row: a
   * new id would leave every token minted against the old id dangling, and the
   * desktop's agent would connect to a route nothing points at.
   */
  findDesktopByInstallation(userId: string, installationId: string): DesktopRow | null {
    return this.db.prepare(
      'SELECT * FROM desktops WHERE user_id = ? AND installation_id = ?',
    ).get(userId, installationId) as DesktopRow | null
  }

  touchDesktop(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE desktops SET last_seen_at = ? WHERE id = ?').run(now, id)
  }

  revokeDesktop(id: string, userId: string, now = Date.now()): boolean {
    return this.db.prepare(
      'UPDATE desktops SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    ).run(now, id, userId).changes > 0
  }
}
