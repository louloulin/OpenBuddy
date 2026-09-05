import {
  isCasdoorResourceType,
  normalizeCasdoorResourceIdempotencyKey,
  normalizeCasdoorResourceMetadata,
  normalizeCasdoorResourceName,
  type CasdoorResourceCreateInput,
  type CasdoorResourceRecord,
  type CasdoorResourceType,
  type CasdoorResourceUpdateInput,
  type CasdoorTenantPolicy,
  type CasdoorTenantPolicyPatch,
  type CasdoorAiCapabilities,
  type CasdoorCommercialModelCatalog,
  type CasdoorAiCapabilityModel,
  type CasdoorMemberRevocation,
  type CasdoorCreditAccount,
  type CasdoorCreditWallet,
  type CasdoorCreditWalletMember,
  type CasdoorCreditLedgerEntry,
  type CasdoorCreditPricing,
  type CasdoorCreditQuote,
  type CasdoorReconciliationReport,
  type CasdoorBillingPlan,
  type CasdoorBillingEntitlements,
  type CasdoorBillingSubscription,
  type CasdoorBillingPlanInput,
  type CasdoorBillingOrder,
  type CasdoorBillingOrderInput,
  type CasdoorBillingOrderStatus,
  type CasdoorReconciliationExport,
} from "@openbuddy/auth-casdoor";


import type { CasdoorTenantBudgetSummary } from "./resources";

const REQUEST_TIMEOUT_MS = 15_000;


/**
 * Cross-runtime HMAC-SHA256 helper.
 *
 * Replaces the previous dynamic `import("node:crypto")` so this module stays
 * bundleable for the renderer (Vite externalizes `node:*` for browser).
 * Uses `globalThis.crypto.subtle`, available in Node 18+, modern browsers,
 * and Electron renderers.
 */
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function safeUrl(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("企业资源 API 地址无效");
  }
  return url.toString().replace(/\/+$/, "");
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function resourceEndpoint(baseUrl: string, tenantId: string, id?: string): string {
  const path = `/v1/tenants/${encodeURIComponent(tenantId)}/resources`;
  return `${baseUrl}${path}${id ? `/${encodeURIComponent(id)}` : ""}`;
}

function tenantEndpoint(baseUrl: string, tenantId: string, resource: "policy" | "runtime-policy" | "runtime-usage" | "audit"): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/${resource}`;
}

function aiCapabilitiesEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ai/capabilities`;
}

function aiCatalogEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ai/catalog`;
}

function memberRevocationEndpoint(baseUrl: string, tenantId: string, subject: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/member-revocations/${encodeURIComponent(subject)}`;
}

function memberRevocationsEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/member-revocations`;
}

function sessionsEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/sessions`;
}

function sessionEndpoint(baseUrl: string, tenantId: string, sessionId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function creditsEndpoint(baseUrl: string, tenantId: string, operation?: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/credits${operation ? `/${operation}` : ""}`;
}

function walletsEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/wallets`;
}

function billingEndpoint(baseUrl: string, tenantId: string, resource: "plans" | "orders"): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/billing/${resource}`;
}

function billingOrderEndpoint(baseUrl: string, tenantId: string, orderNo: string, action: "refund" | "expire"): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/billing/orders/${encodeURIComponent(orderNo)}/${action}`;
}

const BILLING_ORDER_STATUSES: readonly CasdoorBillingOrderStatus[] = [
  "pending",
  "paid",
  "failed",
  "refunded",
  "expired",
  "cancelled",
];

function normalizeBillingPlanId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 80);
  return /^[a-zA-Z0-9_.:-]+$/.test(trimmed) ? trimmed : "";
}

function normalizeBillingOrderNo(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 120);
  return /^[a-zA-Z0-9_.:-]+$/.test(trimmed) ? trimmed : "";
}

function normalizeBillingStatus(value: unknown): CasdoorBillingOrderStatus {
  if (typeof value !== "string") return "pending";
  return BILLING_ORDER_STATUSES.includes(value as CasdoorBillingOrderStatus)
    ? (value as CasdoorBillingOrderStatus)
    : "pending";
}

function normalizeBillingEntitlements(value: unknown): CasdoorBillingEntitlements | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const maxTokensPerDay = typeof item.maxTokensPerDay === "number" && Number.isSafeInteger(item.maxTokensPerDay) && item.maxTokensPerDay >= 0 ? item.maxTokensPerDay : undefined;
  const maxPointsPerDay = typeof item.maxPointsPerDay === "number" && Number.isSafeInteger(item.maxPointsPerDay) && item.maxPointsPerDay >= 0 ? item.maxPointsPerDay : undefined;
  const modelAllowlist = Array.isArray(item.modelAllowlist) ? item.modelAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 256) : undefined;
  const mcpAllowlist = Array.isArray(item.mcpAllowlist) ? item.mcpAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 256) : undefined;
  const newApiGroup = typeof item.newApiGroup === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(item.newApiGroup.trim()) ? item.newApiGroup.trim() : undefined;
  if (maxTokensPerDay === undefined && maxPointsPerDay === undefined && !modelAllowlist?.length && !mcpAllowlist?.length && !newApiGroup) return {};
  return { ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(modelAllowlist?.length ? { modelAllowlist } : {}), ...(mcpAllowlist?.length ? { mcpAllowlist } : {}), ...(newApiGroup ? { newApiGroup } : {}) };
}

