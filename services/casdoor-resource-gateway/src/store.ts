import { mkdir, rename, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export function normalizeAiRequestKey(key: string): string {
  return /^[a-f0-9]{64}$/i.test(key) ? key.toLowerCase() : createHash("sha256").update(key).digest("hex");
}

export type TenantPolicyStatus = "active" | "suspended" | "archived";
export type CasdoorResourceType = "project" | "knowledge_base" | "storage_connection";

export type CasdoorSessionKind = "desktop" | "web" | "automation" | "team" | "session";
export type CreditLedgerEntryType = "grant" | "purchase" | "consume" | "refund" | "expire" | "adjustment" | "reservation" | "release";
export type BillingOrderStatus = "pending" | "paid" | "failed" | "refunded" | "expired" | "cancelled";
export type CreditWalletStatus = "active" | "suspended" | "archived";
export type CreditWalletMemberRole = "owner" | "spender" | "viewer";

export interface CreditAccount {
  tenantId: string;
  subject: string;
  walletId?: string;
  plan: string;
  balance: number;
  reserved: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
  lifetimeRefunded: number;
  lifetimeExpired: number;
  updatedAt: string;
  version: number;
}

export interface CreditLedgerEntry {
  id: string;
  tenantId: string;
  subject: string;
  walletId?: string;
  type: CreditLedgerEntryType;
  amount: number;
  unit: "points";
  requestId?: string;
  idempotencyKey?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  newApiRequestId?: string;
  orderId?: string;
  paymentId?: string;
  paymentChannel?: string;
  amountMinor?: number;
  currency?: string;
  upstreamCost?: number;
  pointsSettled?: number;
  newApiGroup?: string;
  usageSource?: "new-api" | "estimated";
  pricingSnapshot?: CreditPricing;
  expiresAt?: string;
  sourceLedgerId?: string;
  previousHash?: string;
  entryHash?: string;
  actorSubject?: string;
  agentId?: string;
  sessionId?: string;
  reason?: string;
  createdAt: string;
  createdBy?: string;
}

export interface CreditPricing {
  model: string;
  inputPointsPerThousand: number;
  outputPointsPerThousand: number;
  minimumPoints: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  costCurrency?: string;
  costSource?: "configured-pricing" | "provider-reported" | "provider-reported-quota";
  updatedAt: string;
  updatedBy?: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  description?: string;
  currency: string;
  priceMinor: number;
  points: number;
  active: boolean;
  features: string[];
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  newApiGroup?: string;
  pointsValidDays?: number;
  entitlementsValidDays?: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface BillingEntitlements {
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  newApiGroup?: string;
}

export interface BillingOrder {
  id: string;
  orderNo: string;
  tenantId: string;
  subject: string;
  walletId?: string;
  planId: string;
  points: number;
  amountMinor: number;
  currency: string;
  status: BillingOrderStatus;
  idempotencyKey: string;
  paymentChannel?: string;
  paymentId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pointsValidDays?: number;
  pointsExpiresAt?: string;
  entitlementsValidDays?: number;
  entitlementsExpiresAt?: string;
  entitlements?: BillingEntitlements;
  paidAt?: string;
  refundedAt?: string;
}

export interface CreditWallet {
  id: string;
  tenantId: string;
  name: string;
  status: CreditWalletStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreditWalletMember {
  walletId: string;
  tenantId: string;
  subject: string;
  role: CreditWalletMemberRole;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface BillingSubscription {
  tenantId: string;
  subject: string;
  planId: string;
  orderNo: string;
  status: "active" | "cancelled";
  entitlements: BillingEntitlements;
  startedAt: string;
  entitlementsExpiresAt?: string;
  endedAt?: string;
  appliedPolicyVersion?: number;
  previousPolicy?: {
    status: "active" | "suspended" | "archived";
    maxResources: number;
    version: number;
    updatedAt: string;
    updatedBy?: string;
    modelAllowlist?: string[];
    mcpAllowlist?: string[];
    killSwitch?: boolean;
    maxTokensPerDay?: number;
    maxPointsPerDay?: number;
    newApiGroup?: string;
  };
}

export interface CreditExpiryRun {
  requestId: string;
  tenantIds: string[];
  expired: number;
  accounts: number;
  wallets: number;
  entitlementsExpired: boolean;
  createdAt: string;
}
export interface NewApiCostImport {
  id: string;
  tenantId: string;
  subject: string;
  walletId?: string;
  actorSubject?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  upstreamCost: number;
  currency: string;
  source: string;
  externalId: string;
  importKey: string;
  usageAt: string;
  importedAt: string;
  newApiRequestId?: string;
  newApiGroup?: string;
  agentId?: string;
  sessionId?: string;
  channel?: { id?: string; name?: string };
  cache?: { tokens?: number; ratio?: number; cacheTokens?: number };
  costBasis?: "provider-reported" | "provider-reported-quota" | "configured-pricing";
}
export interface AiRequestResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface AiRequestRecord {
  fingerprint: string;
  status: "running" | "completed";
  response?: AiRequestResponse;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ownerRequestId?: string;
}
export interface CasdoorSessionBinding {
  sessionId: string;
  subject: string;
  deviceFingerprint?: string;
  kind: CasdoorSessionKind;
  scopes: string[];
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ResourceStoreState {
  schemaVersion: number;
  revision?: number;
  resources: Array<{
    id: string;
    tenantId: string;
    ownerSubject: string;
    type: CasdoorResourceType;
    name: string;
    metadata: Record<string, string | number | boolean | null>;
    createdAt: string;
    updatedAt: string;
    version: number;
  }>;
  idempotency: Record<string, string>;
  tenantPolicies: Record<string, { status: TenantPolicyStatus; maxResources: number; version: number; updatedAt: string; updatedBy?: string; modelAllowlist?: string[]; mcpAllowlist?: string[]; killSwitch?: boolean; maxTokensPerDay?: number; tokensUsedToday?: number; tokensReservedToday?: number; maxPointsPerDay?: number; pointsUsedToday?: number; pointsReservedToday?: number; newApiGroup?: string }>;
  runtimeUsage: Record<string, { date: string; tokens: number; reservedTokens?: number; points?: number; reservedPoints?: number }>;
  memberRevocations: Record<string, Record<string, { subject: string; revokedAt: string; revokedBy: string; reason?: string }>>;
  authorizationVersions: Record<string, number>;
  sessions: Record<string, Record<string, CasdoorSessionBinding>>;
  creditAccounts: Record<string, CreditAccount>;
  creditWallets: Record<string, CreditWallet>;
  creditWalletMembers: Record<string, CreditWalletMember>;
  creditLedger: CreditLedgerEntry[];
  creditLedgerAnchorHash?: string;
  creditPricing: Record<string, CreditPricing>;
  billingPlans: Record<string, BillingPlan>;
  billingOrders: Record<string, BillingOrder>;
  billingSubscriptions: Record<string, BillingSubscription>;
  newApiCostImports: Record<string, NewApiCostImport>;
  aiRequests: Record<string, AiRequestRecord>;
  creditExpiryRuns: Record<string, CreditExpiryRun>;
}

export interface AuditEvent {
  requestId: string;
  at: string;
  subject?: string;
  tenantId?: string;
  resource?: string;
  action: string;
  outcome: "success" | "deny" | "error";
  reason?: string;
  traceId?: string;
}

export interface ResourceStoreAdapter {
  readonly kind: "json" | "postgres" | "mysql" | "memory";
  read(): Promise<ResourceStoreState>;
  write(state: ResourceStoreState): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(tenantId: string, limit: number): Promise<AuditEvent[]>;
  health(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  incrementRate(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
  archiveAudit?(beforeIsoDate: string): Promise<{ archived: number; remaining: number }>;
  registerSession(tenantId: string, binding: CasdoorSessionBinding): Promise<CasdoorSessionBinding>;
  listSessions(tenantId: string, limit: number): Promise<CasdoorSessionBinding[]>;
  unregisterSession(tenantId: string, sessionId: string): Promise<{ removed: boolean }>;
  bootstrap?(): Promise<void>;
}

const EMPTY_STATE: ResourceStoreState = { schemaVersion: 13, revision: 0, resources: [], idempotency: {}, tenantPolicies: {}, runtimeUsage: {}, memberRevocations: {}, authorizationVersions: {}, sessions: {}, creditAccounts: {}, creditWallets: {}, creditWalletMembers: {}, creditLedger: [], creditPricing: {}, billingPlans: {}, billingOrders: {}, billingSubscriptions: {}, newApiCostImports: {}, aiRequests: {}, creditExpiryRuns: {} };

export class JsonFileResourceStoreAdapter implements ResourceStoreAdapter {
  readonly kind = "json" as const;
  private readonly rateFile: string;
  private readonly resourceFile: string;
  private readonly auditFile: string;
  private readonly maxAuditBytes: number;
  private readonly dataDir: string;

  constructor(dataDir: string, maxAuditBytes = 50_000_000) {
    this.dataDir = dataDir;
    this.rateFile = join(dataDir, "rate-limit.json");
    this.resourceFile = join(dataDir, "resources.json");
    this.auditFile = join(dataDir, "audit.jsonl");
    this.maxAuditBytes = maxAuditBytes;
  }

  async incrementRate(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    let map: Record<string, { count: number; resetAt: number }> = {};
    try { map = JSON.parse(await readFile(this.rateFile, "utf8")) as Record<string, { count: number; resetAt: number }>; } catch { /* fresh */ }
    const current = map[key];
    if (!current || current.resetAt <= now) map[key] = { count: 1, resetAt: now + windowMs };
    else current.count += 1;
    const trimmed: Record<string, { count: number; resetAt: number }> = {};
    for (const [entryKey, value] of Object.entries(map)) if (value.resetAt > now) trimmed[entryKey] = value;
    await mkdir(this.dataDir, { recursive: true });
    const temporary = `${this.rateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(trimmed), { mode: 0o600 });
    await rename(temporary, this.rateFile);
    return { count: map[key]?.count ?? 1, resetAt: map[key]?.resetAt ?? now + windowMs };
  }

  async archiveAudit(beforeIsoDate: string): Promise<{ archived: number; remaining: number }> {
    try {
      const content = await readFile(this.auditFile, "utf8");
      const lines = content.split("\n");
      const keep: string[] = [];
      const archive: string[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as { at: string };
          if (event.at < beforeIsoDate) archive.push(line);
          else keep.push(line);
        } catch { keep.push(line); }
      }
      if (archive.length) {
        const archivePath = this.auditFile.replace(/\.jsonl$/, `-archived-${beforeIsoDate}.jsonl`);
        await writeFile(archivePath, `${archive.join("\n")}\n`, { mode: 0o600 });
      }
      await writeFile(this.auditFile, `${keep.join("\n")}\n`, { mode: 0o600 });
      return { archived: archive.length, remaining: keep.length };
    } catch { return { archived: 0, remaining: 0 }; }
  }
  async read(): Promise<ResourceStoreState> {
    try { return JSON.parse(await readFile(this.resourceFile, "utf8")) as ResourceStoreState; }
    catch {
      const fresh = { ...EMPTY_STATE };
      return fresh;
    }
  }

  async write(state: ResourceStoreState): Promise<void> {
    const temporary = `${this.resourceFile}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temporary, this.resourceFile);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    const line = `${JSON.stringify({ ...event, reason: event.reason?.slice(0, 240) })}\n`;
    await mkdir(this.dataDir, { recursive: true });
    try {
      const existing = await readFile(this.auditFile);
      if (existing.length + Buffer.byteLength(line) > this.maxAuditBytes) await writeFile(this.auditFile, existing.subarray(Math.max(0, existing.length - Math.floor(this.maxAuditBytes / 2))));
    } catch { /* first event */ }
    await writeFile(this.auditFile, line, { flag: "a", mode: 0o600 });
  }

  async listAudit(tenantId: string, limit: number): Promise<AuditEvent[]> {
    try {
      const content = await readFile(this.auditFile, "utf8");
      return content.split("\n").filter(Boolean).flatMap((line) => {
        try {
          const event = JSON.parse(line) as AuditEvent;
          return event.tenantId === tenantId ? [event] : [];
        } catch { return []; }
      }).slice(-limit);
    } catch { return []; }
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await mkdir(this.dataDir, { recursive: true });
      await readFile(this.resourceFile).catch(() => undefined);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async registerSession(tenantId: string, binding: CasdoorSessionBinding): Promise<CasdoorSessionBinding> {
    const state = await this.read();
    const bucket = state.sessions[tenantId] ?? {};
    const normalized = { ...binding, lastSeenAt: binding.lastSeenAt || new Date().toISOString() };
    bucket[binding.sessionId] = normalized;
    state.sessions[tenantId] = bucket;
    await this.write(state);
    return normalized;
  }

  async listSessions(tenantId: string, limit: number): Promise<CasdoorSessionBinding[]> {
    const state = await this.read();
    return Object.values(state.sessions[tenantId] ?? {}).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit);
  }

  async unregisterSession(tenantId: string, sessionId: string): Promise<{ removed: boolean }> {
    const state = await this.read();
    const bucket = state.sessions[tenantId];
    if (!bucket || !bucket[sessionId]) return { removed: false };
    delete bucket[sessionId];
    if (Object.keys(bucket).length === 0) delete state.sessions[tenantId];
    await this.write(state);
    return { removed: true };
  }

  async bootstrap(): Promise<void> {
    // JsonFile adapter lazily creates the data directory on first write/read; no schema bootstrap needed.
    await mkdir(this.dataDir, { recursive: true });
  }
}

export class InMemoryResourceStoreAdapter implements ResourceStoreAdapter {
  readonly kind = "memory" as const;
  private state: ResourceStoreState = { ...EMPTY_STATE };
  private audit: AuditEvent[] = [];
  private readonly auditLimit: number;
  private readonly rates = new Map<string, { count: number; resetAt: number }>();

  constructor(auditLimit = 10_000) { this.auditLimit = auditLimit; }

  async incrementRate(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    const current = this.rates.get(key);
    if (!current || current.resetAt <= now) this.rates.set(key, { count: 1, resetAt: now + windowMs });
    else current.count += 1;
    const entry = this.rates.get(key)!;
    if (this.rates.size > 10_000) for (const [entryKey, value] of this.rates) if (value.resetAt <= now) this.rates.delete(entryKey);
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async archiveAudit(beforeIsoDate: string): Promise<{ archived: number; remaining: number }> {
    const before = new Date(beforeIsoDate).getTime();
    const keep: AuditEvent[] = [];
    const archive: AuditEvent[] = [];
    for (const event of this.audit) {
      const at = new Date(event.at).getTime();
      if (Number.isFinite(before) && at < before) archive.push(event);
      else keep.push(event);
    }
    this.audit = keep;
    return { archived: archive.length, remaining: keep.length };
  }
  async read(): Promise<ResourceStoreState> { return JSON.parse(JSON.stringify(this.state)) as ResourceStoreState; }
  async write(state: ResourceStoreState): Promise<void> { this.state = JSON.parse(JSON.stringify(state)) as ResourceStoreState; }
  async appendAudit(event: AuditEvent): Promise<void> {
    this.audit.push(event);
    if (this.audit.length > this.auditLimit) this.audit.splice(0, this.audit.length - this.auditLimit);
  }
  async listAudit(tenantId: string, limit: number): Promise<AuditEvent[]> { return this.audit.filter((entry) => entry.tenantId === tenantId).slice(-limit); }
  async health(): Promise<{ ok: boolean; latencyMs: number }> { return { ok: true, latencyMs: 0 }; }

  async registerSession(tenantId: string, binding: CasdoorSessionBinding): Promise<CasdoorSessionBinding> {
    const bucket = this.state.sessions[tenantId] ?? {};
    bucket[binding.sessionId] = { ...binding, lastSeenAt: binding.lastSeenAt || new Date().toISOString() };
    this.state.sessions[tenantId] = bucket;
    return bucket[binding.sessionId];
  }

  async listSessions(tenantId: string, limit: number): Promise<CasdoorSessionBinding[]> {
    const bucket = this.state.sessions[tenantId] ?? {};
    return Object.values(bucket).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, limit);
  }

  async unregisterSession(tenantId: string, sessionId: string): Promise<{ removed: boolean }> {
    const bucket = this.state.sessions[tenantId];
    if (!bucket || !bucket[sessionId]) return { removed: false };
    delete bucket[sessionId];
    if (Object.keys(bucket).length === 0) delete this.state.sessions[tenantId];
    return { removed: true };
  }

  async bootstrap(): Promise<void> {
    // In-memory adapter needs no schema bootstrap.
  }
}

export interface SqlBackendOptions {
  connectionString: string;
  tablePrefix?: string;
}

interface SqlPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number; affectedRows?: number }>;
  end(): Promise<void>;
}

function storeWriteConflict(): Error {
  const error = new Error("resource state changed by another gateway instance");
  (error as Error & { code?: string }).code = "STORE_WRITE_CONFLICT";
  return error;
}

export async function createPostgresResourceStoreAdapter(options: SqlBackendOptions): Promise<ResourceStoreAdapter> {
  const pg = await import(/* @vite-ignore */ "pg").catch(() => null) as { Pool?: new (config: { connectionString: string }) => SqlPool } | null;
  if (!pg?.Pool) throw new Error("pg 模块未安装：部署时需在网关镜像中安装 pg 依赖");
  const pool = new pg.Pool({ connectionString: options.connectionString });
  return createSqlAdapter("postgres", pool, options.tablePrefix ?? "casdoor_");
}

export async function createMysqlResourceStoreAdapter(options: SqlBackendOptions): Promise<ResourceStoreAdapter> {
  const mysql = await import(/* @vite-ignore */ "mysql2/promise").catch(() => null) as { createPool?: (config: string) => { query(sql: string, params?: unknown[]): Promise<unknown>; end(): Promise<void> } } | null;
  if (!mysql?.createPool) throw new Error("mysql2 模块未安装：部署时需在网关镜像中安装 mysql2 依赖");
  const rawPool = mysql.createPool(options.connectionString);
  const pool: SqlPool = {
    async query(sql, params): Promise<{ rows: Array<Record<string, unknown>>; affectedRows?: number }> {
      const result = await rawPool.query(sql, params) as [unknown, unknown];
      const rows = result[0];
      if (Array.isArray(rows)) return { rows: rows as Array<Record<string, unknown>> };
      const header = rows && typeof rows === "object" ? rows as { affectedRows?: number } : {};
      return { rows: [], affectedRows: header.affectedRows };
    },
    end: () => rawPool.end(),
  };
  return createSqlAdapter("mysql", pool, options.tablePrefix ?? "casdoor_");
}

function createSqlAdapter(kind: "postgres" | "mysql", pool: SqlPool, prefix: string): ResourceStoreAdapter {
  const placeholder = kind === "postgres" ? "$" : "?";
  const parameter = (index: number): string => kind === "postgres" ? `$${index}` : placeholder;
  const sqlTime = (value: string): string | Date => kind === "postgres" ? value : new Date(value);
  return {
    kind,
    async incrementRate(key, windowMs, now): Promise<{ count: number; resetAt: number }> {
      if (kind === "postgres") {
        const result = await pool.query(`INSERT INTO ${prefix}rate_limits (key, count, reset_at) VALUES (${parameter(1)}, 1, ${parameter(2)}) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN ${prefix}rate_limits.reset_at <= ${parameter(2)} THEN 1 ELSE ${prefix}rate_limits.count + 1 END, reset_at = CASE WHEN ${prefix}rate_limits.reset_at <= ${parameter(2)} THEN ${parameter(3)} ELSE ${prefix}rate_limits.reset_at END RETURNING count, reset_at`, [key, now, now + windowMs]);
        const row = result.rows[0] ?? {};
        return { count: Number(row.count ?? 1), resetAt: Number(row.reset_at ?? now + windowMs) };
      }
      await pool.query(`INSERT INTO ${prefix}rate_limits (\`key\`, count, reset_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(reset_at <= ?, 1, count + 1), reset_at = IF(reset_at <= ?, ?, reset_at)`, [key, now, now, now, now + windowMs]);
      const result = await pool.query(`SELECT count, reset_at FROM ${prefix}rate_limits WHERE \`key\` = ?`, [key]);
      const row = result.rows[0] ?? {};
      return { count: Number(row.count ?? 1), resetAt: Number(row.reset_at ?? now + windowMs) };
    },
    async archiveAudit(beforeIsoDate): Promise<{ archived: number; remaining: number }> {
      if (kind === "postgres") {
        const result = await pool.query(`WITH archived AS (DELETE FROM ${prefix}audit_events WHERE at < ${parameter(1)} RETURNING 1) SELECT COUNT(*)::int AS archived FROM archived`, [beforeIsoDate]);
        const remaining = await pool.query(`SELECT COUNT(*)::int AS total FROM ${prefix}audit_events`);
        return { archived: Number(result.rows[0]?.archived ?? 0), remaining: Number(remaining.rows[0]?.total ?? 0) };
      }
      const result = await pool.query(`DELETE FROM ${prefix}audit_events WHERE at < ?`, [sqlTime(beforeIsoDate)]);
      const remaining = await pool.query(`SELECT COUNT(*) AS total FROM ${prefix}audit_events`);
      return { archived: Number(result.affectedRows ?? 0), remaining: Number(remaining.rows[0]?.total ?? 0) };
    },
    async read(): Promise<ResourceStoreState> {
      const result = await pool.query(`SELECT payload, revision FROM ${prefix}resource_state WHERE id = 1`);
      const payload = result.rows[0]?.payload;
      if (!payload) return { ...EMPTY_STATE };
      const state = typeof payload === "string" ? JSON.parse(payload) as ResourceStoreState : payload as ResourceStoreState;
      return { ...state, revision: Number(result.rows[0]?.revision ?? state.revision ?? 0) };
    },
    async write(next): Promise<void> {
      const revision = Number(next.revision ?? 0);
      const previousRevision = revision - 1;
      if (!Number.isSafeInteger(revision) || revision < 1) throw storeWriteConflict();
      if (kind === "postgres") {
        if (previousRevision === 0) {
          const inserted = await pool.query(`INSERT INTO ${prefix}resource_state (id, payload, revision, updated_at) VALUES (1, ${parameter(1)}, ${parameter(2)}, ${parameter(3)}) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(next), revision, new Date().toISOString()]);
          if (Number(inserted.rowCount ?? 0) === 1) return;
        }
        const updated = await pool.query(`UPDATE ${prefix}resource_state SET payload = ${parameter(1)}, revision = ${parameter(2)}, updated_at = ${parameter(3)} WHERE id = 1 AND revision = ${parameter(4)}`, [JSON.stringify(next), revision, new Date().toISOString(), previousRevision]);
        if (Number(updated.rowCount ?? 0) !== 1) throw storeWriteConflict();
      } else {
        if (previousRevision === 0) {
          const inserted = await pool.query(`INSERT IGNORE INTO ${prefix}resource_state (id, payload, revision, updated_at) VALUES (1, ?, ?, ?)`, [JSON.stringify(next), revision, new Date()]);
          if (Number(inserted.affectedRows ?? 0) === 1) return;
        }
        const updated = await pool.query(`UPDATE ${prefix}resource_state SET payload = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?`, [JSON.stringify(next), revision, new Date(), previousRevision]);
        if (Number(updated.affectedRows ?? 0) !== 1) throw storeWriteConflict();
      }
    },
    async appendAudit(event): Promise<void> {
      const values = [event.requestId, sqlTime(event.at), event.subject ?? null, event.tenantId ?? null, event.resource ?? null, event.action, event.outcome, event.reason ?? null, event.traceId ?? null];
      await pool.query(kind === "postgres"
        ? `INSERT INTO ${prefix}audit_events (request_id, at, subject, tenant_id, resource, action, outcome, reason, trace_id) VALUES (${parameter(1)}, ${parameter(2)}, ${parameter(3)}, ${parameter(4)}, ${parameter(5)}, ${parameter(6)}, ${parameter(7)}, ${parameter(8)}, ${parameter(9)})`
        : `INSERT INTO ${prefix}audit_events (request_id, at, subject, tenant_id, resource, action, outcome, reason, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, values);
    },
    async listAudit(tenantId, limit): Promise<AuditEvent[]> {
      const result = await pool.query(kind === "postgres"
        ? `SELECT request_id, at, subject, tenant_id, resource, action, outcome, reason, trace_id FROM ${prefix}audit_events WHERE tenant_id = ${parameter(1)} ORDER BY at DESC LIMIT ${parameter(2)}`
        : `SELECT request_id, at, subject, tenant_id, resource, action, outcome, reason, trace_id FROM ${prefix}audit_events WHERE tenant_id = ? ORDER BY at DESC LIMIT ?`, [tenantId, limit]);
      return (result.rows ?? []).map((row) => ({ requestId: String(row.request_id), at: String(row.at), subject: (row.subject as string | null) ?? undefined, tenantId: (row.tenant_id as string | null) ?? undefined, resource: (row.resource as string | null) ?? undefined, action: String(row.action), outcome: (row.outcome as "success" | "deny" | "error") ?? "success", reason: (row.reason as string | null) ?? undefined, traceId: (row.trace_id as string | null) ?? undefined })).reverse();
    },
    async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      const started = Date.now();
      try { await pool.query("SELECT 1"); return { ok: true, latencyMs: Date.now() - started }; }
      catch (error) { return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }; }
    },
    async registerSession(tenantId, binding): Promise<CasdoorSessionBinding> {
      const values = [tenantId, binding.sessionId, binding.subject, binding.deviceFingerprint ?? null, binding.kind, JSON.stringify(binding.scopes), sqlTime(binding.startedAt), sqlTime(binding.lastSeenAt || new Date().toISOString()), binding.endedAt ? sqlTime(binding.endedAt) : null, binding.metadata ? JSON.stringify(binding.metadata) : null];
      if (kind === "postgres") {
        const row = await pool.query(`INSERT INTO ${prefix}sessions (tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata) VALUES (${parameter(1)}, ${parameter(2)}, ${parameter(3)}, ${parameter(4)}, ${parameter(5)}, ${parameter(6)}, ${parameter(7)}, ${parameter(8)}, ${parameter(9)}, ${parameter(10)}) ON CONFLICT (tenant_id, session_id) DO UPDATE SET subject = EXCLUDED.subject, device_fingerprint = EXCLUDED.device_fingerprint, kind = EXCLUDED.kind, scopes = EXCLUDED.scopes, last_seen_at = EXCLUDED.last_seen_at, ended_at = EXCLUDED.ended_at, metadata = EXCLUDED.metadata RETURNING tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata`, values);
        return rowToSession(row.rows[0] ?? {});
      }
      await pool.query(`INSERT INTO ${prefix}sessions (tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE subject = VALUES(subject), device_fingerprint = VALUES(device_fingerprint), kind = VALUES(kind), scopes = VALUES(scopes), last_seen_at = VALUES(last_seen_at), ended_at = VALUES(ended_at), metadata = VALUES(metadata)`, values);
      const row = await pool.query(`SELECT tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata FROM ${prefix}sessions WHERE tenant_id = ? AND session_id = ?`, [tenantId, binding.sessionId]);
      return rowToSession(row.rows[0] ?? {});
    },
    async listSessions(tenantId, limit): Promise<CasdoorSessionBinding[]> {
      const result = await pool.query(kind === "postgres"
        ? `SELECT tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata FROM ${prefix}sessions WHERE tenant_id = ${parameter(1)} ORDER BY last_seen_at DESC LIMIT ${parameter(2)}`
        : `SELECT tenant_id, session_id, subject, device_fingerprint, kind, scopes, started_at, last_seen_at, ended_at, metadata FROM ${prefix}sessions WHERE tenant_id = ? ORDER BY last_seen_at DESC LIMIT ?`, [tenantId, limit]);
      return (result.rows ?? []).map(rowToSession);
    },
    async unregisterSession(tenantId, sessionId): Promise<{ removed: boolean }> {
      const result = await pool.query(kind === "postgres" ? `DELETE FROM ${prefix}sessions WHERE tenant_id = ${parameter(1)} AND session_id = ${parameter(2)}` : `DELETE FROM ${prefix}sessions WHERE tenant_id = ? AND session_id = ?`, [tenantId, sessionId]);
      const removed = kind === "postgres" ? Number(result.rowCount ?? 0) > 0 : Number(result.affectedRows ?? 0) > 0;
      return { removed };
    },
    async bootstrap(): Promise<void> {
      const statements = sqlBootstrapStatements(kind, prefix);
      for (const sql of statements) {
        try { await pool.query(sql); }
        catch (error) {
          const code = (error as { code?: string; errno?: number }).code;
          const errno = (error as { errno?: number }).errno;
          if (kind === "mysql" && (code === "ER_DUP_KEYNAME" || code === "ER_DUP_FIELDNAME" || errno === 1060 || errno === 1061)) continue;
          throw error;
        }
      }
    },
  };
}

export function sqlBootstrapStatements(kind: "postgres" | "mysql", prefix: string): string[] {
  if (kind === "mysql") {
    return [
      `CREATE TABLE IF NOT EXISTS ${prefix}resource_state (id INTEGER PRIMARY KEY, payload JSON NOT NULL, revision BIGINT NOT NULL DEFAULT 0, updated_at DATETIME(3) NOT NULL)`,
      `ALTER TABLE ${prefix}resource_state ADD COLUMN revision BIGINT NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS ${prefix}audit_events (request_id VARCHAR(191) NOT NULL, at DATETIME(3) NOT NULL, subject VARCHAR(255), tenant_id VARCHAR(255), resource VARCHAR(255), action VARCHAR(255) NOT NULL, outcome VARCHAR(32) NOT NULL, reason VARCHAR(1000), trace_id VARCHAR(255))`,
      `CREATE INDEX ${prefix}audit_events_tenant_idx ON ${prefix}audit_events (tenant_id, at)`,
      `CREATE TABLE IF NOT EXISTS ${prefix}rate_limits (\`key\` VARCHAR(255) PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, reset_at BIGINT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${prefix}sessions (tenant_id VARCHAR(255) NOT NULL, session_id VARCHAR(255) NOT NULL, subject VARCHAR(255) NOT NULL, device_fingerprint VARCHAR(255), kind VARCHAR(32) NOT NULL, scopes JSON NOT NULL, started_at DATETIME(3) NOT NULL, last_seen_at DATETIME(3) NOT NULL, ended_at DATETIME(3), metadata JSON, PRIMARY KEY (tenant_id, session_id))`,
      `CREATE INDEX ${prefix}sessions_tenant_last_seen_idx ON ${prefix}sessions (tenant_id, last_seen_at)`,
    ];
  }
  return [
    `CREATE TABLE IF NOT EXISTS ${prefix}resource_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `ALTER TABLE ${prefix}resource_state ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS ${prefix}audit_events (request_id TEXT NOT NULL, at TIMESTAMPTZ NOT NULL, subject TEXT, tenant_id TEXT, resource TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, trace_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS ${prefix}audit_events_tenant_idx ON ${prefix}audit_events (tenant_id, at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${prefix}rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 1, reset_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${prefix}sessions (tenant_id TEXT NOT NULL, session_id TEXT NOT NULL, subject TEXT NOT NULL, device_fingerprint TEXT, kind TEXT NOT NULL, scopes JSONB NOT NULL DEFAULT '[]', started_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, metadata JSONB, PRIMARY KEY (tenant_id, session_id))`,
    `CREATE INDEX IF NOT EXISTS ${prefix}sessions_tenant_last_seen_idx ON ${prefix}sessions (tenant_id, last_seen_at DESC)`,
  ];
}

function rowToSession(row: Record<string, unknown>): CasdoorSessionBinding {
  const scopesRaw = row.scopes;
  const metadataRaw = row.metadata;
  const scopes = typeof scopesRaw === "string" ? safeJsonStringArray(scopesRaw) : Array.isArray(scopesRaw) ? scopesRaw as string[] : [];
  const metadata = typeof metadataRaw === "string" ? safeJsonRecord(metadataRaw) : metadataRaw && typeof metadataRaw === "object" && !Array.isArray(metadataRaw) ? metadataRaw as Record<string, string | number | boolean | null> : undefined;
  return {
    sessionId: String(row.session_id),
    subject: String(row.subject),
    deviceFingerprint: (row.device_fingerprint as string | null) ?? undefined,
    kind: String(row.kind) as CasdoorSessionKind,
    scopes,
    startedAt: String(row.started_at),
    lastSeenAt: String(row.last_seen_at),
    endedAt: (row.ended_at as string | null) ?? undefined,
    metadata,
  };
}

function safeJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
}

function safeJsonRecord(raw: string): Record<string, string | number | boolean | null> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string | number | boolean | null> : undefined;
  } catch { return undefined; }
}

export interface SiemSink {
  kind: "syslog" | "webhook" | "csv";
  endpoint?: string;
  filePath?: string;
}

export async function appendSiem(event: AuditEvent, sink: SiemSink): Promise<void> {
  if (sink.kind === "webhook" && sink.endpoint) {
    try {
      await fetch(sink.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    } catch { /* drop to avoid audit feedback loop */ }
    return;
  }
  const fs = await import("node:fs/promises");
  if (sink.kind === "csv" && sink.filePath) {
    const header = "requestId,at,subject,tenantId,resource,action,outcome,reason\n";
    const row = [event.requestId, event.at, event.subject ?? "", event.tenantId ?? "", event.resource ?? "", event.action, event.outcome, (event.reason ?? "").replace(/[\r\n,]/g, " ")].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
    await fs.mkdir(sink.filePath.replace(/[^/]+$/, ""), { recursive: true });
    try {
      const existing = await fs.readFile(sink.filePath, "utf8");
      await fs.writeFile(sink.filePath, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${row}`);
    } catch {
      await fs.writeFile(sink.filePath, `${header}${row}`);
    }
    return;
  }
  if (sink.kind === "syslog") {
    const line = `<134>1 ${new Date(event.at).toISOString()} casdoor-gateway - casdoor ${event.tenantId ?? "-"} ${event.subject ?? "-"} ${event.action} ${event.outcome} ${event.reason ?? ""}\n`;
    await fs.mkdir("/var/log", { recursive: true });
    await fs.appendFile("/var/log/casdoor-audit.log", line).catch(async () => { await fs.writeFile("/var/log/casdoor-audit.log", line); });
  }
}