function normalizeBillingPlan(value: unknown): CasdoorBillingPlan | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = normalizeBillingPlanId(item.id);
  const name = typeof item.name === "string" ? item.name.replace(/[\r\n\t]/g, " ").trim().slice(0, 120) : "";
  const currency = typeof item.currency === "string" && item.currency.trim() ? item.currency.trim().slice(0, 8) : "CNY";
  const priceMinor = typeof item.priceMinor === "number" && Number.isFinite(item.priceMinor) ? Math.max(0, Math.floor(item.priceMinor)) : 0;
  const points = typeof item.points === "number" && Number.isFinite(item.points) ? Math.max(0, Math.floor(item.points)) : 0;
  const active = item.active !== false;
  const features = Array.isArray(item.features)
    ? item.features.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.replace(/[\r\n\t]/g, " ").trim().slice(0, 120)).filter(Boolean).slice(0, 32)
    : [];
  const maxTokensPerDay = typeof item.maxTokensPerDay === "number" && Number.isSafeInteger(item.maxTokensPerDay) && item.maxTokensPerDay >= 0 ? item.maxTokensPerDay : undefined;
  const maxPointsPerDay = typeof item.maxPointsPerDay === "number" && Number.isSafeInteger(item.maxPointsPerDay) && item.maxPointsPerDay >= 0 ? item.maxPointsPerDay : undefined;
  const modelAllowlist = Array.isArray(item.modelAllowlist) ? item.modelAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 256) : undefined;
  const mcpAllowlist = Array.isArray(item.mcpAllowlist) ? item.mcpAllowlist.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 256) : undefined;
  const newApiGroup = typeof item.newApiGroup === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(item.newApiGroup.trim()) ? item.newApiGroup.trim() : undefined;
  const pointsValidDays = typeof item.pointsValidDays === "number" && Number.isSafeInteger(item.pointsValidDays) && item.pointsValidDays >= 1 && item.pointsValidDays <= 3650 ? item.pointsValidDays : undefined;
  const entitlementsValidDays = typeof item.entitlementsValidDays === "number" && Number.isSafeInteger(item.entitlementsValidDays) && item.entitlementsValidDays >= 1 && item.entitlementsValidDays <= 3650 ? item.entitlementsValidDays : undefined;
  const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date(0).toISOString();
  if (!id || !name || points < 1) return null;
  const plan: CasdoorBillingPlan = { id, name, currency, priceMinor, points, active, features, ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(modelAllowlist?.length ? { modelAllowlist } : {}), ...(mcpAllowlist?.length ? { mcpAllowlist } : {}), ...(newApiGroup ? { newApiGroup } : {}), ...(pointsValidDays === undefined ? {} : { pointsValidDays }), ...(entitlementsValidDays === undefined ? {} : { entitlementsValidDays }), updatedAt };
  if (typeof item.description === "string" && item.description.trim()) {
    plan.description = item.description.replace(/[\r\n\t]/g, " ").trim().slice(0, 500);
  }
  if (typeof item.updatedBy === "string" && item.updatedBy.trim()) {
    plan.updatedBy = item.updatedBy.trim().slice(0, 200);
  }
  return plan;
}

function normalizeBillingOrder(value: unknown): CasdoorBillingOrder | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 120) : "";
  const orderNo = normalizeBillingOrderNo(item.orderNo);
  const tenantId = typeof item.tenantId === "string" && item.tenantId.trim() ? item.tenantId.trim().slice(0, 200) : "";
  const subject = typeof item.subject === "string" && item.subject.trim() ? item.subject.trim().slice(0, 200) : "";
  const walletId = typeof item.walletId === "string" && item.walletId.trim() ? item.walletId.trim().slice(0, 120) : undefined;
  const planId = normalizeBillingPlanId(item.planId);
  const points = typeof item.points === "number" && Number.isFinite(item.points) ? Math.max(0, Math.floor(item.points)) : 0;
  const amountMinor = typeof item.amountMinor === "number" && Number.isFinite(item.amountMinor) ? Math.max(0, Math.floor(item.amountMinor)) : 0;
  const currency = typeof item.currency === "string" && item.currency.trim() ? item.currency.trim().slice(0, 8) : "CNY";
  const status = normalizeBillingStatus(item.status);
  const idempotencyKey = typeof item.idempotencyKey === "string" && item.idempotencyKey.trim()
    ? item.idempotencyKey.trim().slice(0, 120)
    : "";
  const createdAt = typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date(0).toISOString();
  const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : createdAt;
  const expiresAt = typeof item.expiresAt === "string" && item.expiresAt ? item.expiresAt : createdAt;
  if (!id || !orderNo || !tenantId || !subject || !planId || !idempotencyKey) return null;
  const order: CasdoorBillingOrder = {
    id, orderNo, tenantId, subject, planId, points, amountMinor, currency, status, idempotencyKey,
    createdAt, updatedAt, expiresAt,
  };
  if (walletId) order.walletId = walletId;
  const pointsValidDays = typeof item.pointsValidDays === "number" && Number.isSafeInteger(item.pointsValidDays) && item.pointsValidDays >= 1 && item.pointsValidDays <= 3650 ? item.pointsValidDays : undefined;
  const pointsExpiresAt = typeof item.pointsExpiresAt === "string" && item.pointsExpiresAt ? item.pointsExpiresAt : undefined;
  if (pointsValidDays !== undefined) order.pointsValidDays = pointsValidDays;
  const entitlementsValidDays = typeof item.entitlementsValidDays === "number" && Number.isSafeInteger(item.entitlementsValidDays) && item.entitlementsValidDays >= 1 && item.entitlementsValidDays <= 3650 ? item.entitlementsValidDays : undefined;
  const entitlementsExpiresAt = typeof item.entitlementsExpiresAt === "string" && item.entitlementsExpiresAt ? item.entitlementsExpiresAt : undefined;
  if (entitlementsValidDays !== undefined) order.entitlementsValidDays = entitlementsValidDays;
  if (entitlementsExpiresAt) order.entitlementsExpiresAt = entitlementsExpiresAt;
  if (pointsExpiresAt) order.pointsExpiresAt = pointsExpiresAt;
  if (typeof item.paymentChannel === "string" && item.paymentChannel.trim()) order.paymentChannel = item.paymentChannel.trim().slice(0, 64);
  if (typeof item.paymentId === "string" && item.paymentId.trim()) order.paymentId = item.paymentId.trim().slice(0, 120);
  if (typeof item.failureReason === "string" && item.failureReason.trim()) order.failureReason = item.failureReason.replace(/[\r\n\t]/g, " ").trim().slice(0, 240);
  const entitlements = normalizeBillingEntitlements(item.entitlements);
  if (entitlements !== undefined) order.entitlements = entitlements;
  if (typeof item.paidAt === "string" && item.paidAt) order.paidAt = item.paidAt;
  if (typeof item.refundedAt === "string" && item.refundedAt) order.refundedAt = item.refundedAt;
  return order;
}

function buildTraceparent(initHeaders: RequestInit["headers"]): string | undefined {
  if (!initHeaders) return undefined;
  const headers = new Headers(initHeaders as HeadersInit);
  const existing = headers.get("traceparent");
  if (existing && /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.test(existing.trim())) return existing.trim();
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  return `00-${traceId}-${spanId}-01`;
}

function randomHex(length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function redactMessage(value: unknown): string {
  if (typeof value !== "string") return "企业资源 API 请求失败";
  return value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(token|secret|password|credential)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 240);
}

function payloadData(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const objectValue = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(objectValue, "data") ? objectValue.data : value;
}

function normalizeRemoteResource(value: unknown): CasdoorResourceRecord | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const tenantId = typeof entry.tenantId === "string" ? entry.tenantId.trim() : "";
  const ownerSubject = typeof entry.ownerSubject === "string" ? entry.ownerSubject.trim() : "";
  const type = entry.type;
  const name = normalizeCasdoorResourceName(entry.name);
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : "";
  const version = typeof entry.version === "number" && Number.isInteger(entry.version) ? entry.version : 0;
  if (!id || !tenantId || !ownerSubject || !isCasdoorResourceType(type) || !name || !createdAt || !updatedAt || version < 1) return null;
  return { id, tenantId, ownerSubject, type, name, metadata: normalizeCasdoorResourceMetadata(entry.metadata), createdAt, updatedAt, version };
}

export class CasdoorResourceBackend {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.baseUrl = safeUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
    const traceparent = buildTraceparent(init.headers);
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
        ...(traceparent ? { traceparent } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || body?.status === "error") {
      const message = redactMessage(body?.message ?? body?.msg ?? `企业资源 API 请求失败 (${response.status})`);
      const code = typeof body?.code === "string" && /^[A-Z0-9_:-]{2,80}$/.test(body.code) ? body.code : undefined;
      const error = new Error(`${code ? `${code}: ` : ""}${message}`) as Error & { code?: string; statusCode?: number };
      if (code) error.code = code;
      error.statusCode = response.status;
      throw error;
    }
    return payloadData(body) as T;
  }

  async list(token: string, tenantId: string, type?: CasdoorResourceType): Promise<CasdoorResourceRecord[]> {
    const query = type ? `?type=${encodeURIComponent(type)}` : "";
    const data = await this.request<unknown>(token, `${resourceEndpoint(this.baseUrl, tenantId)}${query}`);
    if (!Array.isArray(data)) return [];
    return data.map(normalizeRemoteResource).filter((entry): entry is CasdoorResourceRecord => Boolean(entry && entry.tenantId === tenantId));
  }

  async get(token: string, tenantId: string, id: string): Promise<CasdoorResourceRecord> {
    const resource = normalizeRemoteResource(await this.request(token, resourceEndpoint(this.baseUrl, tenantId, id)));
    if (!resource || resource.tenantId !== tenantId) throw new Error("企业资源 API 返回了无效资源");
    return resource;
  }

  async create(token: string, tenantId: string, input: CasdoorResourceCreateInput): Promise<CasdoorResourceRecord> {
    const resource = normalizeRemoteResource(await this.request(token, resourceEndpoint(this.baseUrl, tenantId), {
      method: "POST",
      headers: normalizeCasdoorResourceIdempotencyKey(input.idempotencyKey) ? { "idempotency-key": normalizeCasdoorResourceIdempotencyKey(input.idempotencyKey)! } : {},
      body: JSON.stringify({ type: input.type, name: normalizeCasdoorResourceName(input.name), metadata: normalizeCasdoorResourceMetadata(input.metadata) }),
    }));
    if (!resource || resource.tenantId !== tenantId) throw new Error("企业资源 API 返回了无效资源");
    return resource;
  }

  async update(token: string, tenantId: string, id: string, input: CasdoorResourceUpdateInput): Promise<CasdoorResourceRecord> {
    const resource = normalizeRemoteResource(await this.request(token, resourceEndpoint(this.baseUrl, tenantId, id), {
      method: "PATCH",
      headers: { "if-match": String(input.expectedVersion) },
      body: JSON.stringify({
        ...(input.name === undefined ? {} : { name: normalizeCasdoorResourceName(input.name) }),
        ...(input.metadata === undefined ? {} : { metadata: normalizeCasdoorResourceMetadata(input.metadata) }),
      }),
    }));
    if (!resource || resource.tenantId !== tenantId) throw new Error("企业资源 API 返回了无效资源");
    return resource;
  }

  async delete(token: string, tenantId: string, id: string, expectedVersion: number): Promise<{ ok: true }> {
    await this.request(token, resourceEndpoint(this.baseUrl, tenantId, id), { method: "DELETE", headers: { "if-match": String(expectedVersion) } });
    return { ok: true };
  }

  async getTenantPolicy(token: string, tenantId: string): Promise<CasdoorTenantPolicy> {
    return normalizeTenantPolicy(await this.request(token, tenantEndpoint(this.baseUrl, tenantId, "policy")));
  }

  async getRuntimePolicy(token: string, tenantId: string): Promise<CasdoorTenantPolicy> {
    return normalizeTenantPolicy(await this.request(token, tenantEndpoint(this.baseUrl, tenantId, "runtime-policy")));
  }

  async recordRuntimeUsage(token: string, tenantId: string, tokens: number, points = 0): Promise<CasdoorTenantPolicy> {
    return normalizeTenantPolicy(await this.request(token, tenantEndpoint(this.baseUrl, tenantId, "runtime-usage"), {
      method: "POST",
      body: JSON.stringify({ tokens: Math.max(0, Math.min(10_000_000, Math.floor(tokens))), ...(points > 0 ? { points: Math.min(1_000_000_000, Math.floor(points)) } : {}) }),
    }));
  }

  async updateTenantPolicy(token: string, tenantId: string, patch: CasdoorTenantPolicyPatch): Promise<CasdoorTenantPolicy> {
    return normalizeTenantPolicy(await this.request(token, tenantEndpoint(this.baseUrl, tenantId, "policy"), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }));
  }

  async getAiCapabilities(token: string, tenantId: string): Promise<CasdoorAiCapabilities> {
    return normalizeAiCapabilities(await this.request(token, aiCapabilitiesEndpoint(this.baseUrl, tenantId)));
  }

  async getCommercialModelCatalog(token: string, tenantId: string): Promise<CasdoorCommercialModelCatalog> {
    return normalizeCommercialModelCatalog(await this.request<unknown>(token, aiCatalogEndpoint(this.baseUrl, tenantId)));
  }

  async getCredits(token: string, tenantId: string, subject?: string): Promise<CasdoorCreditAccount> {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
    return this.request<CasdoorCreditAccount>(token, `${creditsEndpoint(this.baseUrl, tenantId)}${query}`);
  }

  async listCreditWallets(token: string, tenantId: string): Promise<CasdoorCreditWallet[]> {
    const data = await this.request<unknown>(token, walletsEndpoint(this.baseUrl, tenantId));
    if (!Array.isArray(data)) throw new Error("共享钱包 API 返回无效");
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const walletTenantId = typeof item.tenantId === "string" ? item.tenantId.trim() : "";
      const status = item.status === "active" || item.status === "suspended" || item.status === "archived" ? item.status : undefined;
      const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
      const createdBy = typeof item.createdBy === "string" ? item.createdBy : "";
      if (!id || !name || walletTenantId !== tenantId || !status || !createdAt || !updatedAt || !createdBy) return [];
      const members = Array.isArray(item.members) ? item.members.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const member = entry as Record<string, unknown>;
        const subject = typeof member.subject === "string" ? member.subject.trim() : "";
        const role = member.role === "owner" || member.role === "spender" || member.role === "viewer" ? member.role : undefined;
        const memberTenantId = typeof member.tenantId === "string" ? member.tenantId.trim() : "";
        const walletId = typeof member.walletId === "string" ? member.walletId.trim() : "";
        const memberCreatedAt = typeof member.createdAt === "string" ? member.createdAt : "";
        const memberUpdatedAt = typeof member.updatedAt === "string" ? member.updatedAt : "";
        const memberCreatedBy = typeof member.createdBy === "string" ? member.createdBy : "";
        if (!subject || !role || memberTenantId !== tenantId || walletId !== id || !memberCreatedAt || !memberUpdatedAt || !memberCreatedBy) return [];
        return [{ walletId, tenantId: memberTenantId, subject, role, createdAt: memberCreatedAt, updatedAt: memberUpdatedAt, createdBy: memberCreatedBy } satisfies CasdoorCreditWalletMember];
      }) : undefined;
      return [{ id, tenantId: walletTenantId, name, status, createdAt, updatedAt, createdBy, ...(members ? { members } : {}) } satisfies CasdoorCreditWallet];
    });
  }

  async getCreditWalletCredits(token: string, tenantId: string, walletId: string): Promise<CasdoorCreditAccount> {
    return this.request<CasdoorCreditAccount>(token, `${walletsEndpoint(this.baseUrl, tenantId)}/${encodeURIComponent(walletId)}/credits`);
  }

  async listCreditWalletLedger(token: string, tenantId: string, walletId: string, limit = 100): Promise<CasdoorCreditLedgerEntry[]> {
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(500, Math.floor(limit)))) });
    const data = await this.request<unknown>(token, `${walletsEndpoint(this.baseUrl, tenantId)}/${encodeURIComponent(walletId)}/ledger?${query}`);
    return Array.isArray(data) ? data as CasdoorCreditLedgerEntry[] : [];
  }

  async listCreditLedger(token: string, tenantId: string, limit = 100, subject?: string): Promise<CasdoorCreditLedgerEntry[]> {
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(500, Math.floor(limit)))) });
    if (subject) query.set("subject", subject);
    const data = await this.request<unknown>(token, `${creditsEndpoint(this.baseUrl, tenantId, "ledger")}?${query}`);
    return Array.isArray(data) ? data as CasdoorCreditLedgerEntry[] : [];
  }

  async getCreditReconciliation(token: string, tenantId: string, since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationReport> {
    const query = new URLSearchParams();
    if (since) query.set("since", since);
    if (until) query.set("until", until);
    if (walletId?.trim()) query.set("walletId", walletId.trim());
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request<CasdoorReconciliationReport>(token, `${creditsEndpoint(this.baseUrl, tenantId, "reconciliation")}${suffix}`);
  }

  async getCreditReconciliationExport(token: string, tenantId: string, since?: string, until?: string, walletId?: string): Promise<CasdoorReconciliationExport> {
    const query = new URLSearchParams({ format: "csv" });
    if (since) query.set("since", since);
    if (until) query.set("until", until);
    if (walletId?.trim()) query.set("walletId", walletId.trim());
    const response = await this.fetchImpl(`${this.baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/credits/reconciliation/export?${query}`, {
      headers: { accept: "text/csv" , authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) {
      let message = `企业资源 API 请求失败 (${response.status})`;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        message = redactMessage(parsed.message ?? parsed.msg ?? message);
      } catch { /* response is not JSON */ }
      const error = new Error(message) as Error & { statusCode?: number };
      error.statusCode = response.status;
      throw error;
    }
    if (body.length > 10 * 1024 * 1024) throw new Error("对账导出文件超过大小限制");
    return {
      filename: response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "openbuddy-reconciliation.csv",
      contentType: response.headers.get("content-type") ?? "text/csv; charset=utf-8",
      reportId: response.headers.get("x-openbuddy-report-id") ?? "",
      reportHash: response.headers.get("x-openbuddy-report-hash") ?? "",
      body,
    };
  }

  async listCreditPricing(token: string, tenantId: string): Promise<CasdoorCreditPricing[]> {
    const data = await this.request<unknown>(token, creditsEndpoint(this.baseUrl, tenantId, "pricing"));
    return Array.isArray(data) ? data as CasdoorCreditPricing[] : [];
  }

  async quoteCredits(token: string, tenantId: string, input: { model: string; promptTokens: number; completionTokens: number }): Promise<CasdoorCreditQuote> {
    return this.request<CasdoorCreditQuote>(token, creditsEndpoint(this.baseUrl, tenantId, "quote"), { method: "POST", body: JSON.stringify(input) });
  }

  async updateCreditPricing(token: string, tenantId: string, input: Omit<CasdoorCreditPricing, "updatedAt" | "updatedBy">): Promise<CasdoorCreditPricing> {
    return this.request<CasdoorCreditPricing>(token, creditsEndpoint(this.baseUrl, tenantId, "pricing"), { method: "PATCH", body: JSON.stringify(input) });
  }

  async grantCredits(token: string, tenantId: string, input: { subject?: string; amount: number; type?: "grant"; reason?: string; validDays?: number; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    return this.request(token, creditsEndpoint(this.baseUrl, tenantId, "grant"), { method: "POST", body: JSON.stringify(input) });
  }

  async issueWelcomeCredit(token: string, tenantId: string, input: { subject?: string; idempotencyKey: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    return this.request(token, creditsEndpoint(this.baseUrl, tenantId, "welcome"), { method: "POST", body: JSON.stringify(input) });
  }

  async reserveCredits(token: string, tenantId: string, input: { amount?: number; model?: string; promptTokens?: number; completionTokens?: number; idempotencyKey: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry }> {
    return this.request(token, creditsEndpoint(this.baseUrl, tenantId, "reserve"), { method: "POST", body: JSON.stringify(input) });
  }

  async settleCredits(token: string, tenantId: string, input: { reservationKey: string; amount: number; model?: string; promptTokens?: number; completionTokens?: number; newApiRequestId?: string; reason?: string }): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
    return this.request(token, creditsEndpoint(this.baseUrl, tenantId, "settle"), { method: "POST", body: JSON.stringify(input) });
  }

  async releaseCredits(token: string, tenantId: string, reservationKey: string): Promise<{ account: CasdoorCreditAccount; entry: CasdoorCreditLedgerEntry; refunded?: number }> {
    return this.request(token, creditsEndpoint(this.baseUrl, tenantId, "release"), { method: "POST", body: JSON.stringify({ reservationKey }) });
  }

  async expireCredits(token: string, tenantId: string, subject?: string): Promise<{ expired: number; account: CasdoorCreditAccount }> {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
    return this.request(token, `${creditsEndpoint(this.baseUrl, tenantId, "expire")}${query}`, { method: "POST" });
  }

  async listBillingPlans(token: string, tenantId: string): Promise<CasdoorBillingPlan[]> {
    const data = await this.request<unknown>(token, billingEndpoint(this.baseUrl, tenantId, "plans"));
    if (!Array.isArray(data)) throw new Error("套餐目录 API 返回无效");
    return data.flatMap((entry) => {
      const plan = normalizeBillingPlan(entry);
      return plan ? [plan] : [];
    });
  }

  async getBillingSubscription(token: string, tenantId: string): Promise<CasdoorBillingSubscription | null> {
    const data = await this.request<unknown>(token, `${this.baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/billing/subscription`);
    if (data === null) return null;
    if (!data || typeof data !== "object") throw new Error("当前订阅 API 返回无效");
    const item = data as Record<string, unknown>;
    const entitlements = normalizeBillingEntitlements(item.entitlements) ?? {};
    const status = item.status === "active" || item.status === "cancelled" ? item.status : undefined;
    const tenant = typeof item.tenantId === "string" ? item.tenantId.trim() : "";
    const subject = typeof item.subject === "string" ? item.subject.trim() : "";
    const planId = normalizeBillingPlanId(item.planId);
    const orderNo = normalizeBillingOrderNo(item.orderNo);
    const startedAt = typeof item.startedAt === "string" && item.startedAt ? item.startedAt : "";
    if (!tenant || !subject || !planId || !orderNo || !status || !startedAt) throw new Error("当前订阅 API 返回无效");
    const entitlementsExpiresAt = typeof item.entitlementsExpiresAt === "string" && item.entitlementsExpiresAt ? item.entitlementsExpiresAt : undefined;
    return { tenantId: tenant, subject, planId, orderNo, status, entitlements, startedAt, ...(entitlementsExpiresAt ? { entitlementsExpiresAt } : {}), ...(typeof item.endedAt === "string" ? { endedAt: item.endedAt } : {}), ...(typeof item.appliedPolicyVersion === "number" && Number.isSafeInteger(item.appliedPolicyVersion) ? { appliedPolicyVersion: item.appliedPolicyVersion } : {}) };
  }

  async upsertBillingPlan(token: string, tenantId: string, input: CasdoorBillingPlanInput): Promise<CasdoorBillingPlan> {
    const data = await this.request<unknown>(token, billingEndpoint(this.baseUrl, tenantId, "plans"), {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    const plan = normalizeBillingPlan(data);
    if (!plan) throw new Error("套餐目录 API 返回无效");
    return plan;
  }

  async listBillingOrders(token: string, tenantId: string, subject?: string, limit = 100): Promise<CasdoorBillingOrder[]> {
    const query = new URLSearchParams();
    if (subject) query.set("subject", subject);
    query.set("limit", String(Math.max(1, Math.min(500, Math.floor(limit)))));
    const data = await this.request<unknown>(token, `${billingEndpoint(this.baseUrl, tenantId, "orders")}?${query}`);
    if (!Array.isArray(data)) throw new Error("订单列表 API 返回无效");
    return data.flatMap((entry) => {
      const order = normalizeBillingOrder(entry);
      return order ? [order] : [];
    });
  }

  async createBillingOrder(token: string, tenantId: string, input: CasdoorBillingOrderInput): Promise<CasdoorBillingOrder> {
    const data = await this.request<unknown>(token, billingEndpoint(this.baseUrl, tenantId, "orders"), {
      method: "POST",
      body: JSON.stringify(input),
    });
    const order = normalizeBillingOrder(data);
    if (!order) throw new Error("订单创建 API 返回无效");
    return order;
  }

  async refundBillingOrder(token: string, tenantId: string, orderNo: string): Promise<CasdoorBillingOrder> {
    if (!normalizeBillingOrderNo(orderNo)) throw new Error("订单号无效");
    const data = await this.request<unknown>(token, billingOrderEndpoint(this.baseUrl, tenantId, orderNo, "refund"), { method: "POST" });
    const order = normalizeBillingOrder(data);
    if (!order) throw new Error("退款 API 返回无效");
    return order;
  }

  async expireBillingOrder(token: string, tenantId: string, orderNo: string): Promise<CasdoorBillingOrder> {
    if (!normalizeBillingOrderNo(orderNo)) throw new Error("订单号无效");
    const data = await this.request<unknown>(token, billingOrderEndpoint(this.baseUrl, tenantId, orderNo, "expire"), { method: "POST" });
    const order = normalizeBillingOrder(data);
    if (!order) throw new Error("订单过期 API 返回无效");
    return order;
  }

  async listTenantAudit(token: string, tenantId: string, limit = 100): Promise<unknown[]> {
    const data = await this.request<unknown>(token, `${tenantEndpoint(this.baseUrl, tenantId, "audit")}?limit=${Math.max(1, Math.min(500, Math.floor(limit)))}`);
    return Array.isArray(data) ? data : [];
  }

  async setMemberRevocation(token: string, tenantId: string, subject: string, revoked: boolean, reason?: string): Promise<CasdoorMemberRevocation> {
    const normalizedSubject = subject.trim();
    if (!normalizedSubject) throw new Error("成员主体标识不能为空");
    const data = await this.request<CasdoorMemberRevocation>(token, memberRevocationEndpoint(this.baseUrl, tenantId, normalizedSubject), {
      method: "PATCH",
      body: JSON.stringify({ revoked, ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
    });
    if (!data || data.subject !== normalizedSubject || data.revoked !== revoked) throw new Error("成员撤销 API 返回无效");
    return data;
  }

  async listMemberRevocations(token: string, tenantId: string): Promise<CasdoorMemberRevocation[]> {
    const data = await this.request<unknown>(token, memberRevocationsEndpoint(this.baseUrl, tenantId));
    if (!Array.isArray(data)) throw new Error("成员撤销 API 返回无效");
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const subject = typeof item.subject === "string" ? item.subject.trim() : "";
      const revokedAt = typeof item.revokedAt === "string" ? item.revokedAt : "";
      const revokedBy = typeof item.revokedBy === "string" ? item.revokedBy : "";
      if (!subject || !revokedAt || !revokedBy) return [];
      return [{ subject, revoked: true, revokedAt, revokedBy, ...(typeof item.reason === "string" && item.reason ? { reason: item.reason } : {}) }];
    });
  }

  async listSessions(token: string, tenantId: string, limit: number): Promise<CasdoorSessionBinding[]> {
    const data = await this.request<unknown>(token, `${sessionsEndpoint(this.baseUrl, tenantId)}?limit=${limit}`);
    if (!Array.isArray(data)) throw new Error("会话注册 API 返回无效");
    return data.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const parsed = normalizeRemoteSession(entry);
      return parsed ? [parsed] : [];
    });
  }

  async registerSession(token: string, tenantId: string, binding: CasdoorSessionBindingInput): Promise<CasdoorSessionBinding> {
    const payload: Record<string, unknown> = { sessionId: binding.sessionId };
    if (binding.subject) payload.subject = binding.subject;
    if (binding.deviceFingerprint) payload.deviceFingerprint = binding.deviceFingerprint;
    if (binding.kind) payload.kind = binding.kind;
    if (binding.scopes) payload.scopes = binding.scopes;
    if (binding.metadata) payload.metadata = binding.metadata;
    const data = await this.request<unknown>(token, sessionsEndpoint(this.baseUrl, tenantId), { method: "POST", body: JSON.stringify(payload) });
    const parsed = normalizeRemoteSession(data);
    if (!parsed) throw new Error("会话注册 API 返回无效");
    return parsed;
  }

  async unregisterSession(token: string, tenantId: string, sessionId: string): Promise<{ removed: boolean }> {
    const data = await this.request<unknown>(token, sessionEndpoint(this.baseUrl, tenantId, sessionId), { method: "DELETE" });
    const removed = Boolean((data as { removed?: unknown })?.removed);
    return { removed };
  }

  async health(): Promise<CasdoorGatewayHealth | { configured: false }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/healthz`, { headers: { accept: "application/json" } });
      const body = await response.json().catch(() => null) as { data?: { ok: boolean; store: string; latencyMs: number; version?: string; error?: string }; status?: string; code?: string; message?: string } | null;
      if (!response.ok || !body?.data) return { ok: false, store: "unknown", latencyMs: 0, version: "unknown", error: body?.message ?? `gateway responded with ${response.status}` };
      return { ok: Boolean(body.data.ok), store: body.data.store, latencyMs: body.data.latencyMs, version: body.data.version ?? "unknown", ...(body.data.error ? { error: body.data.error } : {}) };
    } catch (error) {
      return { ok: false, store: "unknown", latencyMs: 0, version: "unknown", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async tenantHealth(token: string, tenantId: string): Promise<CasdoorTenantHealth> {
    return this.request<CasdoorTenantHealth>(token, tenantHealthEndpoint(this.baseUrl, tenantId));
  }

  async deliverWebhook(event: { type: string; action: string; organization: string; user?: string; group?: string; role?: string; permission?: string; target?: string }, signatureSecret: string): Promise<{ received: string; action: string; impacted: string[] }> {
    const payload = JSON.stringify(event);
    const signature = await hmacSha256Hex(payload, signatureSecret);
    const response = await this.fetchImpl(webhookEndpoint(this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "x-casdoor-signature": `sha256=${signature}` },
      body: payload,
    });
    const body = await response.json().catch(() => null) as { data?: { received: string; action: string; impacted: string[] } } | null;
    if (!response.ok || !body?.data) throw new Error(`Webhook 投递失败：${response.status}`);
    return body.data;
  }
}

function normalizeTenantPolicy(value: unknown): CasdoorTenantPolicy {
  if (!value || typeof value !== "object") throw new Error("企业租户策略返回无效");
  const entry = value as Record<string, unknown>;
  const status = entry.status === "suspended" || entry.status === "archived" ? entry.status : entry.status === "active" ? "active" : undefined;
  const maxResources = typeof entry.maxResources === "number" && Number.isInteger(entry.maxResources) ? entry.maxResources : 0;
  const version = typeof entry.version === "number" && Number.isInteger(entry.version) && entry.version >= 1 ? entry.version : 1;
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : "";
  if (!status || maxResources < 1 || !updatedAt) throw new Error("企业租户策略返回无效");
  const modelAllowlist = Array.isArray(entry.modelAllowlist) ? [...new Set(entry.modelAllowlist.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 256) : undefined;
  const mcpAllowlist = Array.isArray(entry.mcpAllowlist) ? [...new Set(entry.mcpAllowlist.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 256) : undefined;
  const maxTokensPerDay = typeof entry.maxTokensPerDay === "number" && Number.isInteger(entry.maxTokensPerDay) && entry.maxTokensPerDay >= 0 ? entry.maxTokensPerDay : undefined;
  const tokensUsedToday = typeof entry.tokensUsedToday === "number" && Number.isInteger(entry.tokensUsedToday) && entry.tokensUsedToday >= 0 ? entry.tokensUsedToday : undefined;
  const tokensReservedToday = typeof entry.tokensReservedToday === "number" && Number.isInteger(entry.tokensReservedToday) && entry.tokensReservedToday >= 0 ? entry.tokensReservedToday : undefined;
  const maxPointsPerDay = typeof entry.maxPointsPerDay === "number" && Number.isSafeInteger(entry.maxPointsPerDay) && entry.maxPointsPerDay >= 0 ? entry.maxPointsPerDay : undefined;
  const pointsUsedToday = typeof entry.pointsUsedToday === "number" && Number.isSafeInteger(entry.pointsUsedToday) && entry.pointsUsedToday >= 0 ? entry.pointsUsedToday : undefined;
  const pointsReservedToday = typeof entry.pointsReservedToday === "number" && Number.isSafeInteger(entry.pointsReservedToday) && entry.pointsReservedToday >= 0 ? entry.pointsReservedToday : undefined;
  return { status, maxResources, version, updatedAt, ...(typeof entry.updatedBy === "string" ? { updatedBy: entry.updatedBy } : {}), ...(modelAllowlist ? { modelAllowlist } : {}), ...(mcpAllowlist ? { mcpAllowlist } : {}), ...(entry.killSwitch === true ? { killSwitch: true } : {}), ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(tokensUsedToday === undefined ? {} : { tokensUsedToday }), ...(tokensReservedToday === undefined ? {} : { tokensReservedToday }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(pointsUsedToday === undefined ? {} : { pointsUsedToday }), ...(pointsReservedToday === undefined ? {} : { pointsReservedToday }) };
}

function normalizeAiCapabilities(value: unknown): CasdoorAiCapabilities {
  if (!value || typeof value !== "object") throw new Error("AI 能力目录返回无效");
  const entry = value as Record<string, unknown>;
  const capabilitySource = entry.capabilitySource === "gateway-config" ? "gateway-config" : "unconfigured";
  const models = Array.isArray(entry.models) ? entry.models.flatMap((rawModel) => {
    if (!rawModel || typeof rawModel !== "object") return [];
    const model = rawModel as Record<string, unknown>;
    const id = typeof model.id === "string" ? model.id.trim().slice(0, 200) : "";
    if (!id) return [];
    const capabilities: CasdoorAiCapabilityModel["capabilities"] = {};
    if (model.capabilities && typeof model.capabilities === "object" && !Array.isArray(model.capabilities)) {
      for (const [protocol, rawCapability] of Object.entries(model.capabilities as Record<string, unknown>)) {
        if (!["chat.completions", "completions", "responses", "embeddings", "rerank", "moderations", "images", "audio", "realtime", "video"].includes(protocol)) continue;
        if (!rawCapability || typeof rawCapability !== "object") continue;
        const capability = rawCapability as Record<string, unknown>;
        if (typeof capability.supported !== "boolean") continue;
        capabilities[protocol as keyof CasdoorAiCapabilityModel["capabilities"]] = {
          supported: capability.supported,
          ...(typeof capability.streaming === "boolean" ? { streaming: capability.streaming } : {}),
          ...(capability.usage === "required" || capability.usage === "optional" || capability.usage === "none" ? { usage: capability.usage } : {}),
          ...(typeof capability.reason === "string" ? { reason: capability.reason.slice(0, 240) } : {}),
          ...(typeof capability.verifiedAt === "string" ? { verifiedAt: capability.verifiedAt } : {}),
        };
      }
    }
    return [{ id, capabilities }];
  }) : [];
  return { ...(typeof entry.group === "string" && entry.group ? { group: entry.group } : {}), capabilitySource, models };
}

function normalizeCommercialModelCatalog(value: unknown): CasdoorCommercialModelCatalog {
  if (!value || typeof value !== "object") throw new Error("商业模型目录返回无效");
  const entry = value as Record<string, unknown>;
  const models = Array.isArray(entry.models) ? entry.models.flatMap((rawModel) => {
    if (!rawModel || typeof rawModel !== "object") return [];
    const model = rawModel as Record<string, unknown>;
    const id = typeof model.id === "string" ? model.id.trim().slice(0, 200) : "";
    const pricing = model.pricing;
    if (!id || typeof model.sellable !== "boolean" || !pricing || typeof pricing !== "object") return [];
    const rawPricing = pricing as Record<string, unknown>;
    if (!["model", "inputPointsPerThousand", "outputPointsPerThousand", "minimumPoints", "updatedAt"].every((key) => key in rawPricing)) return [];
    return [{
      id,
      sellable: model.sellable,
      ...(typeof model.reason === "string" ? { reason: model.reason.slice(0, 500) } : {}),
      ...(typeof model.grossMarginPercent === "number" ? { grossMarginPercent: model.grossMarginPercent } : {}),
      ...(typeof model.marginCurrency === "string" ? { marginCurrency: model.marginCurrency.slice(0, 3) } : {}),
      ...(typeof model.revenuePerPoint === "number" ? { revenuePerPoint: model.revenuePerPoint } : {}),
      capabilities: normalizeAiCapabilities({ models: [{ id, capabilities: model.capabilities }] }).models[0]?.capabilities ?? {},
      pricing: rawPricing as unknown as CasdoorCommercialModelCatalog["models"][number]["pricing"],
    }];
  }) : [];
  return {
    ...(typeof entry.group === "string" && entry.group ? { group: entry.group } : {}),
    capabilitySource: entry.capabilitySource === "gateway-config" ? "gateway-config" : "unconfigured",
    pricingSource: "gateway-pricing",
    generatedAt: typeof entry.generatedAt === "string" ? entry.generatedAt : new Date(0).toISOString(),
    models,
  };
}

export const __casdoorResourceBackendTestables = { normalizeRemoteResource, normalizeRemoteSession, normalizeTenantPolicy, normalizeAiCapabilities, normalizeCommercialModelCatalog, safeUrl, resourceEndpoint, aiCapabilitiesEndpoint, aiCatalogEndpoint, tenantEndpoint, memberRevocationEndpoint, memberRevocationsEndpoint };
function tenantHealthEndpoint(baseUrl: string, tenantId: string): string {
  return `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/health`;
}

export interface CasdoorGatewayHealth {
  ok: boolean;
  store: string;
  latencyMs: number;
  version: string;
  error?: string;
  configured?: boolean;
}

export interface CasdoorTenantHealth extends CasdoorGatewayHealth {
  tenantId: string;
  policy: { status: "active" | "suspended" | "archived"; maxResources: number; version: number; killSwitch: boolean; modelAllowlist: number; mcpAllowlist: number; maxTokensPerDay?: number; tokensUsedToday: number; tokensReservedToday?: number; maxPointsPerDay?: number; pointsUsedToday: number; pointsReservedToday?: number };
  budgets?: {
    tokens: CasdoorTenantBudgetSummary;
    points: CasdoorTenantBudgetSummary;
  };
  resources: Record<string, number>;
  revokedMembers: number;
  activeSessions: number;
  siem: { kind: string; endpoint?: string; filePath?: string } | null;
  at: string;
}
export type CasdoorSessionKind = "desktop" | "web" | "automation" | "team" | "session";

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

export interface CasdoorSessionBindingInput {
  sessionId: string;
  subject?: string;
  deviceFingerprint?: string;
  kind?: CasdoorSessionKind;
  scopes?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

function normalizeRemoteSession(value: unknown): CasdoorSessionBinding | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const sessionId = typeof entry.sessionId === "string" ? entry.sessionId.trim() : "";
  const subject = typeof entry.subject === "string" ? entry.subject.trim() : "";
  const kindRaw = typeof entry.kind === "string" ? entry.kind.trim() : "";
  const kind: CasdoorSessionKind = kindRaw === "desktop" || kindRaw === "web" || kindRaw === "automation" || kindRaw === "team" || kindRaw === "session" ? kindRaw : "desktop";
  const scopes = Array.isArray(entry.scopes) ? entry.scopes.filter((value): value is string => typeof value === "string") : [];
  if (!sessionId || !subject) return null;
  const startedAt = typeof entry.startedAt === "string" ? entry.startedAt : new Date().toISOString();
  const lastSeenAt = typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : startedAt;
  const binding: CasdoorSessionBinding = { sessionId, subject, kind, scopes, startedAt, lastSeenAt };
  if (typeof entry.deviceFingerprint === "string" && entry.deviceFingerprint) binding.deviceFingerprint = entry.deviceFingerprint;
  if (typeof entry.endedAt === "string" && entry.endedAt) binding.endedAt = entry.endedAt;
  if (entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)) binding.metadata = entry.metadata as Record<string, string | number | boolean | null>;
  return binding;
}

function webhookEndpoint(baseUrl: string): string {
  return `${baseUrl}/v1/webhooks/casdoor`;
}
