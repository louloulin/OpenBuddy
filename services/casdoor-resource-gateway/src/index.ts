import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHash, createPublicKey, createVerify, randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { deriveTraceContext, withTrace, currentTraceId } from "./trace.js";
import { encryptMetadata, loadEncryptionContext, summarizeEncryption, type EncryptionContext } from "./encryption.js";
import { creditLedgerEntryHash, creditLedgerIntegrity, trimCreditLedger } from "./credit-ledger.js";
import { assertProductionConfiguration, productionAudienceStrong, productionAudienceValid, productionCapabilityDirectoryFresh, productionCapabilityDirectoryVerified, productionTargetGrossMarginValid } from "./production-config.js";
import {
  appendSiem,
  createMysqlResourceStoreAdapter,
  createPostgresResourceStoreAdapter,
  InMemoryResourceStoreAdapter,
  JsonFileResourceStoreAdapter,
  type CreditAccount,
  type CreditLedgerEntry,
  type CreditLedgerEntryType,
  type CreditPricing,
  type BillingOrder,
  type BillingOrderStatus,
  type BillingPlan,
  type BillingEntitlements,
  type BillingSubscription,
  type CreditExpiryRun,
  type CreditWallet,
  type CreditWalletMember,
  type CreditWalletMemberRole,
  type CreditWalletStatus,
  type NewApiCostImport,
  type AiRequestRecord,
  type AiRequestResponse,
  normalizeAiRequestKey,
  type ResourceStoreAdapter,
  type ResourceStoreState,
  type SiemSink,
} from "./store.js";

const RESOURCE_TYPES = ["project", "knowledge_base", "storage_connection"] as const;
const AI_MODELS_ROUTE = "/ai/models";
const AI_CATALOG_ROUTE = "/ai/catalog";
type CasdoorResourceType = (typeof RESOURCE_TYPES)[number];
type CasdoorResourceCreateInput = { type: CasdoorResourceType; name: string; metadata?: Record<string, string | number | boolean | null>; idempotencyKey?: string };
type CasdoorResourceUpdateInput = { name?: string; metadata?: Record<string, string | number | boolean | null>; expectedVersion: number };
type CasdoorResourceRecord = { id: string; tenantId: string; ownerSubject: string; type: CasdoorResourceType; name: string; metadata: Record<string, string | number | boolean | null>; createdAt: string; updatedAt: string; version: number };
type TenantPolicyStatus = "active" | "suspended" | "archived";
type TenantPolicy = { status: TenantPolicyStatus; maxResources: number; version: number; updatedAt: string; updatedBy?: string; modelAllowlist?: string[]; mcpAllowlist?: string[]; killSwitch?: boolean; maxTokensPerDay?: number; tokensUsedToday?: number; tokensReservedToday?: number; maxPointsPerDay?: number; pointsUsedToday?: number; pointsReservedToday?: number; newApiGroup?: string };
type TenantPolicyPatch = { expectedVersion?: number; status?: TenantPolicyStatus; maxResources?: number; modelAllowlist?: string[]; mcpAllowlist?: string[]; killSwitch?: boolean; maxTokensPerDay?: number; maxPointsPerDay?: number; newApiGroup?: string };
type RuntimeUsage = { date: string; tokens: number; reservedTokens?: number; points?: number; reservedPoints?: number };
type TenantMemberRevocation = { subject: string; revokedAt: string; revokedBy: string; reason?: string };
type CreditPricingInput = { model?: unknown; inputPointsPerThousand?: unknown; outputPointsPerThousand?: unknown; minimumPoints?: unknown; inputCostPerMillion?: unknown; outputCostPerMillion?: unknown; costCurrency?: unknown; costSource?: unknown };
type CreditQuoteInput = { model?: unknown; promptTokens?: unknown; completionTokens?: unknown };
type BillingOrderInput = { planId?: unknown; subject?: unknown; idempotencyKey?: unknown; expiresInSeconds?: unknown };
type BillingCallbackInput = { orderNo?: unknown; status?: unknown; paymentId?: unknown; paymentChannel?: unknown; failureReason?: unknown; amountMinor?: unknown; currency?: unknown };
type BillingPlanInput = { id?: unknown; name?: unknown; description?: unknown; currency?: unknown; priceMinor?: unknown; points?: unknown; active?: unknown; features?: unknown; maxTokensPerDay?: unknown; maxPointsPerDay?: unknown; modelAllowlist?: unknown; mcpAllowlist?: unknown; newApiGroup?: unknown; pointsValidDays?: unknown; entitlementsValidDays?: unknown };
type NewApiCostImportInput = { tenantId?: unknown; subject?: unknown; walletId?: unknown; actorSubject?: unknown; model?: unknown; promptTokens?: unknown; completionTokens?: unknown; upstreamCost?: unknown; currency?: unknown; source?: unknown; externalId?: unknown; importKey?: unknown; usageAt?: unknown; newApiRequestId?: unknown; newApiGroup?: unknown; agentId?: unknown; sessionId?: unknown; channel?: unknown; cache?: unknown; costBasis?: unknown };
type NewApiProtocol = "chat.completions" | "completions" | "responses" | "embeddings" | "rerank" | "moderations" | "images" | "audio" | "realtime" | "video";
type NewApiCapability = { supported: boolean; streaming?: boolean; usage?: "required" | "optional" | "none"; reason?: string; verifiedAt?: string };
type NewApiCapabilityDirectory = Record<string, Record<string, Record<NewApiProtocol, NewApiCapability>>>;
type TenantBudgetStatus = "unlimited" | "healthy" | "warning" | "critical" | "exhausted";
type TenantBudgetSummary = { limit?: number; used: number; reserved: number; committed: number; remaining?: number; utilizationPercent?: number; status: TenantBudgetStatus };
type NewApiAttributionContext = { requestId?: string; agentId?: string; sessionId?: string; walletId?: string; actorSubject?: string };
type CommercialModelCatalogEntry = {
  id: string;
  sellable: boolean;
  reason?: string;
  capabilities: Record<string, NewApiCapability>;
  pricing: CreditPricing;
  grossMarginPercent?: number;
  marginCurrency?: string;
  revenuePerPoint?: number;
};
type ReconciliationBucket = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  pointsSettled: number;
  upstreamCost: number;
  upstreamCostEntries: number;
  newApiUsageEntries: number;
  estimatedUsageEntries: number;
  externalCost: number;
  externalCostEntries: number;
  paidPointsConsumed: number;
  freePointsConsumed: number;
  recognizedRevenueMinorByCurrency: Record<string, number>;
};

function emptyReconciliationBucket(): ReconciliationBucket {
  return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, pointsSettled: 0, upstreamCost: 0, upstreamCostEntries: 0, newApiUsageEntries: 0, estimatedUsageEntries: 0, externalCost: 0, externalCostEntries: 0, paidPointsConsumed: 0, freePointsConsumed: 0, recognizedRevenueMinorByCurrency: {} };
}

function addReconciliationEntry(bucket: ReconciliationBucket, entry: CreditLedgerEntry, allocation?: CreditRevenueAllocation): void {
  const promptTokens = entry.promptTokens ?? 0;
  const completionTokens = entry.completionTokens ?? 0;
  bucket.requests += 1;
  bucket.promptTokens += promptTokens;
  bucket.completionTokens += completionTokens;
  bucket.totalTokens += promptTokens + completionTokens;
  bucket.pointsSettled += entry.pointsSettled ?? entry.amount;
  if (typeof entry.upstreamCost === "number" && Number.isFinite(entry.upstreamCost) && entry.upstreamCost >= 0) {
    bucket.upstreamCost += entry.upstreamCost;
    bucket.upstreamCostEntries += 1;
  }
  if (entry.usageSource === "new-api") bucket.newApiUsageEntries += 1;
  if (entry.usageSource === "estimated") bucket.estimatedUsageEntries += 1;
  applyCreditRevenueAllocation(bucket, allocation);
}

function addReconciliationImport(bucket: ReconciliationBucket, entry: NewApiCostImport): void {
  bucket.requests += 1;
  bucket.promptTokens += entry.promptTokens;
  bucket.completionTokens += entry.completionTokens;
  bucket.totalTokens += entry.promptTokens + entry.completionTokens;
  bucket.externalCost += entry.upstreamCost;
  bucket.externalCostEntries += 1;
}

function addDimensionBucket(target: Record<string, ReconciliationBucket>, key: string | undefined, entry: CreditLedgerEntry, allocation: CreditRevenueAllocation | undefined): void {
  if (!key) return;
  target[key] ??= emptyReconciliationBucket();
  addReconciliationEntry(target[key], entry, allocation);
}

function addExternalDimensionBucket(target: Record<string, ReconciliationBucket>, key: string | undefined, entry: NewApiCostImport): void {
  if (!key) return;
  target[key] ??= emptyReconciliationBucket();
  addReconciliationImport(target[key], entry);
}

type CommerceReconciliation = {
  grossOrders: number;
  refundedOrders: number;
  grossPoints: number;
  refundedPoints: number;
  netPoints: number;
  grossAmountMinorByCurrency: Record<string, number>;
  refundedAmountMinorByCurrency: Record<string, number>;
  netAmountMinorByCurrency: Record<string, number>;
};

type CommerceEconomics = {
  settledPoints: number;
  grossRevenueMinorByCurrency: Record<string, number>;
  refundedRevenueMinorByCurrency: Record<string, number>;
  netRevenueMinorByCurrency: Record<string, number>;
  verifiedExternalCostByCurrency: Record<string, number>;
  matchedVerifiedExternalCostByCurrency: Record<string, number>;
  unmatchedVerifiedExternalCostByCurrency: Record<string, number>;
  verifiedCostRecords: number;
  matchedVerifiedCostRecords: number;
  unmatchedVerifiedCostRecords: number;
  costCoveragePercent: number;
  contributionMarginMajorByCurrency: Record<string, number>;
  recognizedUsageRevenueMinorByCurrency: Record<string, number>;
  usageContributionMarginMajorByCurrency: Record<string, number>;
  recognizedRevenueCoveragePercent: number;
};

function emptyCommerceReconciliation(): CommerceReconciliation {
  return { grossOrders: 0, refundedOrders: 0, grossPoints: 0, refundedPoints: 0, netPoints: 0, grossAmountMinorByCurrency: {}, refundedAmountMinorByCurrency: {}, netAmountMinorByCurrency: {} };
}

function addCommerceAmount(target: Record<string, number>, currency: string, amountMinor: number): void {
  target[currency] = (target[currency] ?? 0) + amountMinor;
}

type CreditRevenueAllocation = {
  paidPoints: number;
  freePoints: number;
  revenueMinorByCurrency: Record<string, number>;
};

type CreditRevenueLot = {
  remaining: number;
  unitMinor: number;
  currency: string;
  orderId: string;
};

function ledgerTimestamp(entry: CreditLedgerEntry): number {
  const value = Date.parse(entry.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function buildCreditRevenueAllocations(state: ResourceStore, tenantId: string, walletId?: string): Map<string, CreditRevenueAllocation> {
  const lotsBySubject = new Map<string, CreditRevenueLot[]>();
  const freePointsBySubject = new Map<string, number>();
  const allocations = new Map<string, CreditRevenueAllocation>();
  const entries = state.creditLedger
    .filter((entry) => entry.tenantId === tenantId && (!walletId || entry.walletId === walletId))
    .sort((left, right) => ledgerTimestamp(left) - ledgerTimestamp(right) || left.id.localeCompare(right.id));
  for (const entry of entries) {
    const lots = lotsBySubject.get(entry.subject) ?? [];
    if (entry.type === "purchase" && entry.amount > 0 && entry.amountMinor !== undefined && entry.currency) {
      lots.push({ remaining: entry.amount, unitMinor: entry.amountMinor / entry.amount, currency: entry.currency, orderId: entry.orderId ?? "" });
      lotsBySubject.set(entry.subject, lots);
      continue;
    }
    if (entry.type === "grant" && entry.amount > 0) {
      freePointsBySubject.set(entry.subject, (freePointsBySubject.get(entry.subject) ?? 0) + entry.amount);
      continue;
    }
    if (entry.type === "refund" && entry.orderId && entry.amount > 0) {
      let remaining = entry.amount;
      for (const lot of lots) {
        if (remaining <= 0) break;
        if (lot.orderId !== entry.orderId) continue;
        const removed = Math.min(lot.remaining, remaining);
        lot.remaining -= removed;
        remaining -= removed;
      }
      continue;
    }
    if (entry.type !== "consume" || entry.amount <= 0) continue;
    let remaining = entry.pointsSettled ?? entry.amount;
    let paidPoints = 0;
    let freePoints = 0;
    const revenueMinorByCurrency: Record<string, number> = {};
    for (const lot of lots) {
      if (remaining <= 0) break;
      const consumed = Math.min(lot.remaining, remaining);
      if (consumed <= 0) continue;
      lot.remaining -= consumed;
      remaining -= consumed;
      paidPoints += consumed;
      addCommerceAmount(revenueMinorByCurrency, lot.currency, consumed * lot.unitMinor);
    }
    if (remaining > 0) {
      const availableFree = freePointsBySubject.get(entry.subject) ?? 0;
      const consumedFree = Math.min(availableFree, remaining);
      freePoints += consumedFree;
      freePointsBySubject.set(entry.subject, availableFree - consumedFree);
    }
    allocations.set(entry.id, { paidPoints, freePoints, revenueMinorByCurrency });
  }
  return allocations;
}

function applyCreditRevenueAllocation(bucket: ReconciliationBucket, allocation: CreditRevenueAllocation | undefined): void {
  if (!allocation) return;
  bucket.paidPointsConsumed += allocation.paidPoints;
  bucket.freePointsConsumed += allocation.freePoints;
  for (const [currency, amount] of Object.entries(allocation.revenueMinorByCurrency)) addCommerceAmount(bucket.recognizedRevenueMinorByCurrency, currency, amount);
}

function inReconciliationWindow(value: string | undefined, since: number, until: number): boolean {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return false;
  return (!Number.isFinite(since) || parsed >= since) && (!Number.isFinite(until) || parsed < until);
}

function commerceReconciliation(state: ResourceStore, tenantId: string, since: number, until: number, walletId?: string): CommerceReconciliation {
  const result = emptyCommerceReconciliation();
  for (const order of Object.values(state.billingOrders) as BillingOrder[]) {
    if (order.tenantId !== tenantId || (walletId && order.walletId !== walletId)) continue;
    const paidAt = order.paidAt ?? (order.status === "paid" ? order.updatedAt : undefined);
    if (order.status === "paid" || order.status === "refunded") {
      if (!inReconciliationWindow(paidAt, since, until)) continue;
      result.grossOrders += 1;
      result.grossPoints += order.points;
      addCommerceAmount(result.grossAmountMinorByCurrency, order.currency, order.amountMinor);
    }
    if (order.status === "refunded" && inReconciliationWindow(order.refundedAt, since, until)) {
      result.refundedOrders += 1;
      result.refundedPoints += order.points;
      addCommerceAmount(result.refundedAmountMinorByCurrency, order.currency, order.amountMinor);
    }
  }
  result.netPoints = result.grossPoints - result.refundedPoints;
  for (const currency of new Set([...Object.keys(result.grossAmountMinorByCurrency), ...Object.keys(result.refundedAmountMinorByCurrency)])) {
    result.netAmountMinorByCurrency[currency] = (result.grossAmountMinorByCurrency[currency] ?? 0) - (result.refundedAmountMinorByCurrency[currency] ?? 0);
  }
  return result;
}

function commerceEconomics(
  commerce: CommerceReconciliation,
  imports: NewApiCostImport[],
  localRequestIds: Set<string>,
  settledPoints: number,
  recognizedUsageRevenueMinorByCurrency: Record<string, number>,
  paidPointsConsumed: number,
): CommerceEconomics {
  const verifiedExternalCostByCurrency: Record<string, number> = {};
  const matchedVerifiedExternalCostByCurrency: Record<string, number> = {};
  const unmatchedVerifiedExternalCostByCurrency: Record<string, number> = {};
  let verifiedCostRecords = 0;
  let matchedVerifiedCostRecords = 0;
  for (const entry of imports) {
    if (entry.costBasis !== "provider-reported" && entry.costBasis !== "provider-reported-quota") continue;
    verifiedCostRecords += 1;
    addCommerceAmount(verifiedExternalCostByCurrency, entry.currency, entry.upstreamCost);
    const matched = Boolean(entry.newApiRequestId && localRequestIds.has(entry.newApiRequestId));
    if (matched) {
      matchedVerifiedCostRecords += 1;
      addCommerceAmount(matchedVerifiedExternalCostByCurrency, entry.currency, entry.upstreamCost);
    } else addCommerceAmount(unmatchedVerifiedExternalCostByCurrency, entry.currency, entry.upstreamCost);
  }
  const unmatchedVerifiedCostRecords = verifiedCostRecords - matchedVerifiedCostRecords;
  const costCoveragePercent = verifiedCostRecords === 0 ? 0 : Math.round((matchedVerifiedCostRecords / verifiedCostRecords) * 10000) / 100;
  const contributionMarginMajorByCurrency: Record<string, number> = {};
  for (const currency of Object.keys(commerce.netAmountMinorByCurrency)) {
    const verifiedCost = matchedVerifiedExternalCostByCurrency[currency];
    const unmatchedCost = unmatchedVerifiedExternalCostByCurrency[currency] ?? 0;
    if (verifiedCost === undefined || unmatchedCost > 0) continue;
    contributionMarginMajorByCurrency[currency] = Number(((commerce.netAmountMinorByCurrency[currency] / 100) - verifiedCost).toFixed(6));
  }
  const usageContributionMarginMajorByCurrency: Record<string, number> = {};
  for (const currency of Object.keys(recognizedUsageRevenueMinorByCurrency)) {
    const matchedCost = matchedVerifiedExternalCostByCurrency[currency];
    const unmatchedCost = unmatchedVerifiedExternalCostByCurrency[currency] ?? 0;
    if (matchedCost === undefined || unmatchedCost > 0) continue;
    usageContributionMarginMajorByCurrency[currency] = Number(((recognizedUsageRevenueMinorByCurrency[currency] / 100) - matchedCost).toFixed(6));
  }
  return {
    settledPoints,
    grossRevenueMinorByCurrency: commerce.grossAmountMinorByCurrency,
    refundedRevenueMinorByCurrency: commerce.refundedAmountMinorByCurrency,
    netRevenueMinorByCurrency: commerce.netAmountMinorByCurrency,
    verifiedExternalCostByCurrency,
    matchedVerifiedExternalCostByCurrency,
    unmatchedVerifiedExternalCostByCurrency,
    verifiedCostRecords,
    matchedVerifiedCostRecords,
    unmatchedVerifiedCostRecords,
    costCoveragePercent,
    contributionMarginMajorByCurrency,
    recognizedUsageRevenueMinorByCurrency,
    usageContributionMarginMajorByCurrency,
    recognizedRevenueCoveragePercent: settledPoints === 0 ? 100 : Math.round((paidPointsConsumed / settledPoints) * 10000) / 100,
  };
}

const DEFAULT_CREDIT_PRICING: CreditPricing = { model: "*", inputPointsPerThousand: 1, outputPointsPerThousand: 3, minimumPoints: 1, updatedAt: new Date(0).toISOString() };
const BILLING_ORDER_STATUSES: readonly BillingOrderStatus[] = ["pending", "paid", "failed", "refunded", "expired", "cancelled"];
const DEFAULT_BILLING_PLANS: BillingPlan[] = [
  { id: "free", name: "Free", description: "注册体验额度", currency: "CNY", priceMinor: 0, points: 100, pointsValidDays: 30, entitlementsValidDays: 30, active: true, features: ["基础模型", "个人工作区"], maxTokensPerDay: 10_000, maxPointsPerDay: 100, updatedAt: new Date(0).toISOString() },
  { id: "team", name: "Team", description: "团队协作额度包", currency: "CNY", priceMinor: 9900, points: 10000, pointsValidDays: 90, entitlementsValidDays: 90, active: true, features: ["团队工作区", "模型白名单", "团队审计"], maxTokensPerDay: 100_000, maxPointsPerDay: 10_000, updatedAt: new Date(0).toISOString() },
  { id: "enterprise", name: "Enterprise", description: "企业合同额度包", currency: "CNY", priceMinor: 99900, points: 150000, pointsValidDays: 365, entitlementsValidDays: 365, active: true, features: ["专属 Group", "集中审计", "企业 SLA"], maxTokensPerDay: 2_000_000, maxPointsPerDay: 150_000, updatedAt: new Date(0).toISOString() },
];

function isCasdoorResourceType(value: unknown): value is CasdoorResourceType {
  return typeof value === "string" && (RESOURCE_TYPES as readonly string[]).includes(value);
}

function normalizeCasdoorResourceIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().slice(0, 120);
  return /^[a-zA-Z0-9_.:-]+$/.test(key) ? key : undefined;
}

function normalizeCasdoorResourceMetadata(value: unknown, maxEntries = 64): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, maxEntries)) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key) || /(secret|password|token|credential|private.?key|access.?key)/i.test(key)) continue;
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") result[key] = typeof entry === "string" ? entry.slice(0, 2_000) : entry;
  }
  return result;
}

function normalizeCasdoorResourceName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, 200) : "";
}

function normalizeBillingEntitlements(value: unknown): BillingEntitlements | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const maxTokensPerDay = typeof item.maxTokensPerDay === "number" && Number.isSafeInteger(item.maxTokensPerDay) && item.maxTokensPerDay >= 0 ? item.maxTokensPerDay : undefined;
  const maxPointsPerDay = typeof item.maxPointsPerDay === "number" && Number.isSafeInteger(item.maxPointsPerDay) && item.maxPointsPerDay >= 0 ? item.maxPointsPerDay : undefined;
  const modelAllowlist = normalizeAllowlist(item.modelAllowlist);
  const mcpAllowlist = normalizeAllowlist(item.mcpAllowlist);
  const newApiGroup = normalizeNewApiGroup(item.newApiGroup);
  if (maxTokensPerDay === undefined && maxPointsPerDay === undefined && !modelAllowlist && !mcpAllowlist && !newApiGroup) return {};
  return { ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(modelAllowlist === undefined ? {} : { modelAllowlist }), ...(mcpAllowlist === undefined ? {} : { mcpAllowlist }), ...(newApiGroup ? { newApiGroup } : {}) };
}

function normalizeSubject(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, 200) : "";
}

function tenantBudgetSummary(limit: number | undefined, used: number, reserved: number): TenantBudgetSummary {
  const committed = used + reserved;
  if (limit === undefined) return { used, reserved, committed, status: "unlimited" };
  const remaining = Math.max(0, limit - committed);
  const utilizationPercent = limit === 0 ? 100 : Math.round((committed / limit) * 10000) / 100;
  const status: TenantBudgetStatus = committed >= limit ? "exhausted" : utilizationPercent >= 90 ? "critical" : utilizationPercent >= 75 ? "warning" : "healthy";
  return { limit, used, reserved, committed, remaining, utilizationPercent, status };
}

function normalizeRevocationReason(value: unknown): string | undefined {
  const reason = typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, 240) : "";
  return reason || undefined;
}

type JwtHeader = { alg?: string; kid?: string };
type JwtClaims = {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  isAdmin?: unknown;
  organization?: unknown;
  organizations?: unknown;
  org?: unknown;
  owner?: unknown;
  roles?: unknown;
  permissions?: unknown;
  capabilities?: unknown;
  groups?: unknown;
  [key: string]: unknown;
};

type JwtIdentity = { subject: string; claims: JwtClaims; tenantId: string };
type ResourceStore = ResourceStoreState;
type AuditEvent = import("./store.js").AuditEvent;
type GatewayError = Error & { statusCode?: number; code?: string; retryAfterSeconds?: number };

const issuer = requiredUrl(process.env.CASDOOR_ISSUER ?? "");
const configuredAudience = process.env.CASDOOR_AUDIENCE?.trim() || "";
const audience = configuredAudience || process.env.CASDOOR_CLIENT_ID?.trim();
const weknoraExchangeSecret = process.env.RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET?.trim() || "";
const weknoraExchangeSecretStrong = weknoraExchangeSecret.length >= 32 && !["replace-with", "placeholder", "example", "changeme"].some((marker) => weknoraExchangeSecret.toLowerCase().includes(marker));
const weknoraExchangeAudience = process.env.RESOURCE_GATEWAY_WEKNORA_EXCHANGE_AUDIENCE?.trim() || "weknora";
const weknoraTenantMap = (() => {
  const raw = process.env.RESOURCE_GATEWAY_WEKNORA_TENANT_MAP_JSON?.trim() || "";
  if (!raw) return {} as Record<string, number>;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).flatMap(([tenant, mapped]) => {
      const numeric = typeof mapped === "number" && Number.isSafeInteger(mapped) ? mapped : typeof mapped === "string" && /^\d+$/.test(mapped.trim()) ? Number(mapped) : 0;
      return /^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenant) && numeric > 0 ? [[tenant, numeric]] : [];
    }));
  } catch {
    console.error("RESOURCE_GATEWAY_WEKNORA_TENANT_MAP_JSON is invalid");
    return {} as Record<string, number>;
  }
})();
if (weknoraExchangeSecret && weknoraExchangeSecret.length < 32) console.error("RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET must be at least 32 characters");
const dataDir = process.env.RESOURCE_GATEWAY_DATA_DIR?.trim() || join(process.cwd(), ".data");
const maxBodyBytes = boundedNumber(process.env.RESOURCE_GATEWAY_MAX_BODY_BYTES, 1_000_000, 64_000, 10_000_000);
const aiReplayMaxBytes = boundedNumber(process.env.RESOURCE_GATEWAY_AI_REPLAY_MAX_BYTES, 10_000_000, 64_000, 50_000_000);
const aiRequestLeaseMs = boundedNumber(process.env.RESOURCE_GATEWAY_AI_REQUEST_LEASE_MS, 120_000, 30_000, 900_000);
const aiRequestReplayTtlMs = boundedNumber(process.env.RESOURCE_GATEWAY_AI_REQUEST_REPLAY_TTL_MS, 86_400_000, 60_000, 604_800_000);
const maxResources = boundedNumber(process.env.RESOURCE_GATEWAY_MAX_RESOURCES, 100_000, 100, 1_000_000);
const defaultTenantMaxResources = boundedNumber(process.env.RESOURCE_GATEWAY_DEFAULT_TENANT_MAX_RESOURCES, 10_000, 1, maxResources);
const maxAuditBytes = boundedNumber(process.env.RESOURCE_GATEWAY_AUDIT_MAX_BYTES, 50_000_000, 100_000, 500_000_000);
const rateLimitWindowMs = boundedNumber(process.env.RESOURCE_GATEWAY_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000);
const rateLimitRequests = boundedNumber(process.env.RESOURCE_GATEWAY_RATE_LIMIT_REQUESTS, 120, 10, 100_000);
const webhookRateLimitRequests = boundedNumber(process.env.RESOURCE_GATEWAY_WEBHOOK_RATE_LIMIT_REQUESTS, 60, 10, 100_000);
const autoWelcomeOrganizations = new Set((process.env.RESOURCE_GATEWAY_AUTO_WELCOME_ORGANIZATIONS ?? "").split(",").map((value) => normalizeSubject(value)).filter(Boolean));
const autoWelcomeFromCasdoorWebhook = process.env.RESOURCE_GATEWAY_AUTO_WELCOME === "true" && autoWelcomeOrganizations.size > 0;
const requestTimeoutMs = 10_000;
const newApiCircuitFailureThreshold = boundedNumber(process.env.RESOURCE_GATEWAY_NEW_API_CIRCUIT_FAILURE_THRESHOLD, 5, 1, 100);
const newApiCircuitOpenMs = boundedNumber(process.env.RESOURCE_GATEWAY_NEW_API_CIRCUIT_OPEN_MS, 30_000, 1_000, 3_600_000);
const newApiBaseUrl = optionalHttpUrl(process.env.NEW_API_BASE_URL?.trim());
const newApiToken = process.env.NEW_API_TOKEN?.trim() || "";
const newApiGroup = process.env.NEW_API_GROUP?.trim() || "";
const newApiGroupTokensState = (() => {
  const raw = process.env.NEW_API_GROUP_TOKENS_JSON?.trim();
  if (!raw) return { tokens: {} as Record<string, string>, configured: false, valid: false };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { tokens: {}, configured: true, valid: false };
    const tokens = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([group, token]) => normalizeNewApiGroup(group) && typeof token === "string" && token.trim()).map(([group, token]) => [group, String(token).trim()]));
    return { tokens, configured: true, valid: Object.keys(tokens).length > 0 };
  } catch {
    console.error("NEW_API_GROUP_TOKENS_JSON is invalid; falling back to NEW_API_TOKEN");
    return { tokens: {}, configured: true, valid: false };
  }
})();
const newApiGroupTokens = newApiGroupTokensState.tokens;
const newApiGroupTokensStrong = Object.values(newApiGroupTokens).every((token) => {
  const normalized = token.trim().toLowerCase();
  return token.length >= 32 && !["replace-with", "placeholder", "example"].some((marker) => normalized.includes(marker));
});
const newApiAllowEstimatedUsage = process.env.NEW_API_ALLOW_ESTIMATED_USAGE === "1";
const capabilityMaxAgeRaw = process.env.NEW_API_CAPABILITY_MAX_AGE_HOURS?.trim() || "24";
const capabilityMaxAgeHours = Number(capabilityMaxAgeRaw);
const capabilityMaxAgeHoursValid = Number.isFinite(capabilityMaxAgeHours) && capabilityMaxAgeHours > 0 && capabilityMaxAgeHours <= 8_760;
const targetGrossMarginRaw = process.env.RESOURCE_GATEWAY_TARGET_GROSS_MARGIN_PERCENT?.trim();
const targetGrossMarginPercent = targetGrossMarginRaw ? Number(targetGrossMarginRaw) : 70;
const newApiCapabilities: NewApiCapabilityDirectory = (() => {
  const raw = process.env.NEW_API_CAPABILITIES_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: NewApiCapabilityDirectory = {};
    for (const [group, models] of Object.entries(parsed as Record<string, unknown>)) {
      if (!normalizeNewApiGroup(group) || !models || typeof models !== "object" || Array.isArray(models)) continue;
      const modelEntries: Record<string, Record<NewApiProtocol, NewApiCapability>> = {};
      for (const [model, protocols] of Object.entries(models as Record<string, unknown>)) {
        if (!model.trim() || !protocols || typeof protocols !== "object" || Array.isArray(protocols)) continue;
        const protocolEntries = {} as Record<NewApiProtocol, NewApiCapability>;
        for (const [protocol, capability] of Object.entries(protocols as Record<string, unknown>)) {
          if (!["chat.completions", "completions", "responses", "embeddings", "rerank", "moderations", "images", "audio", "realtime", "video"].includes(protocol)) continue;
          if (!capability || typeof capability !== "object" || Array.isArray(capability)) continue;
          const item = capability as Record<string, unknown>;
          if (typeof item.supported !== "boolean") continue;
          const usage = item.usage === "required" || item.usage === "optional" || item.usage === "none" ? item.usage : undefined;
          const reason = typeof item.reason === "string" && item.reason.trim() ? item.reason.trim().slice(0, 240) : undefined;
          const verifiedAt = typeof item.verifiedAt === "string" && item.verifiedAt.trim() ? item.verifiedAt.trim().slice(0, 40) : undefined;
          protocolEntries[protocol as NewApiProtocol] = { supported: item.supported, ...(typeof item.streaming === "boolean" ? { streaming: item.streaming } : {}), ...(usage ? { usage } : {}), ...(reason ? { reason } : {}), ...(verifiedAt ? { verifiedAt } : {}) };
        }
        if (Object.keys(protocolEntries).length) modelEntries[model.trim().slice(0, 200)] = protocolEntries;
      }
      if (Object.keys(modelEntries).length) result[group] = modelEntries;
    }
    return result;
  } catch {
    console.error("NEW_API_CAPABILITIES_JSON is invalid; capability gating is disabled");
    return {};
  }
})();
const webhookSecret = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET?.trim() || "";
const billingCallbackSecret = process.env.RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET?.trim() || "";
const newApiCostImportSecret = process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET?.trim() || "";
const creditExpirySecret = process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET?.trim() || "";
const backchannelLogoutSecret = process.env.RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET?.trim() || webhookSecret;
const signingSecretsStrong = [webhookSecret, billingCallbackSecret, newApiCostImportSecret, creditExpirySecret, process.env.RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET?.trim() || "", ...(weknoraExchangeSecret ? [weknoraExchangeSecret] : [])].every((secret) => {
  const normalized = secret.toLowerCase();
  return secret.length >= 32 && !["replace-with", "placeholder", "example"].some((marker) => normalized.includes(marker));
});
let encryptionContext: EncryptionContext | null = null;
try {
  encryptionContext = loadEncryptionContext(process.env.RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY?.trim());
} catch (error) {
  console.error("Casdoor public key failed to load:", error instanceof Error ? error.message : String(error));
}
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

let store: ResourceStore | null = null;
let storeAdapter: ResourceStoreAdapter = process.env.RESOURCE_GATEWAY_STORE === "memory"
  ? new InMemoryResourceStoreAdapter()
  : new JsonFileResourceStoreAdapter(dataDir, maxAuditBytes);

/**
 * weknoraJtiCache — defense-in-depth JTI replay-protection cache for weknora_exchange tokens.
 *
 * Stores issued jti → { subject, expiresAt } with lazy TTL cleanup. Used to:
 *   1. Detect UUID collisions at issue time (astronomically rare with randomUUID, but cheap to check)
 *   2. Flush subject's outstanding jti when Casdoor sends backchannel-logout, so any
 *      in-flight token belonging to the revoked subject is rejected on next introspect/refresh
 *
 * This is NOT a strict single-use cache — WeKnora calls introspect on every request,
 * so legitimate retries within the 5-minute TTL must keep working. The cache is purely a
 * hook for "this jti has been issued by us" + "these jtis belong to this subject".
 */
const weknoraJtiCache: Map<string, { subject: string; expiresAt: number }> = new Map();
const weknoraSubjectJtis: Map<string, Set<string>> = new Map();

function rememberWeKnoraJti(jti: string, subject: string, expiresAt: number): void {
  const now = Math.floor(Date.now() / 1000);
  // opportunistic cleanup: anything expired gets dropped on every 100th insert
  if ((rememberWeKnoraJti as unknown as { counter?: number }).counter === undefined) {
    (rememberWeKnoraJti as unknown as { counter: number }).counter = 0;
  }
  (rememberWeKnoraJti as unknown as { counter: number }).counter += 1;
  if ((rememberWeKnoraJti as unknown as { counter: number }).counter % 100 === 0) {
    for (const [stored, info] of weknoraJtiCache) {
      if (info.expiresAt <= now) weknoraJtiCache.delete(stored);
    }
    for (const [sub, jtis] of weknoraSubjectJtis) {
      if (jtis.size === 0) weknoraSubjectJtis.delete(sub);
    }
  }
  if (weknoraJtiCache.has(jti)) {
    // UUID collision — log and overwrite (extremely unlikely with randomUUID v4)
    console.warn(`[weknora-jti] uuid collision detected for jti=${jti}`);
  }
  weknoraJtiCache.set(jti, { subject, expiresAt });
  const subjectSet = weknoraSubjectJtis.get(subject) ?? new Set<string>();
  subjectSet.add(jti);
  weknoraSubjectJtis.set(subject, subjectSet);
}

function flushWeKnoraJtisForSubject(subject: string): number {
  const subjectSet = weknoraSubjectJtis.get(subject);
  if (!subjectSet) return 0;
  let flushed = 0;
  for (const jti of subjectSet) {
    if (weknoraJtiCache.delete(jti)) flushed += 1;
  }
  weknoraSubjectJtis.delete(subject);
  return flushed;
}

function hasWeKnoraJtiBeenIssued(jti: string): boolean {
  return weknoraJtiCache.has(jti);
}

async function loadStoreAdapter(): Promise<void> {
  assertProductionConfiguration({
    nodeEnv: process.env.NODE_ENV,
    casdoorAudience: configuredAudience,
    casdoorAudienceValid: productionAudienceValid(configuredAudience),
    casdoorAudienceStrong: productionAudienceStrong(configuredAudience),
    store: process.env.RESOURCE_GATEWAY_STORE?.trim(),
    postgresConnectionString: process.env.POSTGRES_CONNECTION_STRING?.trim(),
    mysqlConnectionString: process.env.MYSQL_CONNECTION_STRING?.trim(),
    newApiBaseUrl,
    newApiBaseUrlSecure: process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || newApiBaseUrl?.startsWith("https://") === true,
    groupTokensValid: newApiGroupTokensState.valid,
    groupTokensStrong: newApiGroupTokensStrong,
    defaultGroup: newApiGroup,
    defaultGroupToken: newApiGroupTokens[newApiGroup],
    groupCapabilitiesMatch: Object.keys(newApiGroupTokens).length > 0 && Object.keys(newApiGroupTokens).length === Object.keys(newApiCapabilities).length && Object.keys(newApiGroupTokens).every((group) => Object.prototype.hasOwnProperty.call(newApiCapabilities, group)),
    capabilitiesConfigured: Object.keys(newApiCapabilities).length > 0,
    capabilitiesVerified: productionCapabilityDirectoryVerified(newApiCapabilities),
    capabilitiesFresh: capabilityMaxAgeHoursValid && productionCapabilityDirectoryFresh(newApiCapabilities, Date.now(), capabilityMaxAgeHours),
    capabilityMaxAgeHoursValid,
    webhookSecret,
    billingCallbackSecret,
    newApiCostImportSecret,
    creditExpirySecret,
    backchannelLogoutSecret: process.env.RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET?.trim(),
    weknoraExchangeSecret,
    weknoraExchangeSecretStrong,
    weknoraTenantMapConfigured: Object.keys(weknoraTenantMap).length > 0,
    signingSecretsStrong,
    allowEstimatedUsage: newApiAllowEstimatedUsage,
    targetGrossMarginValid: productionTargetGrossMarginValid(targetGrossMarginRaw),
  });
  const kind = process.env.RESOURCE_GATEWAY_STORE?.trim();
  if (kind === "postgres") {
    const connectionString = process.env.POSTGRES_CONNECTION_STRING?.trim();
    if (!connectionString) throw new Error("POSTGRES_CONNECTION_STRING is required when RESOURCE_GATEWAY_STORE=postgres");
    storeAdapter = await createPostgresResourceStoreAdapter({ connectionString, tablePrefix: process.env.RESOURCE_GATEWAY_SQL_PREFIX?.trim() || "casdoor_" });
    if (storeAdapter.bootstrap) await storeAdapter.bootstrap();
    return;
  }
  if (kind === "mysql") {
    const connectionString = process.env.MYSQL_CONNECTION_STRING?.trim();
    if (!connectionString) throw new Error("MYSQL_CONNECTION_STRING is required when RESOURCE_GATEWAY_STORE=mysql");
    storeAdapter = await createMysqlResourceStoreAdapter({ connectionString, tablePrefix: process.env.RESOURCE_GATEWAY_SQL_PREFIX?.trim() || "casdoor_" });
    if (storeAdapter.bootstrap) await storeAdapter.bootstrap();
    return;
  }
  if (storeAdapter.bootstrap) await storeAdapter.bootstrap();
}

const metrics = {
  startedAt: new Date(),
  httpRequests: new Map<string, number>(),
  httpOutcomes: new Map<string, number>(),
  rateLimited: 0,
  webhookAccepted: 0,
  webhookRejected: 0,
  auditEvents: 0,
  newApiCircuitOpened: 0,
  newApiCircuitRejected: 0,
  newApiCircuitRecovered: 0,
};

type NewApiCircuitPermit = { key: string; halfOpen: boolean };
type NewApiCircuitState = { failures: number; openedAt?: number; halfOpenProbe: boolean };
const newApiCircuits = new Map<string, NewApiCircuitState>();

function newApiCircuitKey(group: string, model: string): string {
  return `${group || "default"}:${model}`;
}

function acquireNewApiCircuit(group: string, model: string): NewApiCircuitPermit {
  const key = newApiCircuitKey(group, model);
  const current = newApiCircuits.get(key);
  if (!current) {
    newApiCircuits.set(key, { failures: 0, halfOpenProbe: false });
    return { key, halfOpen: false };
  }
  if (current.openedAt !== undefined) {
    const elapsed = Date.now() - current.openedAt;
    if (elapsed < newApiCircuitOpenMs || current.halfOpenProbe) {
      metrics.newApiCircuitRejected += 1;
      const error = gatewayError(503, "NEW_API_UPSTREAM_CIRCUIT_OPEN", "New API 上游通道暂时不可用，请稍后重试");
      error.retryAfterSeconds = Math.max(1, Math.ceil((newApiCircuitOpenMs - Math.max(0, elapsed)) / 1000));
      throw error;
    }
    current.halfOpenProbe = true;
    return { key, halfOpen: true };
  }
  return { key, halfOpen: false };
}

function recordNewApiCircuitSuccess(permit: NewApiCircuitPermit): void {
  const current = newApiCircuits.get(permit.key);
  if (!current) return;
  if (permit.halfOpen) {
    newApiCircuits.delete(permit.key);
    metrics.newApiCircuitRecovered += 1;
    return;
  }
  current.failures = 0;
}

function recordNewApiCircuitFailure(permit: NewApiCircuitPermit): void {
  const current = newApiCircuits.get(permit.key) ?? { failures: 0, halfOpenProbe: false };
  current.halfOpenProbe = false;
  current.failures += 1;
  if (permit.halfOpen || current.failures >= newApiCircuitFailureThreshold) {
    if (current.openedAt === undefined) metrics.newApiCircuitOpened += 1;
    current.openedAt = Date.now();
  }
  newApiCircuits.set(permit.key, current);
}

function releaseNewApiCircuitPermit(permit: NewApiCircuitPermit): void {
  if (!permit.halfOpen) return;
  const current = newApiCircuits.get(permit.key);
  if (current?.halfOpenProbe) current.halfOpenProbe = false;
}

function shouldCountNewApiFailure(status: number, bodyText = ""): boolean {
  if (isNewApiProtocolUnsupported(bodyText)) return false;
  return status === 408 || status === 429 || status >= 500;
}

function isClientDisconnected(signal: AbortSignal): boolean {
  return signal.reason instanceof Error && signal.reason.message === "OpenBuddy client disconnected";
}

function trackRequest(path: string, outcome: string): void {
  metrics.httpRequests.set(path, (metrics.httpRequests.get(path) ?? 0) + 1);
  const key = `${path}|${outcome}`;
  metrics.httpOutcomes.set(key, (metrics.httpOutcomes.get(key) ?? 0) + 1);
}

const siemSink: SiemSink | undefined = (() => {
  const kind = process.env.RESOURCE_GATEWAY_SIEM?.trim();
  if (!kind) return undefined;
  if (kind === "syslog") return { kind: "syslog" };
  if (kind === "webhook") return { kind: "webhook", endpoint: process.env.RESOURCE_GATEWAY_SIEM_ENDPOINT?.trim() || "" };
  if (kind === "csv") return { kind: "csv", filePath: process.env.RESOURCE_GATEWAY_SIEM_FILE?.trim() || join(dataDir, "audit-siem.csv") };
  return undefined;
})();
let writeQueue = Promise.resolve();
let auditQueue = Promise.resolve();
let jwksCache: { expiresAt: number; keys: Array<Record<string, unknown>> } | null = null;
let discoveryCache: { expiresAt: number; jwksUri: string } | null = null;

function runtimeSecret(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function requiredUrl(value: string): string {
  if (!value) throw new Error("CASDOOR_ISSUER is required");
  const url = new URL(value);
  if (url.protocol !== "https:" && process.env.NODE_ENV !== "development") throw new Error("CASDOOR_ISSUER must use HTTPS outside development");
  if (url.username || url.password || url.search || url.hash) throw new Error("CASDOOR_ISSUER must not contain credentials, query, or fragment");
  return url.toString().replace(/\/+$/, "");
}

function optionalHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("NEW_API_BASE_URL must be a clean HTTP(S) URL");
  return url.toString().replace(/\/+$/, "");
}

function gatewayError(statusCode: number, code: string, message: string): GatewayError {
  const error = new Error(message) as GatewayError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(encoded);
}

function success(res: ServerResponse, data: unknown, statusCode = 200): void {
  json(res, statusCode, { status: "ok", data });
}

function failure(res: ServerResponse, error: unknown, requestId: string): void {
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded) res.destroy();
    return;
  }
  const typed = error as GatewayError;
  const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
  if (typed.retryAfterSeconds !== undefined) res.setHeader("retry-after", String(typed.retryAfterSeconds));
  const code = typed.code ?? (statusCode >= 500 ? "RESOURCE_GATEWAY_ERROR" : "RESOURCE_GATEWAY_REQUEST_REJECTED");
  json(res, statusCode, { status: "error", code, message: statusCode >= 500 ? "企业资源服务暂时不可用" : typed.message, requestId });
}

function requestAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress?.trim() || "unknown";
}

async function enforceRateLimit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const key = requestAddress(req);
  const now = Date.now();
  const result = await storeAdapter.incrementRate(key, rateLimitWindowMs, now);
  if (result.count > rateLimitRequests) {
    metrics.rateLimited += 1;
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
    res.setHeader("retry-after", String(retryAfter));
    throw gatewayError(429, "RATE_LIMITED", "请求频率超过当前资源网关限制");
  }
}

async function enforceWebhookRateLimit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const key = `casdoor-webhook:${requestAddress(req)}`;
  const now = Date.now();
  const result = await storeAdapter.incrementRate(key, rateLimitWindowMs, now);
  if (result.count > webhookRateLimitRequests) {
    metrics.rateLimited += 1;
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
    res.setHeader("retry-after", String(retryAfter));
    throw gatewayError(429, "WEBHOOK_RATE_LIMITED", "Casdoor webhook 频率超过限制");
  }
}

async function checkReadiness(): Promise<void> {
  await getStore();
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function verifyBackchannelLogoutToken(token: string, secret: string, expectedIssuer: string, expectedAudience: string): { sub: string; sid?: string; jti?: string } {
  if (!secret) throw gatewayError(503, "BACKCHANNEL_DISABLED", "网关未配置 BACKCHANNEL_LOGOUT_SECRET，禁用 OIDC Back-Channel 登出");
  const parts = token.split(".");
  if (parts.length !== 3) throw gatewayError(400, "BACKCHANNEL_TOKEN_INVALID", "logout_token 必须是三段式 JWT");
  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; typ?: string };
  let payload: { iss?: string; aud?: string | string[]; sub?: string; sid?: string; jti?: string; events?: Record<string, unknown>; exp?: number; iat?: number };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw gatewayError(400, "BACKCHANNEL_TOKEN_INVALID", "logout_token 解析失败");
  }
  if (header.alg !== "HS256") throw gatewayError(400, "BACKCHANNEL_TOKEN_UNSUPPORTED", `不支持的 JWT 算法 ${header.alg ?? "unknown"}（仅支持 HS256）`);
  const expected = createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
  const provided = base64UrlDecode(signatureB64);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw gatewayError(401, "BACKCHANNEL_SIGNATURE_INVALID", "logout_token 签名校验失败");
  }
  if (typeof payload.iss !== "string" || payload.iss !== expectedIssuer) {
    throw gatewayError(401, "BACKCHANNEL_ISSUER_MISMATCH", "logout_token 签发方与网关 issuer 配置不一致");
  }
  const audList = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === "string" ? [payload.aud] : [];
  if (!audList.includes(expectedAudience)) {
    throw gatewayError(401, "BACKCHANNEL_AUDIENCE_MISMATCH", "logout_token 受众与网关 clientId 不一致");
  }
  if (!payload.events || typeof payload.events !== "object" || !(BACKCHANNEL_LOGOUT_EVENT in payload.events)) {
    throw gatewayError(400, "BACKCHANNEL_EVENT_MISSING", "logout_token 必须包含 backchannel-logout 事件");
  }
  if (typeof payload.sub !== "string" && typeof payload.sid !== "string") {
    throw gatewayError(400, "BACKCHANNEL_SUBJECT_MISSING", "logout_token 缺少 sub 或 sid 声明");
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now - 30) {
    throw gatewayError(401, "BACKCHANNEL_TOKEN_EXPIRED", "logout_token 已过期");
  }
  if (typeof payload.iat === "number" && payload.iat > now + 300) {
    throw gatewayError(401, "BACKCHANNEL_TOKEN_FUTURE", "logout_token 签发时间异常");
  }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) throw gatewayError(400, "BACKCHANNEL_SUBJECT_MISSING", "logout_token 缺少有效 sub 声明");
  return { sub, ...(typeof payload.sid === "string" ? { sid: payload.sid } : {}), ...(typeof payload.jti === "string" ? { jti: payload.jti } : {}) };
}

async function readFormUrlEncodedBody(req: IncomingMessage): Promise<Record<string, string>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxBodyBytes) throw gatewayError(413, "REQUEST_TOO_LARGE", "请求体超过限制");
    chunks.push(data);
  }
  if (!size) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  const out: Record<string, string> = {};
  for (const pair of text.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const raw = eq === -1 ? "" : pair.slice(eq + 1);
    out[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(raw.replace(/\+/g, " "));
  }
  return out;
}

async function handleBackchannelLogout(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "Back-Channel 登出只接受 POST");
  const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    throw gatewayError(415, "BACKCHANNEL_CONTENT_TYPE", "Back-Channel 登出要求 application/x-www-form-urlencoded");
  }
  const form = await readFormUrlEncodedBody(req);
  const token = (form.logout_token ?? "").trim();
  if (!token) throw gatewayError(400, "BACKCHANNEL_TOKEN_MISSING", "缺少 logout_token 参数");
  const claims = verifyBackchannelLogoutToken(token, runtimeSecret("RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET", backchannelLogoutSecret), issuer, audience ?? "");
  const subject = normalizeSubject(claims.sub);
  if (!subject) throw gatewayError(400, "BACKCHANNEL_SUBJECT_INVALID", "logout_token 中 sub 不是合法主体标识");
  const tenantId = `casdoor/${claims.sub.split("/")[0] ?? claims.sub}`;
  const result = await serialized(async () => {
    const next = await getStore();
    const tenantEntries = next.memberRevocations[tenantId] ?? {};
    tenantEntries[subject] = { subject, revokedAt: new Date().toISOString(), revokedBy: "casdoor-backchannel", reason: "OIDC Back-Channel Logout" };
    next.memberRevocations[tenantId] = tenantEntries;
    await saveStore(next);
    return tenantEntries[subject];
  });
  void audit({ requestId, at: new Date().toISOString(), subject, tenantId, resource: `member/${subject}`, action: "revoke", outcome: "success", reason: "casdoor.backchannel-logout" });
  const flushedJtis = flushWeKnoraJtisForSubject(subject);
  if (flushedJtis > 0) console.log(`[weknora-jti] flushed ${flushedJtis} exchange-token jti(s) for subject=${subject} after backchannel-logout`);
  metrics.webhookAccepted += 1;
  json(res, 200, { ok: true, subject: result.subject, revokedAt: result.revokedAt, flushedJtis });
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  const secret = runtimeSecret("RESOURCE_GATEWAY_WEBHOOK_SECRET", webhookSecret);
  if (!secret) throw gatewayError(503, "WEBHOOK_DISABLED", "网关未配置 RESOURCE_GATEWAY_WEBHOOK_SECRET，已禁用 webhook 接收");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "Webhook 只接受 POST");
  await enforceWebhookRateLimit(req, res);
  const signature = (req.headers["x-casdoor-signature"] ?? req.headers["x-casdoor-webhook-signature"] ?? "").toString();
  if (!signature) throw gatewayError(401, "WEBHOOK_SIGNATURE_MISSING", "Webhook 缺少签名");
  const raw = await body(req) as { type?: unknown; action?: unknown; organization?: unknown; user?: unknown; target?: unknown; object?: unknown; group?: unknown; role?: unknown; permission?: unknown };
  const expected = createHmac("sha256", secret).update(JSON.stringify(raw)).digest("hex");
  const provided = signature.replace(/^sha256=/, "").trim();
  if (!/^[a-f0-9]+$/i.test(provided) || provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"))) {
    throw gatewayError(401, "WEBHOOK_SIGNATURE_INVALID", "Webhook 签名校验失败");
  }
  const rawAction = casdoorWebhookAction(raw.action);
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : (["add", "create", "add-user", "create-user", "user/add", "user/create"].includes(rawAction) ? "user" : "");
  const action = rawAction;
  const organization = typeof raw.organization === "string" ? raw.organization.trim() : "";
  if (!type || !action) throw gatewayError(400, "WEBHOOK_PAYLOAD_INVALID", "Webhook 缺少 type 或 action");
  if ((type === "user" || type === "organization") && !organization) throw gatewayError(400, "WEBHOOK_PAYLOAD_INVALID", "用户或组织 Webhook 缺少 organization");
  const impacted = new Set<string>();
  const targeted = (raw.user ?? raw.target ?? raw.object ?? raw.group ?? raw.role ?? raw.permission) as unknown;
  const targetName = typeof targeted === "string" ? targeted.trim() : "";
  const memberActions = new Set(["update", "delete", "add-user", "remove-user", "add-role", "remove-role"]);
  if (type === "user" && memberActions.has(action) && organization && targetName) impacted.add(`${organization}/${targetName}`);
  if (type === "organization" && action === "delete" && organization) impacted.add(`${organization}/*`);
  const revocationActions = new Set(["delete", "remove-user"]);
  const shouldRevoke = revocationActions.has(action) && (type === "user" || type === "organization");
  if (shouldRevoke) {
    await serialized(async () => {
      const next = await getStore();
      const now = new Date().toISOString();
      if (type === "organization" && action === "delete") {
        const tenantEntries = next.memberRevocations[organization] ?? {};
        tenantEntries["*"] = { subject: "*", revokedAt: now, revokedBy: "casdoor.organization.delete", reason: "Casdoor organization deleted" };
        next.memberRevocations[organization] = tenantEntries;
        const policy = tenantPolicy(next, organization);
        next.tenantPolicies[organization] = { ...policy, status: "archived", version: policy.version + 1, updatedAt: now, updatedBy: "casdoor.organization.delete" };
      } else {
        const tenantEntries = next.memberRevocations[organization] ?? {};
        for (const subject of impacted) {
          const sub = subject.includes("/") ? subject.slice(subject.indexOf("/") + 1) : null;
          if (!sub || sub === "*") continue;
          tenantEntries[sub] = { subject: sub, revokedAt: now, revokedBy: `casdoor.${type}.${action}`, reason: `Casdoor webhook ${type}/${action}` };
        }
        if (Object.keys(tenantEntries).length) next.memberRevocations[organization] = tenantEntries;
      }
      await saveStore(next);
    });
  }
  const authorizationChangeActions = new Set(["add", "create", "update", "delete", "add-user", "remove-user", "add-role", "remove-role"]);
  const shouldInvalidateAuthorization = Boolean(organization) && authorizationChangeActions.has(action) && ["user", "organization", "group", "role", "permission"].includes(type);
  if (shouldInvalidateAuthorization) await bumpAuthorizationVersion(organization);
  let welcome: { subject: string; idempotencyKey: string; issued: boolean } | undefined;
  if (autoWelcomeFromCasdoorWebhook && autoWelcomeOrganizations.has(organization)) {
    const subject = casdoorWelcomeSubject(raw);
    if (subject) {
      const idempotencyKey = welcomeIdempotencyKey(organization, subject);
      try {
        const result = await issueWelcomeCredit(organization, subject, idempotencyKey);
        welcome = { subject, idempotencyKey, issued: result.created };
        await audit({ requestId, at: new Date().toISOString(), subject, tenantId: organization, resource: `credits/${subject}`, action: "welcome-grant", outcome: "success", reason: `casdoor.${type}.${action}` });
      } catch (error) {
        const code = (error as GatewayError).code;
        if (code !== "WELCOME_CREDIT_ALREADY_ISSUED") throw error;
        welcome = { subject, idempotencyKey, issued: false };
      }
    }
  }
  if ((type === "group" || type === "role" || type === "permission") && memberActions.has(action) && organization) {
    void audit({ requestId, at: new Date().toISOString(), tenantId: organization, action: `${type}.${action}`, outcome: "success", reason: targetName || "" });
    metrics.webhookAccepted += 1;
    success(res, { ok: true, received: type, action, impacted: Array.from(impacted), revoked: shouldRevoke, ...(welcome ? { welcome } : {}) });
    return;
  }
  for (const subject of impacted) {
    void audit({ requestId, at: new Date().toISOString(), subject, tenantId: organization || "*", action, outcome: "success", reason: `casdoor.${type}` });
  }
  metrics.webhookAccepted += 1;
  success(res, { ok: true, received: type, action, impacted: Array.from(impacted), revoked: shouldRevoke, ...(welcome ? { welcome } : {}) });
}

async function handleTenantHealth(res: ServerResponse, identity: JwtIdentity): Promise<void> {
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  const usage = current.runtimeUsage[identity.tenantId];
  const revoked = Object.keys(current.memberRevocations[identity.tenantId] ?? {}).length;
  const activeSessions = Object.keys(current.sessions[identity.tenantId] ?? {}).length;
  const todayUsage = usage?.date === todayKey() ? usage : undefined;
  const tokensUsedToday = todayUsage?.tokens ?? 0;
  const tokensReservedToday = todayUsage?.reservedTokens ?? 0;
  const pointsUsedToday = todayUsage?.points ?? 0;
  const pointsReservedToday = todayUsage?.reservedPoints ?? 0;
  const resourcesByType = current.resources.reduce<Record<string, number>>((acc, resource) => {
    if (resource.tenantId !== identity.tenantId) return acc;
    acc[resource.type] = (acc[resource.type] ?? 0) + 1;
    return acc;
  }, {});
  const health = await storeAdapter.health();
  success(res, {
    tenantId: identity.tenantId,
    policy: { status: policy.status, maxResources: policy.maxResources, version: policy.version, killSwitch: policy.killSwitch === true, modelAllowlist: policy.modelAllowlist?.length ?? 0, mcpAllowlist: policy.mcpAllowlist?.length ?? 0, maxTokensPerDay: policy.maxTokensPerDay, tokensUsedToday, tokensReservedToday, maxPointsPerDay: policy.maxPointsPerDay, pointsUsedToday, pointsReservedToday },
    budgets: {
      tokens: tenantBudgetSummary(policy.maxTokensPerDay, tokensUsedToday, tokensReservedToday),
      points: tenantBudgetSummary(policy.maxPointsPerDay, pointsUsedToday, pointsReservedToday),
    },
    resources: resourcesByType,
    revokedMembers: revoked,
    activeSessions,
    store: { kind: storeAdapter.kind, ok: health.ok, latencyMs: health.latencyMs, error: health.error },
    siem: siemSink ? { kind: siemSink.kind, endpoint: siemSink.endpoint, filePath: siemSink.filePath } : null,
    at: new Date().toISOString(),
  });
}

async function handleAuditArchive(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity): Promise<void> {
  assertTenantLifecycleAccess(identity);
  if (!storeAdapter.archiveAudit) throw gatewayError(501, "ARCHIVE_UNSUPPORTED", "当前存储后端不支持审计归档");
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const before = url.searchParams.get("before");
  if (!before || !/^\d{4}-\d{2}-\d{2}T/.test(before)) throw gatewayError(400, "INVALID_BEFORE", "archive 接口需要 before=ISO 时间");
  const result = await storeAdapter.archiveAudit(before);
  void audit({ requestId: randomUUID(), at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, action: "audit.archive", outcome: "success", reason: `before=${before}` });
  success(res, result);
}

async function handleAuditExport(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity): Promise<void> {
  assertTenantAuditAccess(identity);
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const format = (url.searchParams.get("format") ?? "jsonl").toLowerCase();
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam && /^\d{4}-\d{2}-\d{2}T/.test(sinceParam) ? sinceParam : undefined;
  const limit = boundedNumber(url.searchParams.get("limit") ?? undefined, 5000, 1, 50_000);
  const events = (await storeAdapter.listAudit(identity.tenantId, limit)).filter((event) => !since || event.at >= since);
  const file = format === "csv"
    ? events.map((event) => [event.requestId, event.at, event.subject ?? "", event.tenantId ?? "", event.resource ?? "", event.action, event.outcome, (event.reason ?? "").replace(/[\r\n,]/g, " ")].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n")
    : events.map((event) => JSON.stringify(event)).join("\n");
  const body = format === "csv" ? `${file ? "requestId,at,subject,tenantId,resource,action,outcome,reason\n" : ""}${file}\n` : `${file}\n`;
  res.statusCode = 200;
  res.setHeader("content-type", format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="casdoor-audit-${identity.tenantId}-${Date.now()}.${format === "csv" ? "csv" : "jsonl"}"`);
  res.end(body);
}

async function rawBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > maxBodyBytes) throw gatewayError(413, "REQUEST_TOO_LARGE", "请求体超过限制");
    chunks.push(data);
  }
  return size ? Buffer.concat(chunks).toString("utf8") : "";
}

async function bodyWithRaw(req: IncomingMessage): Promise<{ raw: string; value: unknown }> {
  const raw = await rawBody(req);
  if (!raw) return { raw, value: {} };
  try { return { raw, value: JSON.parse(raw) }; }
  catch { throw gatewayError(400, "INVALID_JSON", "请求体不是有效 JSON"); }
}

async function body(req: IncomingMessage): Promise<unknown> {
  return (await bodyWithRaw(req)).value;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "string") return value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  if (!value || typeof value !== "object") return [];
  const objectValue = value as Record<string, unknown>;
  const name = typeof objectValue.name === "string" ? objectValue.name.trim() : "";
  const owner = typeof objectValue.owner === "string" ? objectValue.owner.trim() : "";
  return name ? [owner && !name.includes("/") ? `${owner}/${name}` : name] : [];
}

function tenantIds(claims: JwtClaims): Set<string> {
  const result = new Set<string>();
  for (const value of [claims.organizations, claims.organization, claims.org, claims.owner].flatMap(strings)) result.add(value.includes("/") ? value.slice(0, value.indexOf("/")) : value);
  return result;
}

function claimNames(claims: JwtClaims, keys: string[]): Set<string> {
  return new Set(keys.flatMap((key) => strings(claims[key])).map((value) => value.toLowerCase()));
}

function isAdmin(claims: JwtClaims): boolean {
  return claims.isAdmin === true || claims.isAdmin === "true" || ["admin", "administrator", "tenant-admin"].some((role) => claimNames(claims, ["roles", "groups"]).has(role));
}

function isGlobalAdmin(claims: JwtClaims): boolean {
  return claims.isAdmin === true || claims.isAdmin === "true";
}

function hasNamedPermission(claims: JwtClaims, names: string[]): boolean {
  const permissions = claimNames(claims, ["permissions", "capabilities"]);
  return names.some((name) => permissions.has(name.toLowerCase()));
}

const WEKNORA_EXCHANGE_PERMISSIONS = [
  "weknora.platform.admin",
  "weknora.workspace.read",
  "weknora.workspace.contribute",
  "weknora.workspace.admin",
  "weknora.workspace.owner",
] as const;

function hasWeKnoraExchangePermission(claims: JwtClaims): boolean {
  // Casdoor may emit permissions either as plain strings (test fixtures) or as
  // objects whose `name` and `owner` get combined into "owner/name" by strings().
  // The unified WeKnora permission dictionary is referenced by short name only
  // (e.g. "weknora.platform.admin"). Accept both forms so live Casdoor tokens
  // can match the dictionary.
  const required = [...WEKNORA_EXCHANGE_PERMISSIONS];
  const permissions = new Set<string>();
  for (const key of ["permissions", "capabilities"]) {
    const value = claims[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          permissions.add(entry.toLowerCase());
          for (const piece of entry.split(/[\s,;]+/)) if (piece.trim()) permissions.add(piece.trim().toLowerCase());
        } else if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          const name = typeof obj.name === "string" ? obj.name.trim() : "";
          if (name) permissions.add(name.toLowerCase());
        }
      }
    } else if (typeof value === "string") {
      for (const piece of value.split(/[\s,;]+/)) if (piece.trim()) permissions.add(piece.trim().toLowerCase());
    }
  }
  return required.some((name) => permissions.has(name.toLowerCase()));
}

function hasPermission(claims: JwtClaims, resource: CasdoorResourceType, action: string): boolean {
  if (isAdmin(claims)) return true;
  const permissions = claimNames(claims, ["permissions", "capabilities"]);
  const capability = resource === "project" ? "team.workspace" : "cloud.sync";
  const candidates = [`${resource}.${action}`, `${resource}:${action}`, `resource.${resource}.${action}`, `${resource}.*`, `resource:${resource}:*`, capability];
  return candidates.some((candidate) => permissions.has(candidate));
}

function defaultTenantPolicy(): TenantPolicy {
  return { status: "active", maxResources: defaultTenantMaxResources, version: 1, updatedAt: new Date(0).toISOString() };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAllowlist(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].slice(0, 256).map((entry) => entry.slice(0, 200));
  return items;
}

function normalizeNewApiGroup(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const group = value.trim();
  return /^[a-zA-Z0-9_.:-]{1,120}$/.test(group) ? group : undefined;
}

function newApiCredential(group?: string): string {
  if (group) {
    if (newApiGroupTokens[group]) return newApiGroupTokens[group];
    if (newApiGroup && group === newApiGroup) return newApiToken;
    return "";
  }
  return newApiToken;
}

function newApiAttributionHeaders(identity: JwtIdentity, context: NewApiAttributionContext = {}): Record<string, string> {
  return {
    "x-openbuddy-tenant": identity.tenantId,
    "x-openbuddy-subject": identity.subject,
    ...(context.actorSubject ? { "x-openbuddy-actor": context.actorSubject } : {}),
    ...(context.requestId ? { "x-openbuddy-request-id": context.requestId } : {}),
    ...(context.agentId ? { "x-openbuddy-agent": context.agentId } : {}),
    ...(context.sessionId ? { "x-openbuddy-session": context.sessionId } : {}),
    ...(context.walletId ? { "x-openbuddy-wallet": context.walletId } : {}),
  };
}

function newApiCapability(group: string, model: string, protocol: NewApiProtocol): NewApiCapability | undefined {
  return newApiCapabilities[group]?.[model]?.[protocol] ?? newApiCapabilities[group]?.["*"]?.[protocol] ?? newApiCapabilities["*"]?.[model]?.[protocol] ?? newApiCapabilities["*"]?.["*"]?.[protocol];
}

function hasNewApiModelCapability(group: string, model: string): boolean {
  const entries = [
    newApiCapabilities[group]?.[model],
    newApiCapabilities[group]?.["*"],
    newApiCapabilities["*"]?.[model],
    newApiCapabilities["*"]?.["*"],
  ];
  return entries.some((entry) => Boolean(entry && Object.keys(entry).length > 0));
}

function assertNewApiCapability(group: string, model: string, protocol: NewApiProtocol, streaming = false): void {
  const capability = newApiCapability(group, model, protocol);
  const enforceDirectory = process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
  if (enforceDirectory && Object.keys(newApiCapabilities).length > 0 && !capability) {
    throw gatewayError(501, "NEW_API_CAPABILITY_UNVERIFIED", "当前模型协议未通过 New API 能力验收");
  }
  if (capability && !capability.supported) throw gatewayError(501, "NEW_API_PROTOCOL_UNSUPPORTED", capability.reason || "当前 New API 渠道不支持该协议");
  if (streaming && capability && capability.streaming !== true && (capability.streaming === false || enforceDirectory)) {
    throw gatewayError(501, "AI_STREAM_UNSUPPORTED", capability.reason || "当前模型协议未通过流式响应验收");
  }
}

function normalizedTenantPolicy(value: unknown): TenantPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const status = item.status === "suspended" || item.status === "archived" ? item.status : item.status === "active" ? "active" : undefined;
  const max = typeof item.maxResources === "number" && Number.isInteger(item.maxResources) ? Math.max(1, Math.min(maxResources, item.maxResources)) : undefined;
  if (!status || !max) return undefined;
  const version = typeof item.version === "number" && Number.isInteger(item.version) && item.version >= 1 ? item.version : 1;
  const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date(0).toISOString();
  const updatedBy = typeof item.updatedBy === "string" && item.updatedBy.trim() ? item.updatedBy.trim().slice(0, 200) : undefined;
  const modelAllowlist = normalizeAllowlist(item.modelAllowlist);
  const mcpAllowlist = normalizeAllowlist(item.mcpAllowlist);
  const killSwitch = item.killSwitch === true;
  const maxTokensPerDay = typeof item.maxTokensPerDay === "number" && Number.isInteger(item.maxTokensPerDay) && item.maxTokensPerDay >= 0 ? item.maxTokensPerDay : undefined;
  const maxPointsPerDay = typeof item.maxPointsPerDay === "number" && Number.isInteger(item.maxPointsPerDay) && item.maxPointsPerDay >= 0 ? item.maxPointsPerDay : undefined;
  const newApiGroup = normalizeNewApiGroup(item.newApiGroup);
  return { status, maxResources: max, version, updatedAt, ...(updatedBy ? { updatedBy } : {}), ...(modelAllowlist ? { modelAllowlist } : {}), ...(mcpAllowlist ? { mcpAllowlist } : {}), ...(killSwitch ? { killSwitch } : {}), ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(newApiGroup ? { newApiGroup } : {}) };
}

async function discover(): Promise<string> {
  if (discoveryCache && discoveryCache.expiresAt > Date.now()) return discoveryCache.jwksUri;
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error("Casdoor discovery failed");
  const value = await response.json() as { issuer?: unknown; jwks_uri?: unknown };
  if (value.issuer && value.issuer !== issuer) throw new Error("Casdoor issuer mismatch");
  if (typeof value.jwks_uri !== "string") throw new Error("Casdoor discovery lacks jwks_uri");
  discoveryCache = { expiresAt: Date.now() + 300_000, jwksUri: value.jwks_uri };
  return value.jwks_uri;
}

async function keys(): Promise<Array<Record<string, unknown>>> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(await discover(), { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error("Casdoor JWKS failed");
  const value = await response.json() as { keys?: unknown };
  if (!Array.isArray(value.keys)) throw new Error("Casdoor JWKS is invalid");
  jwksCache = { expiresAt: Date.now() + 300_000, keys: value.keys.filter((key): key is Record<string, unknown> => Boolean(key && typeof key === "object")) };
  return jwksCache.keys;
}

function base64Json<T>(value: string): T {
  return JSON.parse(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4), "base64url").toString("utf8")) as T;
}

function ecdsaDer(signature: Buffer): Buffer {
  const size = signature.length / 2;
  const trim = (value: Buffer) => { let start = 0; while (start < value.length - 1 && value[start] === 0) start += 1; const result = value.subarray(start); return result[0] & 0x80 ? Buffer.concat([Buffer.from([0]), result]) : result; };
  const r = trim(signature.subarray(0, size));
  const s = trim(signature.subarray(size));
  return Buffer.concat([Buffer.from([0x30, 4 + r.length + s.length, 0x02, r.length]), r, Buffer.from([0x02, s.length]), s]);
}

async function authenticate(req: IncomingMessage, tenantId: string): Promise<JwtIdentity> {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw gatewayError(401, "AUTHENTICATION_REQUIRED", "需要 Bearer access token");
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw gatewayError(401, "INVALID_TOKEN", "access token 无效");
  let header: JwtHeader;
  let claims: JwtClaims;
  try { header = base64Json<JwtHeader>(parts[0]); claims = base64Json<JwtClaims>(parts[1]); }
  catch { throw gatewayError(401, "INVALID_TOKEN", "access token 无效"); }
  const algorithm = header.alg;
  if (!header.kid || !algorithm || !["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"].includes(algorithm)) throw gatewayError(401, "INVALID_TOKEN", "access token 签名算法无效");
  if (claims.iss !== issuer || (audience && !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience))) throw gatewayError(401, "INVALID_TOKEN", "access token issuer 或 audience 无效");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now || (typeof claims.nbf === "number" && claims.nbf > now + 30)) throw gatewayError(401, "TOKEN_EXPIRED", "access token 已过期或尚未生效");
  const jwk = (await keys()).find((key) => key.kid === header.kid);
  if (!jwk) { jwksCache = null; throw gatewayError(401, "INVALID_TOKEN", "access token 签名 key 不存在"); }
  const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[2].length % 4) % 4), "base64");
  const hashAlgorithm = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512", ES256: "SHA256", ES384: "SHA384", ES512: "SHA512" }[algorithm];
  if (!hashAlgorithm) throw gatewayError(401, "INVALID_TOKEN", "access token 签名算法无效");
  const verifier = createVerify(hashAlgorithm);
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify({ key: createPublicKey({ key: jwk as never, format: "jwk" }), dsaEncoding: "der" }, algorithm.startsWith("ES") ? ecdsaDer(signature) : signature)) throw gatewayError(401, "INVALID_TOKEN", "access token 签名校验失败");
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (!subject || !tenantId || !tenantIds(claims).has(tenantId) && !isGlobalAdmin(claims)) throw gatewayError(403, "TENANT_MEMBERSHIP_REQUIRED", "主体不属于请求租户");
  return { subject, claims, tenantId };
}

function exchangeTokenPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function exchangeTokenString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function exchangeTokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function authorizationVersion(state: ResourceStore, tenantId: string): number {
  return state.authorizationVersions[tenantId] ?? 1;
}

async function currentAuthorizationVersion(tenantId: string): Promise<number> {
  return authorizationVersion(await getStore(), tenantId);
}

async function bumpAuthorizationVersion(tenantId: string): Promise<void> {
  if (!tenantId) return;
  await serialized(async () => {
    const next = await getStore();
    next.authorizationVersions[tenantId] = authorizationVersion(next, tenantId) + 1;
    await saveStore(next);
  });
}

async function handleWeKnoraTokenIntrospection(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!weknoraExchangeSecret || !weknoraExchangeSecretStrong) throw gatewayError(503, "TOKEN_EXCHANGE_DISABLED", "WeKnora token exchange 未配置");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "token introspection 只接受 POST");
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw gatewayError(401, "AUTHENTICATION_REQUIRED", "需要 Bearer exchange token");
  const token = authorization.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 无效");
  let header: { alg?: unknown; typ?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = base64Json(parts[0]) as { alg?: unknown; typ?: unknown };
    claims = base64Json(parts[1]) as Record<string, unknown>;
  } catch {
    throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 无效");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 算法无效");
  const expected = createHmac("sha256", weknoraExchangeSecret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const provided = Buffer.from(parts[2], "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 签名无效");
  const subject = exchangeTokenString(claims.sub);
  const oidcSubject = exchangeTokenString(claims.oidc_subject);
  const casdoorTenant = exchangeTokenString(claims.casdoor_tenant);
  const sessionId = exchangeTokenString(claims.session_id);
  const membershipVersion = exchangeTokenString(claims.membership_version);
  const jti = exchangeTokenString(claims.jti);
  const tenantId = exchangeTokenNumber(claims.tenant_id);
  const tokenAuthorizationVersion = exchangeTokenNumber(claims.authorization_version);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== `${issuer}/gateway` || claims.aud !== weknoraExchangeAudience || claims.token_type !== "weknora_exchange" || !subject || oidcSubject !== subject || !casdoorTenant || !sessionId || !membershipVersion || !jti || !Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(tokenAuthorizationVersion) || tokenAuthorizationVersion < 1 || exchangeTokenNumber(claims.exp) <= now || exchangeTokenNumber(claims.iat) > now + 30) {
    throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token claims 无效");
  }
  if (weknoraTenantMap[casdoorTenant] !== tenantId) throw gatewayError(403, "TOKEN_EXCHANGE_TENANT_MAPPING_REQUIRED", "Casdoor 租户与 WeKnora 空间映射不匹配");
  if (tokenAuthorizationVersion !== await currentAuthorizationVersion(casdoorTenant)) throw gatewayError(403, "AUTHORIZATION_VERSION_REVOKED", "WeKnora exchange token 的权限版本已失效");
  await assertMemberNotRevoked({ subject, claims: {}, tenantId: casdoorTenant });
  success(res, { active: true, subject, oidc_subject: oidcSubject, casdoor_tenant: casdoorTenant, tenant_id: tenantId, session_id: sessionId, membership_version: membershipVersion, authorization_version: tokenAuthorizationVersion, jti });
}

async function handleWeKnoraTokenExchange(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  if (!weknoraExchangeSecret || !weknoraExchangeSecretStrong) throw gatewayError(503, "TOKEN_EXCHANGE_DISABLED", "WeKnora token exchange 未配置");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "token exchange 只接受 POST");
  const input = await body(req) as { tenant?: unknown; weknoraTenantId?: unknown; sessionId?: unknown };
  const casdoorTenant = typeof input.tenant === "string" ? input.tenant.trim() : "";
  const weknoraTenantId = typeof input.weknoraTenantId === "number" && Number.isSafeInteger(input.weknoraTenantId)
    ? input.weknoraTenantId
    : typeof input.weknoraTenantId === "string" && /^\d+$/.test(input.weknoraTenantId.trim())
      ? Number(input.weknoraTenantId)
      : 0;
  if (!casdoorTenant || !/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(casdoorTenant) || !Number.isSafeInteger(weknoraTenantId) || weknoraTenantId <= 0) {
    throw gatewayError(400, "TOKEN_EXCHANGE_REQUEST_INVALID", "token exchange 缺少有效的租户绑定");
  }
  if (Object.keys(weknoraTenantMap).length === 0 || weknoraTenantMap[casdoorTenant] !== weknoraTenantId) {
    throw gatewayError(403, "TOKEN_EXCHANGE_TENANT_MAPPING_REQUIRED", "Casdoor 租户与 WeKnora 空间映射不匹配");
  }
  const identity = await authenticate(req, casdoorTenant);
  await assertMemberNotRevoked(identity);
  if (!hasWeKnoraExchangePermission(identity.claims)) {
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: casdoorTenant, resource: "weknora/token-exchange", action: "issue", outcome: "deny", reason: "weknora_permission_required" });
    throw gatewayError(403, "WEKNORA_PERMISSION_REQUIRED", "当前主体没有 WeKnora 工作区权限");
  }
  const now = Math.floor(Date.now() / 1000);
  const currentVersion = await currentAuthorizationVersion(casdoorTenant);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    iss: `${issuer}/gateway`,
    aud: weknoraExchangeAudience,
    sub: identity.subject,
    oidc_issuer: issuer,
    oidc_subject: identity.subject,
    casdoor_tenant: casdoorTenant,
    tenant_id: weknoraTenantId,
    token_type: "weknora_exchange",
    session_id: typeof input.sessionId === "string" && input.sessionId.trim() ? input.sessionId.trim().slice(0, 200) : randomUUID(),
    membership_version: createHash("sha256").update(JSON.stringify({ organizations: identity.claims.organizations, organization: identity.claims.organization, permissions: identity.claims.permissions, roles: identity.claims.roles })).digest("hex").slice(0, 32),
    authorization_version: currentVersion,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  };
  const encodedHeader = exchangeTokenPart(header);
  const encodedClaims = exchangeTokenPart(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", weknoraExchangeSecret).update(signingInput).digest("base64url");
  rememberWeKnoraJti(claims.jti as string, identity.subject, now + 300);
  await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: casdoorTenant, resource: "weknora/token-exchange", action: "issue", outcome: "success" });
  success(res, { access_token: `${signingInput}.${signature}`, token_type: "Bearer", expires_in: 300, audience: weknoraExchangeAudience });
}

/**
 * handleWeKnoraTokenRefresh — sliding-window refresh for an existing weknora_exchange token.
 *
 * Unlike the original `POST /v1/token-exchange/weknora` (which requires a fresh Casdoor JWT),
 * this endpoint accepts the current weknora_exchange token itself as the bearer credential.
 * The endpoint re-validates HMAC, all claims, tenant mapping, authorization_version, and
 * member-revocation status — exactly the same checks as `introspect` — then mints a new
 * weknora_exchange token with:
 *   - fresh exp (now + 300)
 *   - fresh jti (random UUID)
 *   - optional new sessionId from request body (kept stable if absent → same conversation)
 *   - membership_version + authorization_version re-read from live store
 *
 * Trade-off: an attacker who steals an exchange token can also refresh it (until revocation
 * or authorization_version bump kicks in). We accept this because:
 *   - the token itself is short-lived (5 min) and HS256-signed with a 32-char secret
 *   - revocation via /v1/backchannel-logout/casdoor flips memberRevocations, which this
 *     endpoint re-checks
 *   - the original Casdoor JWT must still be valid for /api/enforce (Gateway uses it to
 *     detect role/permission changes via authorization_version bump)
 *
 * This endpoint exists so that long-running OpenBuddy desktop sessions don't have to
 * bounce the user through Casdoor login every 5 minutes. The previous design had a
 * 5-minute hard cliff.
 */
async function handleWeKnoraTokenRefresh(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  if (!weknoraExchangeSecret || !weknoraExchangeSecretStrong) throw gatewayError(503, "TOKEN_EXCHANGE_DISABLED", "WeKnora token exchange 未配置");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "token refresh 只接受 POST");
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw gatewayError(401, "AUTHENTICATION_REQUIRED", "需要 Bearer exchange token");
  const oldToken = authorization.slice(7).trim();

  // 1) parse + verify signature (re-use the same logic as introspect)
  const parts = oldToken.split(".");
  if (parts.length !== 3) throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 无效");
  let header: { alg?: unknown; typ?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = base64Json(parts[0]) as { alg?: unknown; typ?: unknown };
    claims = base64Json(parts[1]) as Record<string, unknown>;
  } catch {
    throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 无效");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 算法无效");
  const expected = createHmac("sha256", weknoraExchangeSecret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  const provided = Buffer.from(parts[2], "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token 签名无效");
  }

  // 2) validate claims (same set as introspect)
  const subject = exchangeTokenString(claims.sub);
  const oidcSubject = exchangeTokenString(claims.oidc_subject);
  const casdoorTenant = exchangeTokenString(claims.casdoor_tenant);
  const oldSessionId = exchangeTokenString(claims.session_id);
  const oldMembershipVersion = exchangeTokenString(claims.membership_version);
  const oldJti = exchangeTokenString(claims.jti);
  const tenantId = exchangeTokenNumber(claims.tenant_id);
  const tokenAuthorizationVersion = exchangeTokenNumber(claims.authorization_version);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== `${issuer}/gateway` || claims.aud !== weknoraExchangeAudience || claims.token_type !== "weknora_exchange"
      || !subject || oidcSubject !== subject || !casdoorTenant || !oldSessionId || !oldMembershipVersion || !oldJti
      || !Number.isSafeInteger(tenantId) || tenantId <= 0
      || !Number.isSafeInteger(tokenAuthorizationVersion) || tokenAuthorizationVersion < 1
      || exchangeTokenNumber(claims.exp) <= now || exchangeTokenNumber(claims.iat) > now + 30) {
    throw gatewayError(401, "INVALID_EXCHANGE_TOKEN", "WeKnora exchange token claims 无效");
  }

  // 3) tenant mapping + authorization_version + revocation checks
  if (weknoraTenantMap[casdoorTenant] !== tenantId) throw gatewayError(403, "TOKEN_EXCHANGE_TENANT_MAPPING_REQUIRED", "Casdoor 租户与 WeKnora 空间映射不匹配");
  const currentVersion = await currentAuthorizationVersion(casdoorTenant);
  if (tokenAuthorizationVersion !== currentVersion) throw gatewayError(403, "AUTHORIZATION_VERSION_REVOKED", "WeKnora exchange token 的权限版本已失效");
  await assertMemberNotRevoked({ subject, claims: {}, tenantId: casdoorTenant });

  // 4) optional new sessionId from body (sliding window for long conversations)
  let newSessionId = oldSessionId;
  try {
    const raw = await body(req) as { sessionId?: unknown } | undefined;
    if (raw && typeof raw.sessionId === "string" && raw.sessionId.trim()) {
      const trimmed = raw.sessionId.trim().slice(0, 200);
      if (trimmed) newSessionId = trimmed;
    }
  } catch {
    // no body / unreadable body → keep old sessionId
  }

  // 5) mint a new token (same shape as exchange, with fresh jti + exp)
  const headerOut = { alg: "HS256" as const, typ: "JWT" as const };
  const claimsOut = {
    iss: `${issuer}/gateway`,
    aud: weknoraExchangeAudience,
    sub: subject,
    oidc_issuer: issuer,
    oidc_subject: oidcSubject,
    casdoor_tenant: casdoorTenant,
    tenant_id: tenantId,
    token_type: "weknora_exchange",
    session_id: newSessionId,
    membership_version: oldMembershipVersion,
    authorization_version: currentVersion,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  };
  const encodedHeader = exchangeTokenPart(headerOut);
  const encodedClaims = exchangeTokenPart(claimsOut);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac("sha256", weknoraExchangeSecret).update(signingInput).digest("base64url");
  rememberWeKnoraJti(claimsOut.jti, subject, now + 300);
  void audit({ requestId, at: new Date().toISOString(), subject, tenantId: casdoorTenant, resource: "weknora/token-exchange", action: "refresh", outcome: "success", reason: `old_jti=${oldJti}` });
  success(res, { access_token: `${signingInput}.${signature}`, token_type: "Bearer", expires_in: 300, audience: weknoraExchangeAudience, refreshed_from: oldJti });
}


function normalizeStore(value: unknown): ResourceStore {
  if (!value || typeof value !== "object") return { schemaVersion: 13, revision: 0, resources: [], idempotency: {}, tenantPolicies: {}, runtimeUsage: {}, memberRevocations: {}, authorizationVersions: {}, sessions: {}, creditAccounts: {}, creditWallets: {}, creditWalletMembers: {}, creditLedger: [], creditPricing: {}, billingPlans: {}, billingOrders: {}, billingSubscriptions: {}, newApiCostImports: {}, aiRequests: {}, creditExpiryRuns: {} };
  const objectValue = value as Record<string, unknown>;
  const resources = Array.isArray(objectValue.resources) ? objectValue.resources.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const tenantId = typeof item.tenantId === "string" ? item.tenantId.trim() : "";
    const ownerSubject = typeof item.ownerSubject === "string" ? item.ownerSubject.trim() : "";
    const type = item.type;
    const name = normalizeCasdoorResourceName(item.name);
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
    const version = typeof item.version === "number" && Number.isInteger(item.version) ? item.version : 0;
    if (!id || !tenantId || !ownerSubject || !isCasdoorResourceType(type) || !name || !createdAt || !updatedAt || version < 1) return [];
    return [{ id, tenantId, ownerSubject, type, name, metadata: normalizeCasdoorResourceMetadata(item.metadata), createdAt, updatedAt, version } satisfies CasdoorResourceRecord];
  }) : [];
  const retained = resources.slice(-maxResources);
  const retainedIds = new Set(retained.map((entry) => entry.id));
  const idempotency: Record<string, string> = {};
  if (objectValue.idempotency && typeof objectValue.idempotency === "object") {
    for (const [key, id] of Object.entries(objectValue.idempotency as Record<string, unknown>)) {
      if (/^[a-zA-Z0-9_.:-]{1,240}$/.test(key) && typeof id === "string" && retainedIds.has(id)) idempotency[key] = id;
    }
  }
  const tenantPolicies: Record<string, TenantPolicy> = {};
  if (objectValue.tenantPolicies && typeof objectValue.tenantPolicies === "object") {
    for (const [tenantId, policy] of Object.entries(objectValue.tenantPolicies as Record<string, unknown>)) {
      if (/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId)) {
        const normalized = normalizedTenantPolicy(policy);
        if (normalized) tenantPolicies[tenantId] = normalized;
      }
    }
  }
  const runtimeUsage: Record<string, RuntimeUsage> = {};
  if (objectValue.runtimeUsage && typeof objectValue.runtimeUsage === "object") {
    for (const [tenantId, value] of Object.entries(objectValue.runtimeUsage as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || !value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && typeof item.tokens === "number" && Number.isInteger(item.tokens) && item.tokens >= 0) {
        const reservedTokens = typeof item.reservedTokens === "number" && Number.isInteger(item.reservedTokens) && item.reservedTokens >= 0 ? Math.min(item.reservedTokens, 2_000_000_000) : 0;
        const points = typeof item.points === "number" && Number.isSafeInteger(item.points) && item.points >= 0 ? item.points : 0;
        const reservedPoints = typeof item.reservedPoints === "number" && Number.isSafeInteger(item.reservedPoints) && item.reservedPoints >= 0 ? item.reservedPoints : 0;
        runtimeUsage[tenantId] = { date: item.date, tokens: Math.min(item.tokens, 2_000_000_000), ...(reservedTokens > 0 ? { reservedTokens } : {}), ...(points > 0 ? { points } : {}), ...(reservedPoints > 0 ? { reservedPoints } : {}) };
      }
    }
  }
  const memberRevocations: Record<string, Record<string, TenantMemberRevocation>> = {};
  if (objectValue.memberRevocations && typeof objectValue.memberRevocations === "object") {
    for (const [tenantId, value] of Object.entries(objectValue.memberRevocations as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || !value || typeof value !== "object") continue;
      const entries: Record<string, TenantMemberRevocation> = {};
      for (const [subject, entry] of Object.entries(value as Record<string, unknown>).slice(0, 10_000)) {
        const normalizedSubject = normalizeSubject(subject);
        if (!normalizedSubject || !entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const revokedAt = typeof item.revokedAt === "string" && item.revokedAt ? item.revokedAt : "";
        const revokedBy = normalizeSubject(item.revokedBy);
        if (!revokedAt || !revokedBy) continue;
        const reason = normalizeRevocationReason(item.reason);
        entries[normalizedSubject] = { subject: normalizedSubject, revokedAt, revokedBy, ...(reason ? { reason } : {}) };
      }
      if (Object.keys(entries).length) memberRevocations[tenantId] = entries;
    }
  }
  const authorizationVersions: Record<string, number> = {};
  if (objectValue.authorizationVersions && typeof objectValue.authorizationVersions === "object") {
    for (const [tenantId, version] of Object.entries(objectValue.authorizationVersions as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) continue;
      authorizationVersions[tenantId] = version;
    }
  }
  const creditAccounts: Record<string, CreditAccount> = {};
  if (objectValue.creditAccounts && typeof objectValue.creditAccounts === "object") {
    for (const [key, value] of Object.entries(objectValue.creditAccounts as Record<string, unknown>).slice(0, 100_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const tenantId = normalizeSubject(item.tenantId);
      const subject = normalizeSubject(item.subject);
      const walletId = typeof item.walletId === "string" && item.walletId.trim() ? item.walletId.trim().slice(0, 120) : undefined;
      const lifetimeRefunded = item.lifetimeRefunded === undefined ? 0 : item.lifetimeRefunded;
      const lifetimeExpired = item.lifetimeExpired === undefined ? 0 : item.lifetimeExpired;
      const numbers = [item.balance, item.reserved, item.lifetimeGranted, item.lifetimeConsumed, lifetimeRefunded, lifetimeExpired, item.version];
      if (!tenantId || !subject || numbers.some((entry) => typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0)) continue;
      creditAccounts[key] = {
        tenantId, subject, ...(typeof item.walletId === "string" && item.walletId.trim() ? { walletId: item.walletId.trim().slice(0, 120) } : {}),
        plan: normalizeSubject(item.plan) || "free",
        balance: item.balance as number,
        reserved: item.reserved as number,
        lifetimeGranted: item.lifetimeGranted as number,
        lifetimeConsumed: item.lifetimeConsumed as number,
        lifetimeRefunded: lifetimeRefunded as number,
        lifetimeExpired: lifetimeExpired as number,
        updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date(0).toISOString(),
        version: item.version as number,
      };
    }
  }
  const creditWallets: ResourceStore["creditWallets"] = {};
  if (objectValue.creditWallets && typeof objectValue.creditWallets === "object") {
    for (const [key, value] of Object.entries(objectValue.creditWallets as Record<string, unknown>).slice(0, 100_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const id = normalizeSubject(item.id);
      const tenantId = normalizeSubject(item.tenantId);
      const name = normalizeSubject(item.name);
      const status = item.status === "suspended" || item.status === "archived" ? item.status : item.status === "active" ? "active" : undefined;
      const createdAt = typeof item.createdAt === "string" && item.createdAt ? item.createdAt : "";
      const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : createdAt;
      const createdBy = normalizeSubject(item.createdBy);
      if (!id || !tenantId || !name || !status || !createdAt || !updatedAt || !createdBy) continue;
      creditWallets[key] = { id, tenantId, name, status, createdAt, updatedAt, createdBy };
    }
  }
  const creditWalletMembers: ResourceStore["creditWalletMembers"] = {};
  if (objectValue.creditWalletMembers && typeof objectValue.creditWalletMembers === "object") {
    for (const [key, value] of Object.entries(objectValue.creditWalletMembers as Record<string, unknown>).slice(0, 200_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const walletId = normalizeSubject(item.walletId);
      const tenantId = normalizeSubject(item.tenantId);
      const subject = normalizeSubject(item.subject);
      const role = item.role === "owner" || item.role === "spender" || item.role === "viewer" ? item.role : undefined;
      const createdAt = typeof item.createdAt === "string" && item.createdAt ? item.createdAt : "";
      const updatedAt = typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : createdAt;
      const createdBy = normalizeSubject(item.createdBy);
      if (!walletId || !tenantId || !subject || !role || !createdAt || !updatedAt || !createdBy) continue;
      creditWalletMembers[key] = { walletId, tenantId, subject, role, createdAt, updatedAt, createdBy };
    }
  }
  const creditLedger: CreditLedgerEntry[] = [];
  if (Array.isArray(objectValue.creditLedger)) {
    for (const value of objectValue.creditLedger) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const type = item.type;
      const tenantId = normalizeSubject(item.tenantId);
      const subject = normalizeSubject(item.subject);
      const amount = item.amount;
      if (!tenantId || !subject || typeof item.id !== "string" || !tenantId || !["grant", "purchase", "consume", "refund", "expire", "adjustment", "reservation", "release"].includes(String(type)) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) continue;
      creditLedger.push({
        id: item.id.slice(0, 120), tenantId, subject, type: type as CreditLedgerEntryType, amount, unit: "points",
        ...(typeof item.requestId === "string" ? { requestId: item.requestId.slice(0, 120) } : {}),
        ...(typeof item.idempotencyKey === "string" ? { idempotencyKey: item.idempotencyKey.slice(0, 160) } : {}),
        ...(typeof item.model === "string" ? { model: item.model.slice(0, 200) } : {}),
        ...(typeof item.promptTokens === "number" && Number.isSafeInteger(item.promptTokens) ? { promptTokens: item.promptTokens } : {}),
        ...(typeof item.completionTokens === "number" && Number.isSafeInteger(item.completionTokens) ? { completionTokens: item.completionTokens } : {}),
        ...(typeof item.newApiRequestId === "string" ? { newApiRequestId: item.newApiRequestId.slice(0, 200) } : {}),
        ...(typeof item.newApiGroup === "string" ? { newApiGroup: item.newApiGroup.slice(0, 120) } : {}),
        ...(item.usageSource === "new-api" || item.usageSource === "estimated" ? { usageSource: item.usageSource } : {}),
        ...(item.pricingSnapshot && typeof item.pricingSnapshot === "object" ? (() => {
          const pricing = item.pricingSnapshot as Record<string, unknown>;
          const model = normalizeSubject(pricing.model);
          const inputRate = pricing.inputPointsPerThousand;
          const outputRate = pricing.outputPointsPerThousand;
          const minimumPoints = pricing.minimumPoints;
          const updatedAt = typeof pricing.updatedAt === "string" && pricing.updatedAt ? pricing.updatedAt : "";
          if (!model || !updatedAt || ![inputRate, outputRate, minimumPoints].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return {};
          const inputCostPerMillion = typeof pricing.inputCostPerMillion === "number" && Number.isFinite(pricing.inputCostPerMillion) && pricing.inputCostPerMillion >= 0 ? pricing.inputCostPerMillion : undefined;
          const outputCostPerMillion = typeof pricing.outputCostPerMillion === "number" && Number.isFinite(pricing.outputCostPerMillion) && pricing.outputCostPerMillion >= 0 ? pricing.outputCostPerMillion : undefined;
          const costCurrency = typeof pricing.costCurrency === "string" && /^[A-Z]{3}$/.test(pricing.costCurrency) ? pricing.costCurrency : undefined;
          const costSource = pricing.costSource === "configured-pricing" || pricing.costSource === "provider-reported" || pricing.costSource === "provider-reported-quota" ? pricing.costSource : undefined;
          return { pricingSnapshot: { model, inputPointsPerThousand: inputRate as number, outputPointsPerThousand: outputRate as number, minimumPoints: minimumPoints as number, ...(inputCostPerMillion === undefined ? {} : { inputCostPerMillion }), ...(outputCostPerMillion === undefined ? {} : { outputCostPerMillion }), ...(costCurrency ? { costCurrency } : {}), ...(costSource ? { costSource } : {}), updatedAt, ...(typeof pricing.updatedBy === "string" ? { updatedBy: normalizeSubject(pricing.updatedBy) } : {}) } satisfies CreditPricing };
        })() : {}),
        ...(typeof item.agentId === "string" ? { agentId: item.agentId.slice(0, 200) } : {}),
        ...(typeof item.sessionId === "string" ? { sessionId: item.sessionId.slice(0, 200) } : {}),
        ...(typeof item.orderId === "string" ? { orderId: item.orderId.slice(0, 160) } : {}),
        ...(typeof item.paymentId === "string" ? { paymentId: item.paymentId.slice(0, 200) } : {}),
        ...(typeof item.paymentChannel === "string" ? { paymentChannel: item.paymentChannel.slice(0, 80) } : {}),
        ...(typeof item.amountMinor === "number" && Number.isSafeInteger(item.amountMinor) && item.amountMinor >= 0 ? { amountMinor: item.amountMinor } : {}),
        ...(typeof item.currency === "string" ? { currency: item.currency.slice(0, 12) } : {}),
        ...(typeof item.upstreamCost === "number" && Number.isFinite(item.upstreamCost) && item.upstreamCost >= 0 ? { upstreamCost: item.upstreamCost } : {}),
        ...(typeof item.pointsSettled === "number" && Number.isSafeInteger(item.pointsSettled) ? { pointsSettled: item.pointsSettled } : {}),
        ...(typeof item.expiresAt === "string" && item.expiresAt ? { expiresAt: item.expiresAt } : {}),
        ...(typeof item.sourceLedgerId === "string" && item.sourceLedgerId ? { sourceLedgerId: item.sourceLedgerId.slice(0, 120) } : {}),
        ...(typeof item.previousHash === "string" && (item.previousHash === "" || /^[a-f0-9]{64}$/.test(item.previousHash)) ? { previousHash: item.previousHash } : {}),
        ...(typeof item.entryHash === "string" && /^[a-f0-9]{64}$/.test(item.entryHash) ? { entryHash: item.entryHash } : {}),
        ...(typeof item.actorSubject === "string" && item.actorSubject ? { actorSubject: normalizeSubject(item.actorSubject) } : {}),
        ...(typeof item.reason === "string" ? { reason: item.reason.slice(0, 240) } : {}),
        createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date(0).toISOString(),
        ...(typeof item.createdBy === "string" ? { createdBy: normalizeSubject(item.createdBy) } : {}),
      });
    }
  }
  const creditPricing: Record<string, CreditPricing> = {};
  if (objectValue.creditPricing && typeof objectValue.creditPricing === "object") {
    for (const [model, value] of Object.entries(objectValue.creditPricing as Record<string, unknown>).slice(0, 2_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (typeof item.inputPointsPerThousand !== "number" || typeof item.outputPointsPerThousand !== "number" || typeof item.minimumPoints !== "number" || ![item.inputPointsPerThousand, item.outputPointsPerThousand, item.minimumPoints].every((entry) => Number.isSafeInteger(entry) && entry >= 0)) continue;
      const inputCostPerMillion = typeof item.inputCostPerMillion === "number" && Number.isFinite(item.inputCostPerMillion) && item.inputCostPerMillion >= 0 ? item.inputCostPerMillion : undefined;
      const outputCostPerMillion = typeof item.outputCostPerMillion === "number" && Number.isFinite(item.outputCostPerMillion) && item.outputCostPerMillion >= 0 ? item.outputCostPerMillion : undefined;
      const costCurrency = typeof item.costCurrency === "string" && /^[A-Z]{3}$/.test(item.costCurrency) ? item.costCurrency : undefined;
      const costSource = item.costSource === "configured-pricing" || item.costSource === "provider-reported" || item.costSource === "provider-reported-quota" ? item.costSource : undefined;
      creditPricing[model] = { model: model.slice(0, 200), inputPointsPerThousand: item.inputPointsPerThousand, outputPointsPerThousand: item.outputPointsPerThousand, minimumPoints: item.minimumPoints, ...(inputCostPerMillion === undefined ? {} : { inputCostPerMillion }), ...(outputCostPerMillion === undefined ? {} : { outputCostPerMillion }), ...(costCurrency ? { costCurrency } : {}), ...(costSource ? { costSource } : {}), updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date(0).toISOString(), ...(typeof item.updatedBy === "string" ? { updatedBy: normalizeSubject(item.updatedBy) } : {}) };
    }
  }
  const billingPlans: Record<string, BillingPlan> = {};
  if (objectValue.billingPlans && typeof objectValue.billingPlans === "object") {
    for (const [id, value] of Object.entries(objectValue.billingPlans as Record<string, unknown>).slice(0, 1_000)) {
      if (!value || typeof value !== "object" || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) continue;
      const item = value as Record<string, unknown>;
      const priceMinor = item.priceMinor;
      const points = item.points;
      if (typeof item.name !== "string" || !item.name.trim() || typeof priceMinor !== "number" || !Number.isSafeInteger(priceMinor) || priceMinor < 0 || typeof points !== "number" || !Number.isSafeInteger(points) || points < 1) continue;
      const features = Array.isArray(item.features) ? item.features.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, 120)).slice(0, 32) : [];
      const entitlements = normalizeBillingEntitlements(item);
      const pointsValidDays = item.pointsValidDays === undefined ? undefined : Number(item.pointsValidDays);
      const entitlementsValidDays = item.entitlementsValidDays === undefined ? undefined : Number(item.entitlementsValidDays);
      if (pointsValidDays !== undefined && (!Number.isSafeInteger(pointsValidDays) || pointsValidDays < 1 || pointsValidDays > 3650)) continue;
      if (entitlementsValidDays !== undefined && (!Number.isSafeInteger(entitlementsValidDays) || entitlementsValidDays < 1 || entitlementsValidDays > 3650)) continue;
      billingPlans[id] = { id, name: item.name.trim().slice(0, 120), ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim().slice(0, 500) } : {}), currency: typeof item.currency === "string" && /^[A-Z]{3}$/.test(item.currency) ? item.currency : "CNY", priceMinor, points, active: item.active !== false, features, ...entitlements, ...(pointsValidDays === undefined ? {} : { pointsValidDays }), ...(entitlementsValidDays === undefined ? {} : { entitlementsValidDays }), updatedAt: typeof item.updatedAt === "string" && item.updatedAt ? item.updatedAt : new Date(0).toISOString(), ...(typeof item.updatedBy === "string" ? { updatedBy: normalizeSubject(item.updatedBy) } : {}) };
    }
  }
  const billingSubscriptions: Record<string, BillingSubscription> = {};
  if (objectValue.billingSubscriptions && typeof objectValue.billingSubscriptions === "object") {
    for (const [tenantId, value] of Object.entries(objectValue.billingSubscriptions as Record<string, unknown>).slice(-10_000)) {
      if (!value || typeof value !== "object" || !tenantId) continue;
      const item = value as Record<string, unknown>;
      const subject = normalizeSubject(item.subject);
      const planId = normalizeBillingPlanId(item.planId);
      const orderNo = normalizeBillingOrderNo(item.orderNo);
      const status = item.status === "active" || item.status === "cancelled" ? item.status : undefined;
      const startedAt = typeof item.startedAt === "string" && item.startedAt ? item.startedAt : "";
      const entitlements = normalizeBillingEntitlements(item.entitlements);
      if (!subject || !planId || !orderNo || !status || !startedAt) continue;
      const entitlementsExpiresAt = typeof item.entitlementsExpiresAt === "string" && Number.isFinite(Date.parse(item.entitlementsExpiresAt)) ? new Date(item.entitlementsExpiresAt).toISOString() : undefined;
      billingSubscriptions[tenantId] = { tenantId, subject, planId, orderNo, status, entitlements: entitlements ?? {}, startedAt, ...(entitlementsExpiresAt ? { entitlementsExpiresAt } : {}), ...(typeof item.endedAt === "string" ? { endedAt: item.endedAt } : {}), ...(typeof item.appliedPolicyVersion === "number" && Number.isSafeInteger(item.appliedPolicyVersion) ? { appliedPolicyVersion: item.appliedPolicyVersion } : {}), ...(item.previousPolicy && typeof item.previousPolicy === "object" ? { previousPolicy: normalizedTenantPolicy(item.previousPolicy) } : {}) };
    }
  }
  const billingOrders: Record<string, BillingOrder> = {};
  if (objectValue.billingOrders && typeof objectValue.billingOrders === "object") {
    for (const [key, value] of Object.entries(objectValue.billingOrders as Record<string, unknown>).slice(-100_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const status = item.status;
      const orderNo = typeof item.orderNo === "string" ? item.orderNo.trim() : key;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const tenantId = normalizeSubject(item.tenantId);
      const subject = normalizeSubject(item.subject);
      const planId = normalizeSubject(item.planId);
      const numbers = [item.points, item.amountMinor];
      if (!id || !orderNo || !tenantId || !subject || !planId || !BILLING_ORDER_STATUSES.includes(status as BillingOrderStatus) || numbers.some((entry) => typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0) || typeof item.idempotencyKey !== "string" || !item.createdAt || !item.updatedAt || !item.expiresAt) continue;
      const pointsValidDays = item.pointsValidDays === undefined ? undefined : Number(item.pointsValidDays);
      const entitlementsValidDays = item.entitlementsValidDays === undefined ? undefined : Number(item.entitlementsValidDays);
      const pointsExpiresAt = typeof item.pointsExpiresAt === "string" && Number.isFinite(Date.parse(item.pointsExpiresAt)) ? new Date(item.pointsExpiresAt).toISOString() : undefined;
      const entitlementsExpiresAt = typeof item.entitlementsExpiresAt === "string" && Number.isFinite(Date.parse(item.entitlementsExpiresAt)) ? new Date(item.entitlementsExpiresAt).toISOString() : undefined;
      if (pointsValidDays !== undefined && (!Number.isSafeInteger(pointsValidDays) || pointsValidDays < 1 || pointsValidDays > 3650)) continue;
      if (entitlementsValidDays !== undefined && (!Number.isSafeInteger(entitlementsValidDays) || entitlementsValidDays < 1 || entitlementsValidDays > 3650)) continue;
      billingOrders[orderNo] = { id, orderNo, tenantId, subject, planId, points: item.points as number, amountMinor: item.amountMinor as number, currency: typeof item.currency === "string" && /^[A-Z]{3}$/.test(item.currency) ? item.currency : "CNY", status: status as BillingOrderStatus, idempotencyKey: item.idempotencyKey.slice(0, 160), ...(pointsValidDays === undefined ? {} : { pointsValidDays }), ...(pointsExpiresAt ? { pointsExpiresAt } : {}), ...(entitlementsValidDays === undefined ? {} : { entitlementsValidDays }), ...(entitlementsExpiresAt ? { entitlementsExpiresAt } : {}), ...(normalizeBillingEntitlements(item.entitlements) ? { entitlements: normalizeBillingEntitlements(item.entitlements) } : {}), ...(typeof item.paymentChannel === "string" ? { paymentChannel: item.paymentChannel.slice(0, 80) } : {}), ...(typeof item.paymentId === "string" ? { paymentId: item.paymentId.slice(0, 200) } : {}), ...(typeof item.failureReason === "string" ? { failureReason: item.failureReason.slice(0, 240) } : {}), createdAt: String(item.createdAt), updatedAt: String(item.updatedAt), expiresAt: String(item.expiresAt), ...(typeof item.paidAt === "string" ? { paidAt: item.paidAt } : {}), ...(typeof item.refundedAt === "string" ? { refundedAt: item.refundedAt } : {}) };
    }
  }
  const sessions: ResourceStore["sessions"] = {};
  if (objectValue.sessions && typeof objectValue.sessions === "object") {
    for (const [tenantId, bucket] of Object.entries(objectValue.sessions as Record<string, unknown>).slice(0, 10_000)) {
      if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId) || !bucket || typeof bucket !== "object") continue;
      const entries: ResourceStore["sessions"][string] = {};
      for (const [sessionId, value] of Object.entries(bucket as Record<string, unknown>).slice(0, 10_000)) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        const subject = normalizeSubject(item.subject);
        const kind = item.kind === "web" || item.kind === "automation" || item.kind === "team" || item.kind === "session" ? item.kind : "desktop";
        const scopes = Array.isArray(item.scopes) ? item.scopes.filter((entry): entry is string => typeof entry === "string").slice(0, 128) : [];
        const startedAt = typeof item.startedAt === "string" && item.startedAt ? item.startedAt : "";
        const lastSeenAt = typeof item.lastSeenAt === "string" && item.lastSeenAt ? item.lastSeenAt : startedAt;
        if (!sessionId || !subject || !startedAt || !lastSeenAt) continue;
        entries[sessionId] = {
          sessionId, subject, kind, scopes, startedAt, lastSeenAt,
          ...(typeof item.deviceFingerprint === "string" && item.deviceFingerprint ? { deviceFingerprint: item.deviceFingerprint.slice(0, 200) } : {}),
          ...(typeof item.endedAt === "string" && item.endedAt ? { endedAt: item.endedAt } : {}),
          ...(item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? { metadata: normalizeCasdoorResourceMetadata(item.metadata) } : {}),
        };
      }
      if (Object.keys(entries).length) sessions[tenantId] = entries;
    }
  }
  const newApiCostImports: Record<string, NewApiCostImport> = {};
  if (objectValue.newApiCostImports && typeof objectValue.newApiCostImports === "object") {
    for (const [key, value] of Object.entries(objectValue.newApiCostImports as Record<string, unknown>).slice(-200_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const tenantId = normalizeSubject(item.tenantId);
      const subject = normalizeSubject(item.subject);
      const walletId = typeof item.walletId === "string" && item.walletId.trim() ? item.walletId.trim().slice(0, 120) : undefined;
      const model = normalizeSubject(item.model);
      const source = typeof item.source === "string" ? item.source.replace(/[\r\n\t]/g, " ").trim().slice(0, 80) : "";
      const externalId = typeof item.externalId === "string" ? item.externalId.replace(/[\r\n\t]/g, " ").trim().slice(0, 240) : "";
      const importKey = typeof item.importKey === "string" ? item.importKey.replace(/[\r\n\t]/g, " ").trim().slice(0, 320) : "";
      const currency = typeof item.currency === "string" && /^[A-Z]{3}$/.test(item.currency) ? item.currency : "USD";
      const promptTokens = item.promptTokens;
      const completionTokens = item.completionTokens;
      const upstreamCost = item.upstreamCost;
      if (!tenantId || !subject || !model || !source || !externalId || !importKey || typeof item.id !== "string" || !Number.isSafeInteger(promptTokens) || (promptTokens as number) < 0 || !Number.isSafeInteger(completionTokens) || (completionTokens as number) < 0 || typeof upstreamCost !== "number" || !Number.isFinite(upstreamCost) || upstreamCost < 0 || typeof item.usageAt !== "string" || typeof item.importedAt !== "string") continue;
      const costBasis = item.costBasis === "provider-reported" || item.costBasis === "provider-reported-quota" || item.costBasis === "configured-pricing" ? item.costBasis : undefined;
      const channelRaw = item.channel && typeof item.channel === "object" && !Array.isArray(item.channel) ? item.channel as Record<string, unknown> : undefined;
      const channelId = channelRaw && typeof channelRaw.id === "string" ? channelRaw.id.replace(/[\r\n\t]/g, " ").trim().slice(0, 40) : "";
      const channelName = channelRaw && typeof channelRaw.name === "string" ? channelRaw.name.replace(/[\r\n\t]/g, " ").trim().slice(0, 120) : "";
      const cacheRaw = item.cache && typeof item.cache === "object" && !Array.isArray(item.cache) ? item.cache as Record<string, unknown> : undefined;
      const cacheTokens = cacheRaw && Number.isSafeInteger(cacheRaw.tokens) && (cacheRaw.tokens as number) >= 0 ? (cacheRaw.tokens as number) : undefined;
      const cacheRatio = cacheRaw && Number.isFinite(Number(cacheRaw.ratio)) ? Math.max(0, Math.min(1, Number(cacheRaw.ratio))) : undefined;
      const cacheCacheTokens = cacheRaw && Number.isSafeInteger(cacheRaw.cacheTokens) && (cacheRaw.cacheTokens as number) >= 0 ? (cacheRaw.cacheTokens as number) : undefined;
      newApiCostImports[key] = { id: item.id.slice(0, 120), tenantId, subject, ...(walletId ? { walletId } : {}), model, promptTokens: promptTokens as number, completionTokens: completionTokens as number, upstreamCost, currency, source, externalId, importKey, usageAt: item.usageAt, importedAt: item.importedAt, ...(typeof item.newApiRequestId === "string" ? { newApiRequestId: item.newApiRequestId.slice(0, 200) } : {}), ...(typeof item.newApiGroup === "string" ? { newApiGroup: item.newApiGroup.slice(0, 120) } : {}), ...(channelId || channelName ? { channel: { ...(channelId ? { id: channelId } : {}), ...(channelName ? { name: channelName } : {}) } } : {}), ...(cacheTokens !== undefined || cacheRatio !== undefined || cacheCacheTokens !== undefined ? { cache: { ...(cacheTokens !== undefined ? { tokens: cacheTokens } : {}), ...(cacheRatio !== undefined ? { ratio: cacheRatio } : {}), ...(cacheCacheTokens !== undefined ? { cacheTokens: cacheCacheTokens } : {}) } } : {}), ...(costBasis ? { costBasis } : {}) };
    }
  }
  const aiRequests: Record<string, AiRequestRecord> = {};
  if (objectValue.aiRequests && typeof objectValue.aiRequests === "object") {
    for (const [key, value] of Object.entries(objectValue.aiRequests as Record<string, unknown>).slice(-50_000)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const fingerprint = typeof item.fingerprint === "string" ? item.fingerprint.slice(0, 20_000) : "";
      const status = item.status === "running" || item.status === "completed" ? item.status : undefined;
      const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
      const expiresAt = typeof item.expiresAt === "string" ? item.expiresAt : "";
      if (!fingerprint || !status || !createdAt || !updatedAt || !expiresAt) continue;
      const record: AiRequestRecord = { fingerprint, status, createdAt, updatedAt, expiresAt, ...(typeof item.ownerRequestId === "string" ? { ownerRequestId: item.ownerRequestId.slice(0, 200) } : {}) };
      if (item.response && typeof item.response === "object") {
        const response = item.response as Record<string, unknown>;
        const responseStatus = Number(response.status);
        const responseBody = typeof response.body === "string" ? response.body : "";
        if (Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599 && responseBody.length <= maxBodyBytes) {
          const headers = response.headers && typeof response.headers === "object" && !Array.isArray(response.headers) ? Object.fromEntries(Object.entries(response.headers as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string").slice(0, 32)) : {};
          record.response = { status: responseStatus, headers, body: responseBody };
        }
      }
      aiRequests[normalizeAiRequestKey(key)] = record;
    }
  }
  const creditExpiryRuns: Record<string, CreditExpiryRun> = {};
  if (objectValue.creditExpiryRuns && typeof objectValue.creditExpiryRuns === "object") {
    for (const [requestId, value] of Object.entries(objectValue.creditExpiryRuns as Record<string, unknown>).slice(-10_000)) {
      if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(requestId) || !value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const tenantIds = Array.isArray(item.tenantIds) ? item.tenantIds.filter((tenantId): tenantId is string => typeof tenantId === "string" && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId)) : [];
      if (!tenantIds.length || typeof item.expired !== "number" || !Number.isSafeInteger(item.expired) || item.expired < 0 || typeof item.accounts !== "number" || !Number.isSafeInteger(item.accounts) || item.accounts < 0 || typeof item.wallets !== "number" || !Number.isSafeInteger(item.wallets) || item.wallets < 0 || typeof item.entitlementsExpired !== "boolean" || typeof item.createdAt !== "string") continue;
      creditExpiryRuns[requestId] = { requestId, tenantIds, expired: item.expired, accounts: item.accounts, wallets: item.wallets, entitlementsExpired: item.entitlementsExpired, createdAt: item.createdAt };
    }
  }
  const storedAnchor = typeof objectValue.creditLedgerAnchorHash === "string" && /^[a-f0-9]{64}$/.test(objectValue.creditLedgerAnchorHash) ? objectValue.creditLedgerAnchorHash : undefined;
  const ledgerAnchor = creditLedger.length > 200_000 ? creditLedger.at(-200_001)?.entryHash ?? storedAnchor : storedAnchor;
  const retainedLedger = creditLedger.slice(-200_000);
  const revision = typeof objectValue.revision === "number" && Number.isSafeInteger(objectValue.revision) && objectValue.revision >= 0 ? objectValue.revision : 0;
  return { schemaVersion: 13, revision, resources: retained, idempotency, tenantPolicies, runtimeUsage, memberRevocations, authorizationVersions, sessions, creditAccounts, creditWallets, creditWalletMembers, creditLedger: retainedLedger, ...(ledgerAnchor ? { creditLedgerAnchorHash: ledgerAnchor } : {}), creditPricing, billingPlans, billingOrders, billingSubscriptions, newApiCostImports, aiRequests, creditExpiryRuns };
}

async function getStore(): Promise<ResourceStore> {
  if (store && storeAdapter.kind !== "postgres" && storeAdapter.kind !== "mysql") return store;
  const raw = await storeAdapter.read();
  store = normalizeStore(raw);
  return store;
}

async function saveStore(next: ResourceStore): Promise<void> {
  const integrity = creditLedgerIntegrity(next);
  if (integrity.status === "invalid") throw gatewayError(500, "CREDIT_LEDGER_INTEGRITY_FAILED", "积分账本完整性校验失败，已拒绝写入");
  if (integrity.status === "backfillable") creditLedgerIntegrity(next, true);
  next.revision = Number(next.revision ?? store?.revision ?? 0) + 1;
  await storeAdapter.write(next);
  store = next;
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await operation(); }
      catch (error) {
        if ((error as { code?: string }).code !== "STORE_WRITE_CONFLICT" || attempt === 2) throw error;
        store = null;
      }
    }
    throw new Error("unreachable");
  });
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function audit(event: AuditEvent): Promise<void> {
  const traceId = currentTraceId();
  const result = auditQueue.then(async () => {
    const enriched = traceId ? { ...event, traceId, reason: event.reason?.slice(0, 240) } : { ...event, reason: event.reason?.slice(0, 240) };
    await storeAdapter.appendAudit(enriched);
    metrics.auditEvents += 1;
    if (siemSink) await appendSiem(enriched, siemSink).catch(() => undefined);
  });
  auditQueue = result.then(() => undefined, () => undefined);
  return result;
}

function traceIdFromHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const parts = raw.split("-");
  if (parts.length !== 4) return undefined;
  const traceId = parts[1];
  if (!/^[0-9a-f]{32}$/.test(traceId)) return undefined;
  return traceId;
}

function authorize(identity: JwtIdentity, resource: CasdoorResourceType, action: string, record?: CasdoorResourceRecord): void {
  if (record && record.tenantId !== identity.tenantId) throw gatewayError(404, "RESOURCE_NOT_FOUND", "企业资源不存在");
  if (record && record.ownerSubject !== identity.subject && !isAdmin(identity.claims) && !hasPermission(identity.claims, resource, action)) throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有资源权限");
  if (!record && !hasPermission(identity.claims, resource, action)) throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有资源权限");
}

function tenantPolicy(storeValue: ResourceStore, tenantId: string): TenantPolicy {
  return storeValue.tenantPolicies[tenantId] ?? defaultTenantPolicy();
}

function effectiveTenantPolicy(storeValue: ResourceStore, tenantId: string): TenantPolicy {
  const usage = storeValue.runtimeUsage[tenantId];
  return { ...tenantPolicy(storeValue, tenantId), tokensUsedToday: usage?.date === todayKey() ? usage.tokens : 0, tokensReservedToday: usage?.date === todayKey() ? usage.reservedTokens ?? 0 : 0, pointsUsedToday: usage?.date === todayKey() ? usage.points ?? 0 : 0, pointsReservedToday: usage?.date === todayKey() ? usage.reservedPoints ?? 0 : 0 };
}

async function currentTenantStore(tenantId: string): Promise<ResourceStore> {
  const current = await getStore();
  const subscription = current.billingSubscriptions[tenantId];
  if (!subscription || subscription.status !== "active" || !subscription.entitlementsExpiresAt || Date.parse(subscription.entitlementsExpiresAt) > Date.now()) return current;
  return serialized(async () => {
    const next = await getStore();
    if (expireBillingEntitlements(next, tenantId)) await saveStore(next);
    return next;
  });
}

function todayRuntimeUsage(state: ResourceStore, tenantId: string): RuntimeUsage {
  const previous = state.runtimeUsage[tenantId];
  return previous?.date === todayKey() ? { ...previous } : { date: todayKey(), tokens: 0 };
}

function reserveRuntimeUsage(state: ResourceStore, tenantId: string, policy: TenantPolicy, requestedTokens: number, points: number): void {
  const usage = todayRuntimeUsage(state, tenantId);
  const reservedTokens = usage.reservedTokens ?? 0;
  const usedPoints = usage.points ?? 0;
  const reservedPoints = usage.reservedPoints ?? 0;
  if (policy.maxTokensPerDay !== undefined && usage.tokens + reservedTokens + requestedTokens > policy.maxTokensPerDay) throw gatewayError(429, "TOKEN_QUOTA_EXCEEDED", "当前租户今日 token 配额不足");
  if (policy.maxPointsPerDay !== undefined && usedPoints + reservedPoints + points > policy.maxPointsPerDay) throw gatewayError(429, "POINTS_QUOTA_EXCEEDED", "当前租户今日积分预算不足");
  state.runtimeUsage[tenantId] = {
    date: usage.date,
    tokens: usage.tokens,
    ...(reservedTokens + requestedTokens > 0 ? { reservedTokens: reservedTokens + requestedTokens } : {}),
    ...(usedPoints > 0 ? { points: usedPoints } : {}),
    ...(reservedPoints + points > 0 ? { reservedPoints: reservedPoints + points } : {}),
  };
}

function releaseRuntimeReservation(state: ResourceStore, tenantId: string, reservedTokens: number, reservedPoints: number): void {
  const usage = todayRuntimeUsage(state, tenantId);
  const remainingTokens = Math.max(0, (usage.reservedTokens ?? 0) - reservedTokens);
  const remainingPoints = Math.max(0, (usage.reservedPoints ?? 0) - reservedPoints);
  state.runtimeUsage[tenantId] = {
    date: usage.date,
    tokens: usage.tokens,
    ...(remainingTokens > 0 ? { reservedTokens: remainingTokens } : {}),
    ...(usage.points && usage.points > 0 ? { points: usage.points } : {}),
    ...(remainingPoints > 0 ? { reservedPoints: remainingPoints } : {}),
  };
}

function settleRuntimeUsage(state: ResourceStore, tenantId: string, reservedTokens: number, reservedPoints: number, actualTokens: number, actualPoints: number): void {
  const usage = todayRuntimeUsage(state, tenantId);
  const remainingTokens = Math.max(0, (usage.reservedTokens ?? 0) - reservedTokens);
  const remainingPoints = Math.max(0, (usage.reservedPoints ?? 0) - reservedPoints);
  state.runtimeUsage[tenantId] = {
    date: usage.date,
    tokens: Math.min(2_000_000_000, usage.tokens + actualTokens),
    ...(remainingTokens > 0 ? { reservedTokens: remainingTokens } : {}),
    points: (usage.points ?? 0) + actualPoints,
    ...(remainingPoints > 0 ? { reservedPoints: remainingPoints } : {}),
  };
}

function runtimePointsBudgetExceeded(state: ResourceStore, tenantId: string, policy: TenantPolicy, reservationPoints: number, actualPoints: number): boolean {
  if (policy.maxPointsPerDay === undefined) return false;
  const usage = todayRuntimeUsage(state, tenantId);
  const committedPoints = (usage.points ?? 0) + Math.max(0, (usage.reservedPoints ?? 0) - reservationPoints);
  return committedPoints + actualPoints > policy.maxPointsPerDay;
}

function releaseCreditReservationState(state: ResourceStore, identity: JwtIdentity, reservation: CreditLedgerEntry, reason: string): void {
  const previous = reservation.walletId ? accountForWallet(state, identity.tenantId, reservation.walletId) : accountFor(state, identity.tenantId, identity.subject);
  const accountKey = reservation.walletId ? walletAccountKey(identity.tenantId, reservation.walletId) : creditKey(identity.tenantId, identity.subject);
  state.creditAccounts[accountKey] = { ...previous, reserved: Math.max(0, previous.reserved - reservation.amount), updatedAt: new Date().toISOString(), version: previous.version + 1 };
  appendCreditLedgerEntry(state, creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: "release", amount: 0, idempotencyKey: `${reservation.idempotencyKey}:settled`, model: reservation.model, pricingSnapshot: reservation.pricingSnapshot, requestId: reservation.requestId, newApiGroup: reservation.newApiGroup, actorSubject: reservation.actorSubject, agentId: reservation.agentId, sessionId: reservation.sessionId, reason }));
  appendCreditLedgerEntry(state, creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: "refund", amount: reservation.amount, idempotencyKey: `${reservation.idempotencyKey}:refund`, model: reservation.model, pricingSnapshot: reservation.pricingSnapshot, requestId: reservation.requestId, newApiGroup: reservation.newApiGroup, actorSubject: reservation.actorSubject, agentId: reservation.agentId, sessionId: reservation.sessionId, reason: `${reason}，释放预扣` }));
  releaseRuntimeReservation(state, identity.tenantId, (reservation.promptTokens ?? 0) + (reservation.completionTokens ?? 0), reservation.amount);
}

function lookupReservationAcrossWallet(state: ResourceStore, identity: JwtIdentity, reservationKey: string): CreditLedgerEntry | undefined {
  const direct = findLedgerByKey(state, identity.tenantId, identity.subject, reservationKey);
  if (direct) return direct;
  return state.creditLedger.find((entry) => entry.tenantId === identity.tenantId && entry.idempotencyKey === reservationKey && entry.type === "reservation" && (entry.subject === identity.subject || entry.subject.startsWith("wallet:"))) ?? undefined;
}

function assertTenantActive(policy: TenantPolicy): void {
  if (policy.status === "suspended") throw gatewayError(423, "TENANT_SUSPENDED", "当前租户已暂停使用");
  if (policy.status === "archived") throw gatewayError(423, "TENANT_ARCHIVED", "当前租户已归档");
}

function assertTenantReadable(policy: TenantPolicy): void {
  if (policy.status === "suspended") throw gatewayError(423, "TENANT_SUSPENDED", "当前租户已暂停使用");
}

function assertTenantPolicyAccess(identity: JwtIdentity, action: "read" | "write"): void {
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims)) return;
  if (!hasNamedPermission(identity.claims, [`tenant.policy.${action}`])) throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有租户策略权限");
}

function assertTenantAuditAccess(identity: JwtIdentity): void {
  if (!isGlobalAdmin(identity.claims) && !isAdmin(identity.claims) && !hasNamedPermission(identity.claims, ["tenant.audit.read"])) {
    throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有租户审计权限");
  }
}

function assertTenantUsageAccess(identity: JwtIdentity): void {
  if (!isGlobalAdmin(identity.claims) && !isAdmin(identity.claims) && !hasNamedPermission(identity.claims, ["tenant.usage.write", "tenant.policy.write"])) {
    throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有租户用量写入权限");
  }
}

function creditKey(tenantId: string, subject: string): string {
  return `${tenantId}::${subject}`;
}

function walletAccountKey(tenantId: string, walletId: string): string {
  return `${tenantId}::wallet:${walletId}`;
}

function walletMemberKey(tenantId: string, walletId: string, subject: string): string {
  return `${tenantId}::${walletId}::${subject}`;
}

function normalizeWalletId(value: unknown): string {
  const walletId = normalizeSubject(value);
  if (!walletId) throw gatewayError(400, "INVALID_WALLET_ID", "钱包标识无效");
  if (walletId.length > 120) throw gatewayError(400, "INVALID_WALLET_ID", "钱包标识长度不能超过 120");
  return walletId;
}

function normalizeWalletName(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, 120) : "";
  if (!name) throw gatewayError(400, "INVALID_WALLET_NAME", "钱包名称不能为空");
  return name;
}

function normalizeWalletStatus(value: unknown): CreditWalletStatus {
  if (value === "active" || value === "suspended" || value === "archived") return value;
  throw gatewayError(400, "INVALID_WALLET_STATUS", "钱包状态必须是 active、suspended 或 archived");
}

function normalizeWalletRole(value: unknown): CreditWalletMemberRole {
  if (value === "owner" || value === "spender" || value === "viewer") return value;
  throw gatewayError(400, "INVALID_WALLET_ROLE", "钱包成员角色必须是 owner、spender 或 viewer");
}

function findWallet(state: ResourceStore, tenantId: string, walletId: string): CreditWallet | undefined {
  const wallet = state.creditWallets[walletAccountKey(tenantId, walletId)];
  return wallet && wallet.tenantId === tenantId ? wallet : undefined;
}

function listWalletMembers(state: ResourceStore, tenantId: string, walletId: string): CreditWalletMember[] {
  return Object.values(state.creditWalletMembers).filter((entry) => entry.tenantId === tenantId && entry.walletId === walletId);
}

function walletMember(state: ResourceStore, tenantId: string, walletId: string, subject: string): CreditWalletMember | undefined {
  return state.creditWalletMembers[walletMemberKey(tenantId, walletId, subject)];
}

function validateImportedWalletAttribution(state: ResourceStore, tenantId: string, walletId: string | undefined, subject: string, actorSubject: string | undefined, newApiRequestId?: string): void {
  if (newApiRequestId && state.creditLedger.some((entry) => entry.tenantId === tenantId && entry.type === "consume" && entry.newApiRequestId === newApiRequestId)) return;
  if (!walletId) {
    if (actorSubject !== undefined && actorSubject !== subject) throw gatewayError(409, "COST_IMPORT_ACTOR_MISMATCH", "个人账户成本记录的发起成员归属不一致");
    return;
  }
  if (actorSubject !== undefined && actorSubject !== subject) throw gatewayError(409, "COST_IMPORT_ACTOR_MISMATCH", "共享钱包成本记录的 subject 与发起成员归属不一致");
  if (!walletMember(state, tenantId, walletId, subject)) throw gatewayError(403, "COST_IMPORT_WALLET_MEMBER_REQUIRED", "共享钱包成本记录必须归属于该钱包成员");
}

function accountForWallet(state: ResourceStore, tenantId: string, walletId: string): CreditAccount {
  const key = walletAccountKey(tenantId, walletId);
  const account = state.creditAccounts[key];
  if (account) return account;
  return { tenantId, subject: `wallet:${walletId}`, walletId, plan: "team-wallet", balance: 0, reserved: 0, lifetimeGranted: 0, lifetimeConsumed: 0, lifetimeRefunded: 0, lifetimeExpired: 0, updatedAt: new Date(0).toISOString(), version: 1 };
}

function assertWalletAccess(state: ResourceStore, identity: JwtIdentity, walletId: string, role: CreditWalletMemberRole | "admin"): { wallet: CreditWallet; role: CreditWalletMemberRole } {
  const wallet = findWallet(state, identity.tenantId, walletId);
  if (!wallet) throw gatewayError(404, "WALLET_NOT_FOUND", "共享钱包不存在");
  if (role === "admin") {
    if (!isGlobalAdmin(identity.claims) && !isAdmin(identity.claims)) throw gatewayError(403, "WALLET_PERMISSION_DENIED", "当前主体没有共享钱包管理权限");
    return { wallet, role: "owner" };
  }
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims)) return { wallet, role: "owner" };
  const member = walletMember(state, identity.tenantId, walletId, identity.subject);
  if (!member) throw gatewayError(403, "WALLET_NOT_A_MEMBER", "当前主体不是该共享钱包的成员");
  const hierarchy: Record<CreditWalletMemberRole, number> = { viewer: 1, spender: 2, owner: 3 };
  if (hierarchy[member.role] < hierarchy[role]) throw gatewayError(403, "WALLET_ROLE_INSUFFICIENT", `当前钱包成员角色（${member.role}）无法执行此操作`);
  if (wallet.status !== "active" && member.role !== "owner") throw gatewayError(423, "WALLET_INACTIVE", "共享钱包当前不可用");
  return { wallet, role: member.role };
}

function resolveWalletTarget(state: ResourceStore, identity: JwtIdentity, requestedWalletId: unknown, operation: "read" | "spend" | "admin"): { wallet: CreditWallet; accountKey: string; actorSubject: string; role: CreditWalletMemberRole } {
  const walletId = typeof requestedWalletId === "string" && requestedWalletId.trim() ? normalizeWalletId(requestedWalletId) : "";
  if (!walletId) {
    const accountKey = creditKey(identity.tenantId, identity.subject);
    return { wallet: undefined as unknown as CreditWallet, accountKey, actorSubject: identity.subject, role: "owner" };
  }
  const requiredRole = operation === "read" ? "viewer" : operation === "spend" ? "spender" : "owner";
  const access = assertWalletAccess(state, identity, walletId, requiredRole);
  if (access.wallet.status === "archived") throw gatewayError(423, "WALLET_ARCHIVED", "共享钱包已归档");
  if (access.wallet.status === "suspended" && operation !== "read") throw gatewayError(423, "WALLET_SUSPENDED", "共享钱包已暂停");
  return { wallet: access.wallet, accountKey: walletAccountKey(identity.tenantId, walletId), actorSubject: identity.subject, role: access.role };
}

function normalizedCreditSubject(value: unknown, fallback: string): string {
  const subject = normalizeSubject(value);
  return subject || fallback;
}

function assertCreditRead(identity: JwtIdentity, subject: string): void {
  if (subject === identity.subject) return;
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.read", "tenant.billing.read"])) return;
  throw gatewayError(403, "CREDIT_PERMISSION_DENIED", "当前主体没有查看其他成员积分的权限");
}

function assertCreditAdmin(identity: JwtIdentity): void {
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.write", "tenant.billing.write"])) return;
  throw gatewayError(403, "CREDIT_PERMISSION_DENIED", "当前主体没有积分管理权限");
}

function assertReconciliationRead(identity: JwtIdentity): void {
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.read", "tenant.billing.read", "billing.write", "tenant.billing.write"])) return;
  throw gatewayError(403, "RECONCILIATION_PERMISSION_DENIED", "当前主体没有成本对账读取权限");
}

function assertReconciliationImport(identity: JwtIdentity): void {
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.reconciliation.write", "tenant.billing.reconciliation.write", "billing.write", "tenant.billing.write"])) return;
  throw gatewayError(403, "RECONCILIATION_IMPORT_PERMISSION_DENIED", "当前主体没有成本对账导入权限");
}

function assertBillingCatalogAdmin(identity: JwtIdentity): void {
  if (isGlobalAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.catalog.write", "tenant.billing.catalog.write"])) return;
  throw gatewayError(403, "BILLING_CATALOG_PERMISSION_DENIED", "当前主体没有套餐目录管理权限");
}

function assertBillingSubscriptionRead(identity: JwtIdentity): void {
  if (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || hasNamedPermission(identity.claims, ["billing.read", "tenant.billing.read"])) return;
  throw gatewayError(403, "BILLING_SUBSCRIPTION_PERMISSION_DENIED", "当前主体没有查看租户订阅的权限");
}

function accountFor(state: ResourceStore, tenantId: string, subject: string): CreditAccount {
  const key = creditKey(tenantId, subject);
  return state.creditAccounts[key] ?? { tenantId, subject, plan: "free", balance: 0, reserved: 0, lifetimeGranted: 0, lifetimeConsumed: 0, lifetimeRefunded: 0, lifetimeExpired: 0, updatedAt: new Date(0).toISOString(), version: 1 };
}

function pricingFor(state: ResourceStore, tenantId: string, model: string): CreditPricing {
  return state.creditPricing[creditKey(tenantId, model)] ?? state.creditPricing[creditKey(tenantId, "*")] ?? DEFAULT_CREDIT_PRICING;
}

function creditAmount(value: unknown, field: string, maximum = 1_000_000_000): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > maximum) throw gatewayError(400, "INVALID_CREDIT_AMOUNT", `${field} 必须是合法的非负整数`);
  return amount;
}

function creditIdempotency(value: unknown): string {
  const key = typeof value === "string" ? value.trim().slice(0, 160) : "";
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(key)) throw gatewayError(400, "INVALID_CREDIT_IDEMPOTENCY_KEY", "积分操作需要 8-160 位幂等键");
  return key;
}

function creditCostForPricing(pricing: CreditPricing, promptTokens: number, completionTokens: number): number {
  const input = Math.ceil(promptTokens * pricing.inputPointsPerThousand / 1000);
  const output = Math.ceil(completionTokens * pricing.outputPointsPerThousand / 1000);
  return Math.max(pricing.minimumPoints, input + output);
}

function providerCostForPricing(pricing: CreditPricing, promptTokens: number, completionTokens: number): number | undefined {
  if (pricing.inputCostPerMillion === undefined || pricing.outputCostPerMillion === undefined) return undefined;
  return Number(((promptTokens * pricing.inputCostPerMillion + completionTokens * pricing.outputCostPerMillion) / 1_000_000).toFixed(9));
}

function estimatedCreditCost(state: ResourceStore, tenantId: string, model: string, promptTokens: number, completionTokens: number): number {
  return creditCostForPricing(pricingFor(state, tenantId, model), promptTokens, completionTokens);
}

function creditQuote(state: ResourceStore, tenantId: string, input: CreditQuoteInput): Record<string, unknown> {
  const model = normalizeSubject(input.model);
  if (!model || model.length > 200) throw gatewayError(400, "INVALID_CREDIT_MODEL", "计费模型标识无效");
  const promptTokens = creditAmount(input.promptTokens ?? 0, "promptTokens", 10_000_000);
  const completionTokens = creditAmount(input.completionTokens ?? 0, "completionTokens", 10_000_000);
  const pricing = pricingFor(state, tenantId, model);
  const estimatedProviderCost = providerCostForPricing(pricing, promptTokens, completionTokens);
  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedPoints: estimatedCreditCost(state, tenantId, model, promptTokens, completionTokens),
    unit: "points",
    priceBasis: "gateway-pricing",
    pricing: { ...pricing },
    ...(estimatedProviderCost === undefined ? {} : { estimatedProviderCost, costCurrency: pricing.costCurrency ?? "USD", costBasis: pricing.costSource ?? "configured-pricing" }),
    quoteValidUntil: new Date(Date.now() + 60_000).toISOString(),
  };
}

function findLedgerByKey(state: ResourceStore, tenantId: string, subject: string, idempotencyKey: string): CreditLedgerEntry | undefined {
  return [...state.creditLedger].reverse().find((entry) => entry.tenantId === tenantId && entry.subject === subject && entry.idempotencyKey === idempotencyKey);
}

function casdoorWebhookSubject(value: unknown): string {
  if (typeof value === "string") {
    const normalized = normalizeSubject(value);
    if (normalized.startsWith("{") && normalized.endsWith("}")) {
      try { return casdoorWebhookSubject(JSON.parse(normalized)); } catch { return normalized; }
    }
    return normalized;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const item = value as Record<string, unknown>;
  for (const field of ["subject", "name", "username", "user", "id"]) {
    const subject = normalizeSubject(item[field]);
    if (subject) return subject.includes("/") ? subject.slice(subject.lastIndexOf("/") + 1) : subject;
  }
  return "";
}

function casdoorWebhookAction(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/^\/api\//, "").replace(/_/g, "-") : "";
}

function welcomeIdempotencyKey(organization: string, subject: string): string {
  return `casdoor-welcome:${createHash("sha256").update(`${organization}\0${subject}`).digest("hex")}`;
}

function casdoorWelcomeSubject(raw: { type?: unknown; action?: unknown; organization?: unknown; user?: unknown; target?: unknown; object?: unknown }): string {
  const action = casdoorWebhookAction(raw.action);
  const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : (["add", "create", "add-user", "create-user", "user/add", "user/create"].includes(action) ? "user" : "");
  const subject = casdoorWebhookSubject(raw.user) || casdoorWebhookSubject(raw.target) || casdoorWebhookSubject(raw.object);
  if (!subject) return "";
  if (type === "user" && ["add", "create", "add-user", "create-user", "user/add", "user/create"].includes(action)) return subject;
  if (type === "organization" && ["add-user", "add-member", "member-add", "user-add", "organization/add-user"].includes(action)) return subject;
  return "";
}

async function issueWelcomeCredit(tenantId: string, subject: string, idempotencyKey: string): Promise<{ account: CreditAccount; entry: CreditLedgerEntry; created: boolean }> {
  return serialized(async () => {
    const next = await getStore();
    const plan = billingPlans(next).free;
    if (!plan || !plan.active || plan.priceMinor !== 0 || plan.points < 1) throw gatewayError(409, "FREE_PLAN_UNAVAILABLE", "Free 体验套餐当前不可用");
    const existing = findLedgerByKey(next, tenantId, subject, idempotencyKey);
    if (existing) {
      if (existing.createdBy !== "free-welcome-orchestrator") throw gatewayError(409, "CREDIT_IDEMPOTENCY_CONFLICT", "幂等键已用于其他积分发放操作");
      assertCreditReplayMatches(existing, { type: "grant", amount: plan.points });
      return { account: accountFor(next, tenantId, subject), entry: existing, created: false };
    }
    const priorWelcome = next.creditLedger.find((entry) => entry.tenantId === tenantId && entry.subject === subject && entry.type === "grant" && entry.createdBy === "free-welcome-orchestrator");
    if (priorWelcome) throw gatewayError(409, "WELCOME_CREDIT_ALREADY_ISSUED", "该主体的 Free 体验额度已经发放");
    const previous = accountFor(next, tenantId, subject);
    const expiresAt = plan.pointsValidDays === undefined ? undefined : new Date(Date.now() + plan.pointsValidDays * 86_400_000).toISOString();
    const account: CreditAccount = { ...previous, plan: plan.id, balance: previous.balance + plan.points, lifetimeGranted: previous.lifetimeGranted + plan.points, updatedAt: new Date().toISOString(), version: previous.version + 1 };
    const entry = creditEntry({ tenantId, subject, type: "grant", amount: plan.points, idempotencyKey, ...(expiresAt ? { expiresAt } : {}), reason: "Free 体验额度", createdBy: "free-welcome-orchestrator" });
    next.creditAccounts[creditKey(tenantId, subject)] = account;
    appendCreditLedgerEntry(next, entry);
    await saveStore(next);
    return { account, entry, created: true };
  });
}

function assertCreditReplayMatches(existing: CreditLedgerEntry, expected: { type: CreditLedgerEntryType; amount?: number; model?: string; promptTokens?: number; completionTokens?: number }): void {
  if (existing.type !== expected.type || (expected.amount !== undefined && existing.amount !== expected.amount) || (expected.model !== undefined && existing.model !== expected.model) || (expected.promptTokens !== undefined && existing.promptTokens !== expected.promptTokens) || (expected.completionTokens !== undefined && existing.completionTokens !== expected.completionTokens)) {
    throw gatewayError(409, "CREDIT_IDEMPOTENCY_CONFLICT", "积分幂等键已用于不同的业务参数");
  }
}

function creditEntry(input: Omit<CreditLedgerEntry, "id" | "createdAt" | "unit">): CreditLedgerEntry {
  return { ...input, id: randomUUID(), unit: "points", createdAt: new Date().toISOString() };
}

function appendCreditLedgerEntry(state: ResourceStore, entry: CreditLedgerEntry): CreditLedgerEntry {
  const currentIntegrity = creditLedgerIntegrity(state);
  if (currentIntegrity.status === "invalid") throw gatewayError(500, "CREDIT_LEDGER_INTEGRITY_FAILED", "积分账本完整性校验失败，已拒绝写入");
  if (currentIntegrity.status === "backfillable") creditLedgerIntegrity(state, true);
  const previousHash = state.creditLedger.at(-1)?.entryHash ?? state.creditLedgerAnchorHash ?? "";
  entry.previousHash = previousHash;
  entry.entryHash = creditLedgerEntryHash(entry, previousHash);
  state.creditLedger.push(entry);
  trimCreditLedger(state);
  return entry;
}

function billingPlans(state: ResourceStore): Record<string, BillingPlan> {
  return { ...Object.fromEntries(DEFAULT_BILLING_PLANS.map((plan) => [plan.id, plan])), ...state.billingPlans };
}

function commercialMarginFor(state: ResourceStore, pricing: CreditPricing): { grossMarginPercent?: number; marginCurrency?: string; revenuePerPoint?: number; reason?: string } {
  if (pricing.inputCostPerMillion === undefined || pricing.outputCostPerMillion === undefined) return { reason: "缺少供应商成本基线" };
  const costCurrency = pricing.costCurrency;
  if (!costCurrency) return { reason: "缺少供应商成本币种" };
  const paidPlans = Object.values(billingPlans(state)).filter((plan) => plan.active && plan.priceMinor > 0 && plan.points > 0 && plan.currency === costCurrency);
  if (!paidPlans.length) return { reason: `缺少 ${costCurrency} 同币种付费套餐基线` };
  const revenuePerPoint = Math.min(...paidPlans.map((plan) => (plan.priceMinor / 100) / plan.points));
  const componentMargins = [
    { label: "输入", pointsPerThousand: pricing.inputPointsPerThousand, costPerMillion: pricing.inputCostPerMillion },
    { label: "输出", pointsPerThousand: pricing.outputPointsPerThousand, costPerMillion: pricing.outputCostPerMillion },
  ].map((component) => {
    const revenue = component.pointsPerThousand * 1_000 * revenuePerPoint;
    if (component.costPerMillion === 0) return 100;
    if (revenue <= 0) return -100;
    return ((revenue - component.costPerMillion) / revenue) * 100;
  });
  const grossMarginPercent = Number(Math.min(...componentMargins).toFixed(4));
  return { grossMarginPercent, marginCurrency: costCurrency, revenuePerPoint: Number(revenuePerPoint.toFixed(8)), ...(grossMarginPercent < targetGrossMarginPercent ? { reason: `预计毛利 ${grossMarginPercent}% 低于目标 ${targetGrossMarginPercent}%` } : {}) };
}

function commercialModelSellabilityReasons(state: ResourceStore, tenantId: string, group: string, model: string, protocol: NewApiProtocol = "chat.completions"): string[] {
  const reasons: string[] = [];
  const configured = Object.keys(newApiCapabilities).length > 0;
  const capabilities = newApiCapabilities[group]?.[model] ?? newApiCapabilities[group]?.["*"] ?? newApiCapabilities["*"]?.[model] ?? newApiCapabilities["*"]?.["*"] ?? {};
  const capability = capabilities[protocol];
  if (!configured) reasons.push("未配置经过验证的能力目录");
  if (configured && (!capability || capability.supported !== true)) reasons.push(`${protocol} 未通过能力验收`);
  if (configured && capability?.usage !== "required") reasons.push("真实 usage 未被要求");
  const pricing = pricingFor(state, tenantId, model);
  if (pricing.inputCostPerMillion === undefined || pricing.outputCostPerMillion === undefined) reasons.push("缺少供应商成本基线");
  const margin = commercialMarginFor(state, pricing);
  if (margin.reason) reasons.push(margin.reason);
  return reasons;
}

function assertCommercialModelSellable(state: ResourceStore, tenantId: string, group: string, model: string, protocol: NewApiProtocol = "chat.completions"): void {
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return;
  const reasons = commercialModelSellabilityReasons(state, tenantId, group, model, protocol);
  if (reasons.length) throw gatewayError(403, "COMMERCIAL_MODEL_NOT_SELLABLE", `当前模型未通过商业售卖门禁：${reasons.join("；")}`);
}

function validPointsExpiry(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function expireCreditLots(state: ResourceStore, tenantId: string, subject: string, now = Date.now()): number {
  const account = accountFor(state, tenantId, subject);
  const available = Math.max(0, account.balance - account.reserved);
  if (available <= 0) return 0;
  const entries = state.creditLedger.filter((entry) => entry.tenantId === tenantId && entry.subject === subject).sort((left, right) => ledgerTimestamp(left) - ledgerTimestamp(right) || left.id.localeCompare(right.id));
  const lots = entries.flatMap((entry) => {
    if (entry.type !== "purchase" && entry.type !== "grant" || entry.amount <= 0) return [];
    return [{ entry, remaining: entry.amount }];
  });
  const lotsById = new Map(lots.map((lot) => [lot.entry.id, lot]));
  for (const entry of entries) {
    if (entry.type === "consume") {
      let remaining = entry.amount;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const consumed = Math.min(lot.remaining, remaining);
        lot.remaining -= consumed;
        remaining -= consumed;
      }
    }
    if (entry.type === "expire" && entry.sourceLedgerId) {
      const lot = lotsById.get(entry.sourceLedgerId);
      if (lot) lot.remaining = Math.max(0, lot.remaining - entry.amount);
    }
    if (entry.type === "refund" && entry.orderId) {
      let remaining = entry.amount;
      for (const lot of lots) {
        if (remaining <= 0) break;
        if (lot.entry.orderId !== entry.orderId) continue;
        const removed = Math.min(lot.remaining, remaining);
        lot.remaining -= removed;
        remaining -= removed;
      }
    }
  }
  let expired = 0;
  for (const lot of lots) {
    if (expired >= available || !lot.entry.expiresAt || Date.parse(lot.entry.expiresAt) > now || lot.remaining <= 0) continue;
    const amount = Math.min(lot.remaining, available - expired);
    const key = `expire:${lot.entry.id}:${amount}`;
    appendCreditLedgerEntry(state, creditEntry({ tenantId, subject, ...(account.walletId ? { walletId: account.walletId } : {}), type: "expire", amount, idempotencyKey: key, sourceLedgerId: lot.entry.id, expiresAt: lot.entry.expiresAt, orderId: lot.entry.orderId, reason: "积分批次到期", createdBy: "credit-expiry-worker" }));
    expired += amount;
  }
  if (!expired) return 0;
  const updated = { ...account, balance: account.balance - expired, lifetimeExpired: account.lifetimeExpired + expired, updatedAt: new Date(now).toISOString(), version: account.version + 1 };
  state.creditAccounts[creditKey(tenantId, subject)] = updated;
  return expired;
}

function expireTenantCredits(state: ResourceStore, tenantId: string, subject?: string, now = Date.now()): number {
  const subjects = subject ? [subject] : [...new Set((Object.values(state.creditAccounts) as CreditAccount[]).filter((account) => account.tenantId === tenantId).map((account) => account.subject))];
  return subjects.reduce((total, currentSubject) => total + expireCreditLots(state, tenantId, currentSubject, now), 0);
}

function expireAllTenantCredits(state: ResourceStore, tenantId: string, now = Date.now()): { expired: number; accounts: number; wallets: number } {
  const targets = new Map<string, { subject?: string; walletId?: string }>();
  for (const account of Object.values(state.creditAccounts) as CreditAccount[]) {
    if (account.tenantId !== tenantId) continue;
    if (account.walletId) targets.set(`wallet:${account.walletId}`, { walletId: account.walletId });
    else targets.set(`subject:${account.subject}`, { subject: account.subject });
  }
  let expired = 0;
  let wallets = 0;
  for (const target of targets.values()) {
    if (target.walletId) {
      wallets += 1;
      expired += expireCreditLots(state, tenantId, `wallet:${target.walletId}`, now);
    } else {
      expired += expireCreditLots(state, tenantId, target.subject ?? "", now);
    }
  }
  return { expired, accounts: targets.size - wallets, wallets };
}

function refundablePurchasePoints(state: ResourceStore, order: BillingOrder): number {
  const entries = state.creditLedger
    .filter((entry) => entry.tenantId === order.tenantId && entry.subject === order.subject)
    .sort((left, right) => ledgerTimestamp(left) - ledgerTimestamp(right) || left.id.localeCompare(right.id));
  const lots = entries.flatMap((entry) => (entry.type === "purchase" || entry.type === "grant") && entry.amount > 0 ? [{ entry, remaining: entry.amount }] : []);
  const targetLots = lots.filter((lot) => lot.entry.type === "purchase" && lot.entry.orderId === order.orderNo);
  if (!targetLots.length) return 0;
  const lotsById = new Map(lots.map((lot) => [lot.entry.id, lot]));
  for (const entry of entries) {
    if (entry.type === "consume" && entry.amount > 0) {
      let remaining = entry.amount;
      for (const lot of lots) {
        if (remaining <= 0) break;
        if (lot.remaining <= 0) continue;
        const consumed = Math.min(lot.remaining, remaining);
        lot.remaining -= consumed;
        remaining -= consumed;
      }
    }
    if (entry.type === "expire" && entry.sourceLedgerId) {
      const lot = lotsById.get(entry.sourceLedgerId);
      if (lot) lot.remaining = Math.max(0, lot.remaining - entry.amount);
    }
    if (entry.type === "refund" && entry.orderId === order.orderNo && entry.amount > 0) {
      let remaining = entry.amount;
      for (const lot of targetLots) {
        if (remaining <= 0) break;
        const removed = Math.min(lot.remaining, remaining);
        lot.remaining -= removed;
        remaining -= removed;
      }
    }
  }
  return targetLots.reduce((total, lot) => total + lot.remaining, 0);
}

function billingSubscriptionView(subscription: BillingSubscription): Omit<BillingSubscription, "previousPolicy"> {
  const { previousPolicy: _previousPolicy, ...view } = subscription;
  return view;
}

function billingEntitlementsActive(order: BillingOrder, now = Date.now()): boolean {
  return order.status === "paid" && (!order.entitlementsExpiresAt || Date.parse(order.entitlementsExpiresAt) > now);
}

function expireBillingEntitlements(state: ResourceStore, tenantId: string, now = Date.now()): boolean {
  const subscription = state.billingSubscriptions[tenantId];
  if (!subscription || subscription.status !== "active" || !subscription.entitlementsExpiresAt || Date.parse(subscription.entitlementsExpiresAt) > now) return false;
  const endedAt = new Date(now).toISOString();
  const currentPolicy = tenantPolicy(state, tenantId);
  const replacement = (Object.values(state.billingOrders) as BillingOrder[])
    .filter((candidate) => candidate.tenantId === tenantId && candidate.orderNo !== subscription.orderNo && billingEntitlementsActive(candidate, now))
    .sort((left, right) => (Date.parse(right.paidAt ?? right.updatedAt) || 0) - (Date.parse(left.paidAt ?? left.updatedAt) || 0))[0];
  subscription.status = "cancelled";
  subscription.endedAt = endedAt;
  if (replacement) {
    const restoredPolicy = applyBillingEntitlements(currentPolicy, replacement.entitlements ?? {}, "billing-entitlement-expiry");
    state.tenantPolicies[tenantId] = restoredPolicy;
    state.billingSubscriptions[tenantId] = {
      tenantId,
      subject: replacement.subject,
      planId: replacement.planId,
      orderNo: replacement.orderNo,
      status: "active",
      entitlements: replacement.entitlements ?? {},
      startedAt: replacement.paidAt ?? replacement.updatedAt,
      ...(replacement.entitlementsExpiresAt ? { entitlementsExpiresAt: replacement.entitlementsExpiresAt } : {}),
      appliedPolicyVersion: restoredPolicy.version,
      ...(subscription.previousPolicy ? { previousPolicy: subscription.previousPolicy } : {}),
    };
  } else if (subscription.previousPolicy) {
    state.tenantPolicies[tenantId] = { ...subscription.previousPolicy, version: currentPolicy.version + 1, updatedAt: endedAt, updatedBy: "billing-entitlement-expiry" };
  } else {
    state.tenantPolicies[tenantId] = applyBillingEntitlements(currentPolicy, {}, "billing-entitlement-expiry");
  }
  return true;
}

function previousPaidBillingOrder(state: ResourceStore, tenantId: string, excludedOrderNo: string, now = Date.now()): BillingOrder | undefined {
  return (Object.values(state.billingOrders) as BillingOrder[])
    .filter((candidate) => candidate.tenantId === tenantId && candidate.orderNo !== excludedOrderNo && billingEntitlementsActive(candidate, now))
    .sort((left, right) => (right.paidAt ?? right.updatedAt).localeCompare(left.paidAt ?? left.updatedAt))[0];
}

function applyBillingEntitlements(previous: TenantPolicy, entitlements: BillingEntitlements, updatedBy: string): TenantPolicy {
  const policy: TenantPolicy = { ...previous, version: previous.version + 1, updatedAt: new Date().toISOString(), updatedBy };
  if (entitlements.maxTokensPerDay === undefined) delete policy.maxTokensPerDay;
  else policy.maxTokensPerDay = entitlements.maxTokensPerDay;
  if (entitlements.maxPointsPerDay === undefined) delete policy.maxPointsPerDay;
  else policy.maxPointsPerDay = entitlements.maxPointsPerDay;
  if (entitlements.modelAllowlist === undefined) delete policy.modelAllowlist;
  else policy.modelAllowlist = [...entitlements.modelAllowlist];
  if (entitlements.mcpAllowlist === undefined) delete policy.mcpAllowlist;
  else policy.mcpAllowlist = [...entitlements.mcpAllowlist];
  if (entitlements.newApiGroup === undefined) delete policy.newApiGroup;
  else policy.newApiGroup = entitlements.newApiGroup;
  return policy;
}

function normalizeBillingPlanId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().slice(0, 80) : "";
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) throw gatewayError(400, "INVALID_BILLING_PLAN", "套餐标识无效");
  return id;
}

function normalizeCurrency(value: unknown, fallback = "CNY"): string {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : fallback;
  if (!/^[A-Z]{3}$/.test(currency)) throw gatewayError(400, "INVALID_CURRENCY", "币种必须是 ISO 4217 三位大写字母");
  return currency;
}

function normalizeBillingOrderNo(value: unknown): string {
  const orderNo = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(orderNo)) throw gatewayError(400, "INVALID_ORDER_NO", "订单号无效");
  return orderNo;
}

function normalizePaymentValue(value: unknown, field: string, maximum = 200): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, maximum) : "";
  if (!normalized) throw gatewayError(400, `INVALID_${field.toUpperCase()}`, `${field} 无效`);
  return normalized;
}

function billingOrderByIdempotency(state: ResourceStore, tenantId: string, subject: string, idempotencyKey: string): BillingOrder | undefined {
  return (Object.values(state.billingOrders) as BillingOrder[]).find((order) => order.tenantId === tenantId && order.subject === subject && order.idempotencyKey === idempotencyKey);
}

function billingOrderFor(state: ResourceStore, orderNo: string): BillingOrder {
  const order = state.billingOrders[orderNo];
  if (!order) throw gatewayError(404, "BILLING_ORDER_NOT_FOUND", "订单不存在");
  return order;
}

function findBillingOrderByPayment(state: ResourceStore, paymentId: string, paymentChannel?: string, excludeOrderNo?: string): BillingOrder | undefined {
  return (Object.values(state.billingOrders) as BillingOrder[]).find((order) => order.orderNo !== excludeOrderNo && order.paymentId === paymentId && order.paymentChannel === paymentChannel);
}

function expirePendingBillingOrders(state: ResourceStore, now = Date.now()): BillingOrder[] {
  const expired: BillingOrder[] = [];
  for (const [orderNo, order] of Object.entries(state.billingOrders)) {
    if (order.status !== "pending" || new Date(order.expiresAt).getTime() > now) continue;
    const updated: BillingOrder = { ...order, status: "expired", updatedAt: new Date(now).toISOString() };
    state.billingOrders[orderNo] = updated;
    expired.push(updated);
  }
  return expired;
}

function billingStatus(value: unknown): BillingOrderStatus {
  if (typeof value !== "string" || !BILLING_ORDER_STATUSES.includes(value as BillingOrderStatus)) throw gatewayError(400, "INVALID_BILLING_STATUS", "订单状态无效");
  return value as BillingOrderStatus;
}

function billingSignature(raw: string, provided: string, secret: string): boolean {
  const normalized = provided.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

function creditExpirySignature(raw: string, timestamp: string, provided: string, secret: string): boolean {
  const normalized = provided.trim().replace(/^sha256=/i, "");
  if (!/^\d{10,16}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

function creditExpiryTimestampMs(value: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return Number.NaN;
  return value.length >= 13 ? numeric : numeric * 1000;
}

function creditExpiryRunId(req: IncomingMessage): string {
  const value = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  const runId = Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value;
  if (!runId || !/^[a-zA-Z0-9_.:-]{8,160}$/.test(runId.trim())) throw gatewayError(400, "INVALID_CREDIT_EXPIRY_REQUEST_ID", "内部积分过期任务需要有效的 Idempotency-Key");
  return runId.trim();
}

function normalizeCreditExpiryTenants(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw gatewayError(400, "INVALID_CREDIT_EXPIRY_TENANTS", "内部积分过期任务必须提供 1-500 个租户");
  const tenantIds = [...new Set(value.filter((tenantId): tenantId is string => typeof tenantId === "string").map((tenantId) => tenantId.trim()))];
  if (tenantIds.length !== value.length || tenantIds.some((tenantId) => !/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId))) throw gatewayError(400, "INVALID_CREDIT_EXPIRY_TENANTS", "内部积分过期任务包含无效或重复租户");
  return tenantIds.sort();
}

async function handleInternalCreditExpiry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!creditExpirySecret) throw gatewayError(503, "CREDIT_EXPIRY_WORKER_DISABLED", "内部积分过期任务未配置密钥");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "内部积分过期任务只接受 POST");
  const rawTimestamp = typeof req.headers["x-openbuddy-credit-expiry-timestamp"] === "string" ? req.headers["x-openbuddy-credit-expiry-timestamp"].trim() : "";
  const signature = typeof req.headers["x-openbuddy-credit-expiry-signature"] === "string" ? req.headers["x-openbuddy-credit-expiry-signature"] : "";
  const timestampMs = creditExpiryTimestampMs(rawTimestamp);
  const maxAgeMs = boundedNumber(process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_MAX_SKEW_SECONDS, 300, 30, 900) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maxAgeMs) throw gatewayError(401, "CREDIT_EXPIRY_TIMESTAMP_INVALID", "内部积分过期任务时间戳无效或已过期");
  const { raw, value } = await bodyWithRaw(req);
  if (!creditExpirySignature(raw, rawTimestamp, signature, creditExpirySecret)) throw gatewayError(401, "CREDIT_EXPIRY_SIGNATURE_INVALID", "内部积分过期任务签名校验失败");
  const requestId = creditExpiryRunId(req);
  const tenantIds = normalizeCreditExpiryTenants((value as { tenantIds?: unknown })?.tenantIds);
  const result = await serialized(async () => {
    const next = await getStore();
    const existing = next.creditExpiryRuns[requestId];
    if (existing) {
      if (JSON.stringify(existing.tenantIds) !== JSON.stringify(tenantIds)) throw gatewayError(409, "CREDIT_EXPIRY_REQUEST_CONFLICT", "内部积分过期任务幂等键已绑定其他租户清单");
      return { ...existing, replay: true };
    }
    let expired = 0;
    let accounts = 0;
    let wallets = 0;
    let entitlementsExpired = false;
    for (const tenantId of tenantIds) {
      const summary = expireAllTenantCredits(next, tenantId);
      expired += summary.expired;
      accounts += summary.accounts;
      wallets += summary.wallets;
      entitlementsExpired = expireBillingEntitlements(next, tenantId) || entitlementsExpired;
    }
    const run: CreditExpiryRun = { requestId, tenantIds, expired, accounts, wallets, entitlementsExpired, createdAt: new Date().toISOString() };
    next.creditExpiryRuns[requestId] = run;
    await saveStore(next);
    return { ...run, replay: false };
  });
  for (const tenantId of tenantIds) {
    await audit({ requestId: randomUUID(), at: new Date().toISOString(), tenantId, resource: "credits/internal-expiry", action: "expire", outcome: "success", reason: `run=${requestId};expired=${result.expired}` });
  }
  success(res, result);
}

function internalCostImportSignature(raw: string, timestamp: string, provided: string, secret: string): boolean {
  const normalized = provided.trim().replace(/^sha256=/i, "");
  if (!/^\d{10,16}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

function internalCostImportTimestampMs(value: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return Number.NaN;
  return value.length >= 13 ? numeric : numeric * 1000;
}

async function handleInternalNewApiCostImport(req: IncomingMessage, res: ServerResponse, tenantId: string): Promise<void> {
  if (!newApiCostImportSecret) throw gatewayError(503, "COST_IMPORT_WORKER_DISABLED", "内部成本导入任务未配置 HMAC 密钥");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "内部成本导入任务只接受 POST");
  if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
  const rawTimestamp = typeof req.headers["x-openbuddy-new-api-cost-timestamp"] === "string" ? req.headers["x-openbuddy-new-api-cost-timestamp"].trim() : "";
  const signature = typeof req.headers["x-openbuddy-new-api-cost-signature"] === "string" ? req.headers["x-openbuddy-new-api-cost-signature"] : "";
  const timestampMs = internalCostImportTimestampMs(rawTimestamp);
  const maxAgeMs = boundedNumber(process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_MAX_SKEW_SECONDS, 300, 30, 900) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > maxAgeMs) throw gatewayError(401, "COST_IMPORT_TIMESTAMP_INVALID", "内部成本导入时间戳无效或已过期");
  const { raw, value } = await bodyWithRaw(req);
  if (!internalCostImportSignature(raw, rawTimestamp, signature, newApiCostImportSecret)) throw gatewayError(401, "COST_IMPORT_SIGNATURE_INVALID", "内部成本导入签名校验失败");
  const requestedTenantId = (value as { tenantId?: unknown })?.tenantId;
  const scopedTenantId = typeof requestedTenantId === "string" && requestedTenantId.trim() ? requestedTenantId.trim() : tenantId;
  if (scopedTenantId !== tenantId) throw gatewayError(403, "COST_IMPORT_TENANT_MISMATCH", "内部成本导入租户与路径不一致");
  const syntheticIdentity: JwtIdentity = {
    subject: "internal-cost-import-worker",
    claims: {
      sub: "internal-cost-import-worker",
      iss: issuer,
      aud: audience,
      permissions: ["billing.reconciliation.write", "tenant.billing.reconciliation.write"],
      organizations: [tenantId],
    },
    tenantId,
  };
  await handleNewApiCostImport(req, res, syntheticIdentity, true, { raw, value });
}

function requestIdempotency(req: IncomingMessage, fallback: string): string {
  const primary = req.headers["idempotency-key"];
  const legacy = req.headers["x-idempotency-key"];
  if (primary === undefined && legacy === undefined) return fallback;
  const normalize = (value: string | string[] | undefined): string | undefined => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
      if (value.length !== 1) throw gatewayError(400, "INVALID_AI_IDEMPOTENCY_KEY", "AI 幂等键必须只提供一次");
      return value[0]?.trim();
    }
    return value.trim();
  };
  const primaryKey = normalize(primary);
  const legacyKey = normalize(legacy);
  if (primaryKey !== undefined && legacyKey !== undefined && primaryKey !== legacyKey) {
    throw gatewayError(400, "INVALID_AI_IDEMPOTENCY_KEY", "AI 幂等键不能同时使用不同值");
  }
  const key = primaryKey ?? legacyKey ?? "";
  if (!/^[a-zA-Z0-9_.:-]{8,160}$/.test(key)) {
    throw gatewayError(400, "INVALID_AI_IDEMPOTENCY_KEY", "AI 幂等键必须为 8-160 位字母、数字或 . _ : -");
  }
  return key;
}

function estimateChatTokens(input: Record<string, unknown>): { promptTokens: number; completionTokens: number } {
  const serialized = JSON.stringify(input);
  const promptTokens = Math.max(1, Math.ceil(serialized.length / 3));
  const maxTokens = Number(input.max_tokens ?? input.max_completion_tokens ?? 1024);
  const completionTokens = Number.isSafeInteger(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 1_000_000) : 1024;
  return { promptTokens, completionTokens };
}

type UsageSource = "new-api" | "estimated";
type ParsedUsage = { promptTokens: number; completionTokens: number; upstreamCost?: number; usageSource: UsageSource };
type CreditRequestContext = { requestId?: string; newApiGroup?: string; agentId?: string; sessionId?: string; walletId?: string; actorSubject?: string };

function parseUsage(value: unknown): ParsedUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const hasPromptTokens = ["prompt_tokens", "promptTokens", "input_tokens", "inputTokens"].some((key) => Object.prototype.hasOwnProperty.call(usage, key));
  const hasCompletionTokens = ["completion_tokens", "completionTokens", "output_tokens", "outputTokens"].some((key) => Object.prototype.hasOwnProperty.call(usage, key));
  if (!hasPromptTokens || !hasCompletionTokens) return undefined;
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens);
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens);
  if (!Number.isSafeInteger(promptTokens) || !Number.isSafeInteger(completionTokens) || promptTokens < 0 || completionTokens < 0) return undefined;
  const cost = Number(usage.upstream_cost ?? usage.upstreamCost ?? usage.cost ?? usage.total_cost ?? usage.totalCost ?? usage.cost_usd);
  return Number.isFinite(cost) && cost >= 0 ? { promptTokens, completionTokens, upstreamCost: cost, usageSource: "new-api" } : { promptTokens, completionTokens, usageSource: "new-api" };
}

function parseInputUsage(value: unknown): ParsedUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const promptValue = usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens;
  const totalValue = usage.total_tokens ?? usage.totalTokens;
  const promptTokens = Number(promptValue);
  const totalTokens = Number(totalValue);
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 0 || !Number.isSafeInteger(totalTokens) || totalTokens < promptTokens) return undefined;
  const cost = Number(usage.upstream_cost ?? usage.upstreamCost ?? usage.cost ?? usage.total_cost ?? usage.totalCost ?? usage.cost_usd);
  const parsed = { promptTokens, completionTokens: totalTokens - promptTokens, usageSource: "new-api" as const };
  return Number.isFinite(cost) && cost >= 0 ? { ...parsed, upstreamCost: cost } : parsed;
}

function estimateJsonUsage(input: Record<string, unknown>, completionTokens = 0): { promptTokens: number; completionTokens: number } {
  return { promptTokens: Math.max(1, Math.ceil(JSON.stringify(input).length / 3)), completionTokens: Math.max(0, Math.min(completionTokens, 1_000_000)) };
}

function isNewApiProtocolUnsupported(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("unsupported relay mode") || normalized.includes("not implemented");
}

function respondNewApiProtocolUnsupported(res: ServerResponse): void {
  res.statusCode = 501;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { code: "NEW_API_PROTOCOL_UNSUPPORTED", message: "当前 New API 渠道不支持该协议" } }));
}

type AiReplayResponse = { status: number; headers: Record<string, string>; body: string };
type AiInFlightRequest = { fingerprint: string; promise: Promise<AiReplayResponse> };
const aiInFlight = new Map<string, AiInFlightRequest>();

type UpstreamRequestContext = { signal: AbortSignal; cleanup: () => void };

function createUpstreamRequestContext(req: IncomingMessage, res: ServerResponse): UpstreamRequestContext {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("New API request timed out")), requestTimeoutMs);
  const abortIfDisconnected = () => {
    if (!res.writableEnded) controller.abort(new Error("OpenBuddy client disconnected"));
  };
  const cleanup = () => {
    clearTimeout(timeout);
    req.off("aborted", abortIfDisconnected);
    res.off("close", abortIfDisconnected);
  };
  req.once("aborted", abortIfDisconnected);
  res.once("close", abortIfDisconnected);
  return { signal: controller.signal, cleanup };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function aiInFlightKey(identity: JwtIdentity, protocol: string, idempotencyKey: string): string {
  return normalizeAiRequestKey(`${identity.tenantId}:${identity.subject}:${protocol}:${idempotencyKey}`);
}

function aiRequestFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function sendAiReplay(res: ServerResponse, response: AiReplayResponse): void {
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.end(response.body);
}

function aiRequestNow(): string {
  return new Date().toISOString();
}

function aiRequestIsLive(record: AiRequestRecord): boolean {
  return Date.parse(record.expiresAt) > Date.now();
}

async function claimAiRequest(key: string, fingerprint: string, requestId: string): Promise<{ kind: "owner" | "wait" | "replay"; response?: AiReplayResponse }> {
  return serialized(async () => {
    const next = await getStore();
    const existing = next.aiRequests[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw gatewayError(409, "AI_IDEMPOTENCY_CONFLICT", "AI 幂等键已对应不同请求");
      if (existing.status === "completed" && existing.response && aiRequestIsLive(existing)) return { kind: "replay", response: existing.response };
      if (existing.status === "running" && aiRequestIsLive(existing)) return { kind: "wait" };
    }
    const now = aiRequestNow();
    const record: AiRequestRecord = { fingerprint, status: "running", createdAt: existing?.createdAt ?? now, updatedAt: now, expiresAt: new Date(Date.now() + aiRequestLeaseMs).toISOString(), ownerRequestId: requestId };
    const cutoff = Date.now();
    for (const [requestKey, item] of Object.entries(next.aiRequests)) {
      if (requestKey !== key && Date.parse(item.expiresAt) <= cutoff) delete next.aiRequests[requestKey];
    }
    next.aiRequests[key] = record;
    await saveStore(next);
    return { kind: "owner" };
  });
}

async function completeAiRequest(key: string, fingerprint: string, requestId: string, response: AiReplayResponse): Promise<"completed" | "not-storable" | "not-owner"> {
  if (Buffer.byteLength(response.body, "utf8") > aiReplayMaxBytes) return "not-storable";
  await serialized(async () => {
    const next = await getStore();
    const existing = next.aiRequests[key];
    if (!existing || existing.fingerprint !== fingerprint || existing.ownerRequestId !== requestId) return;
    const now = aiRequestNow();
    next.aiRequests[key] = { ...existing, status: "completed", response, updatedAt: now, expiresAt: new Date(Date.now() + aiRequestReplayTtlMs).toISOString() };
    await saveStore(next);
  });
  const current = await getStore();
  const completed = current.aiRequests[key];
  return completed?.status === "completed" && completed.fingerprint === fingerprint && completed.ownerRequestId === requestId ? "completed" : "not-owner";
}

async function releaseAiRequest(key: string, fingerprint: string, requestId: string): Promise<void> {
  await serialized(async () => {
    const next = await getStore();
    const existing = next.aiRequests[key];
    if (!existing || existing.fingerprint !== fingerprint || existing.ownerRequestId !== requestId) return;
    delete next.aiRequests[key];
    await saveStore(next);
  });
}

async function waitForAiRequest(key: string, fingerprint: string, requestId: string): Promise<{ kind: "owner" | "replay"; response?: AiReplayResponse }> {
  for (;;) {
    const current = await getStore();
    const existing = current.aiRequests[key];
    if (!existing) {
      const claimed = await claimAiRequest(key, fingerprint, requestId);
      if (claimed.kind === "wait") continue;
      return { kind: claimed.kind, response: claimed.response };
    }
    if (existing.fingerprint !== fingerprint) throw gatewayError(409, "AI_IDEMPOTENCY_CONFLICT", "AI 幂等键已对应不同请求");
    if (existing.status === "completed" && existing.response && aiRequestIsLive(existing)) return { kind: "replay", response: existing.response };
    if (!aiRequestIsLive(existing)) {
      const claimed = await claimAiRequest(key, fingerprint, requestId);
      if (claimed.kind === "wait") continue;
      return { kind: claimed.kind, response: claimed.response };
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

async function runAiSingleFlight(key: string, fingerprint: string, requestId: string, operation: () => Promise<AiReplayResponse>): Promise<AiReplayResponse> {
  const existing = aiInFlight.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw gatewayError(409, "AI_IDEMPOTENCY_CONFLICT", "AI 幂等键已对应不同请求");
    return existing.promise;
  }
  const promise = (async () => {
    const claim = await claimAiRequest(key, fingerprint, requestId);
    if (claim.kind === "replay" && claim.response) return claim.response;
    const ownership = claim.kind === "wait" ? await waitForAiRequest(key, fingerprint, requestId) : claim;
    if (ownership.kind === "replay" && ownership.response) return ownership.response;
    let response: AiReplayResponse;
    try {
      response = await operation();
    } catch (error) {
      await releaseAiRequest(key, fingerprint, requestId).catch(() => undefined);
      throw error;
    }
    let completion: "completed" | "not-storable" | "not-owner";
    try {
      completion = await completeAiRequest(key, fingerprint, requestId, response);
    } catch {
      throw gatewayError(503, "AI_REPLAY_PERSISTENCE_FAILED", "AI 请求已完成，但响应持久化失败，请稍后使用同一幂等键重试");
    }
    if (completion === "not-storable") await releaseAiRequest(key, fingerprint, requestId).catch(() => undefined);
    if (completion === "not-owner") throw gatewayError(503, "AI_REQUEST_OWNERSHIP_LOST", "AI 请求已由其他副本接管，请稍后使用同一幂等键重试");
    return response;
  })().finally(() => {
    if (aiInFlight.get(key)?.promise === promise) aiInFlight.delete(key);
  });
  aiInFlight.set(key, { fingerprint, promise });
  return promise;
}

async function reserveCreditInternal(identity: JwtIdentity, amount: number, model: string, promptTokens: number, completionTokens: number, idempotencyKey: string, context: CreditRequestContext = {}): Promise<CreditLedgerEntry> {
  return serialized(async () => {
    const next = await getStore();
    const target = resolveWalletTarget(next, identity, context.walletId, "spend");
    const accountSubject = target.wallet ? `wallet:${target.wallet.id}` : identity.subject;
    const expired = target.wallet
      ? expireCreditLots(next, identity.tenantId, `wallet:${target.wallet.id}`)
      : expireTenantCredits(next, identity.tenantId, identity.subject);
    const entitlementsExpired = expireBillingEntitlements(next, identity.tenantId);
    if (expired > 0 || entitlementsExpired) await saveStore(next);
    const reservationPromptTokens = amount === 0 ? Math.min(10_000_000_000, promptTokens * 3) : promptTokens;
    const pricingSnapshot = pricingFor(next, identity.tenantId, model);
    const estimated = Math.max(amount, creditCostForPricing(pricingSnapshot, reservationPromptTokens, completionTokens));
    const existing = findLedgerByKey(next, identity.tenantId, accountSubject, idempotencyKey);
    if (existing) {
      assertCreditReplayMatches(existing, { type: "reservation", ...(amount > 0 ? { amount: estimated } : {}), model, promptTokens, completionTokens });
      if (findLedgerByKey(next, identity.tenantId, accountSubject, `${idempotencyKey}:settled`)) throw gatewayError(409, "CREDIT_REQUEST_ALREADY_SETTLED", "该请求已结算，不能重复调用模型");
      return existing;
    }
    const policy = effectiveTenantPolicy(next, identity.tenantId);
    const previous = target.wallet ? accountForWallet(next, identity.tenantId, target.wallet.id) : accountFor(next, identity.tenantId, identity.subject);
    if (previous.balance - previous.reserved < estimated) throw gatewayError(402, "INSUFFICIENT_CREDITS", target.wallet ? "共享钱包积分余额不足" : "积分余额不足");
    reserveRuntimeUsage(next, identity.tenantId, policy, promptTokens + completionTokens, estimated);
    const account: CreditAccount = { ...previous, reserved: previous.reserved + estimated, ...(target.wallet ? { walletId: target.wallet.id } : {}), updatedAt: new Date().toISOString(), version: previous.version + 1 };
    const entry = creditEntry({ tenantId: identity.tenantId, subject: accountSubject, ...(target.wallet ? { walletId: target.wallet.id } : {}), type: "reservation", amount: estimated, idempotencyKey, model, promptTokens, completionTokens, pricingSnapshot, requestId: context.requestId, newApiGroup: context.newApiGroup, actorSubject: context.actorSubject, agentId: context.agentId, sessionId: context.sessionId });
    next.creditAccounts[target.accountKey] = account;
    appendCreditLedgerEntry(next, entry);
    await saveStore(next);
    return entry;
  });
}

async function settleCreditInternal(identity: JwtIdentity, reservationKey: string, usage: ParsedUsage, newApiRequestId?: string): Promise<void> {
  await serialized(async () => {
    const next = await getStore();
    const reservation = lookupReservationAcrossWallet(next, identity, reservationKey);
    if (!reservation || reservation.type !== "reservation") throw gatewayError(404, "CREDIT_RESERVATION_NOT_FOUND", "积分预扣记录不存在");
    const accountKey = reservation.walletId ? walletAccountKey(identity.tenantId, reservation.walletId) : creditKey(identity.tenantId, identity.subject);
    const settledKey = `${reservationKey}:settled`;
    if (findLedgerByKey(next, identity.tenantId, reservation.subject, settledKey)) return;
    validateSettlementRequestIdentity(next, identity, reservation, usage, newApiRequestId);
    const actual = creditCostForPricing(reservation.pricingSnapshot ?? pricingFor(next, identity.tenantId, reservation.model ?? "unknown"), usage.promptTokens, usage.completionTokens);
    const refund = Math.max(0, reservation.amount - actual);
    const policy = tenantPolicy(next, identity.tenantId);
    if (runtimePointsBudgetExceeded(next, identity.tenantId, policy, reservation.amount, actual)) {
      releaseCreditReservationState(next, identity, reservation, "真实用量超过租户每日积分预算");
      await saveStore(next);
      throw gatewayError(429, "POINTS_QUOTA_EXCEEDED", "真实用量超过当前租户今日积分预算，预扣已释放");
    }
    const previous = reservation.walletId ? accountForWallet(next, identity.tenantId, reservation.walletId) : accountFor(next, identity.tenantId, identity.subject);
    const availableOutsideReservation = previous.balance - Math.max(0, previous.reserved - reservation.amount);
    if (actual > availableOutsideReservation) throw gatewayError(402, "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE", "真实用量超过预扣且当前可用积分不足");
    next.creditAccounts[accountKey] = { ...previous, balance: previous.balance - actual, reserved: Math.max(0, previous.reserved - reservation.amount), lifetimeConsumed: previous.lifetimeConsumed + actual, updatedAt: new Date().toISOString(), version: previous.version + 1 };
    appendCreditLedgerEntry(next, creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: "consume", amount: actual, pointsSettled: actual, upstreamCost: usage.upstreamCost, usageSource: usage.usageSource, idempotencyKey: settledKey, model: reservation.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, pricingSnapshot: reservation.pricingSnapshot, newApiRequestId, requestId: reservation.requestId, newApiGroup: reservation.newApiGroup, actorSubject: reservation.actorSubject, agentId: reservation.agentId, sessionId: reservation.sessionId }));
    if (refund > 0) appendCreditLedgerEntry(next, creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: "refund", amount: refund, idempotencyKey: `${reservationKey}:refund`, model: reservation.model, pricingSnapshot: reservation.pricingSnapshot, actorSubject: reservation.actorSubject, agentId: reservation.agentId, sessionId: reservation.sessionId, reason: "预扣与实际用量差额" }));
    settleRuntimeUsage(next, identity.tenantId, (reservation.promptTokens ?? 0) + (reservation.completionTokens ?? 0), reservation.amount, usage.promptTokens + usage.completionTokens, actual);
    await saveStore(next);
  });
}

async function releaseCreditInternal(identity: JwtIdentity, reservationKey: string): Promise<void> {
  await serialized(async () => {
    const next = await getStore();
    const reservation = lookupReservationAcrossWallet(next, identity, reservationKey);
    if (!reservation || reservation.type !== "reservation") return;
    if (findLedgerByKey(next, identity.tenantId, reservation.subject, `${reservationKey}:settled`)) return;
    releaseCreditReservationState(next, identity, reservation, "上游请求失败或客户端取消");
    await saveStore(next);
  });
}

async function handleNewApiModels(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity): Promise<void> {
  const group = effectiveTenantPolicy(await currentTenantStore(identity.tenantId), identity.tenantId).newApiGroup ?? newApiGroup;
  const credential = newApiCredential(group);
  if (!newApiBaseUrl || !credential) throw gatewayError(503, "NEW_API_NOT_CONFIGURED", "网关未配置 New API 上游");
  if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", `${AI_MODELS_ROUTE} 只接受 GET`);
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  assertTenantActive(policy);
  if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
  const response = await fetch(`${newApiBaseUrl}/v1/models`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${credential}`,
      ...(policy.newApiGroup ?? newApiGroup ? { "new-api-group": policy.newApiGroup ?? newApiGroup } : {}),
      ...newApiAttributionHeaders(identity),
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    res.statusCode = response.status;
    res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
    res.end(text.slice(0, maxBodyBytes));
    return;
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) as Record<string, unknown>; }
  catch { throw gatewayError(502, "INVALID_NEW_API_MODELS", "New API 返回了无效的模型列表"); }
  if (Array.isArray(policy.modelAllowlist) && policy.modelAllowlist.length) {
    const allowlist = new Set(policy.modelAllowlist);
    payload = { ...payload, data: Array.isArray(payload.data) ? payload.data.filter((entry) => entry && typeof entry === "object" && allowlist.has(String((entry as Record<string, unknown>).id ?? ""))) : [] };
  }
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test" && Object.keys(newApiCapabilities).length > 0) {
    payload = { ...payload, data: Array.isArray(payload.data) ? payload.data.filter((entry) => entry && typeof entry === "object" && hasNewApiModelCapability(group, String((entry as Record<string, unknown>).id ?? ""))) : [] };
  }
  res.statusCode = response.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function handleCommercialModelCatalog(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity): Promise<void> {
  if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", `${AI_CATALOG_ROUTE} 只接受 GET`);
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  const group = policy.newApiGroup ?? newApiGroup;
  const credential = newApiCredential(group);
  if (!newApiBaseUrl || !credential) throw gatewayError(503, "NEW_API_NOT_CONFIGURED", "网关未配置 New API 上游");
  assertTenantActive(policy);
  if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
  const response = await fetch(`${newApiBaseUrl}/v1/models`, { headers: { accept: "application/json", authorization: `Bearer ${credential}`, ...(group ? { "new-api-group": group } : {}), ...newApiAttributionHeaders(identity) }, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await response.text();
  if (!response.ok) { res.statusCode = response.status; res.setHeader("content-type", response.headers.get("content-type") ?? "application/json"); res.end(text.slice(0, maxBodyBytes)); return; }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) as Record<string, unknown>; } catch { throw gatewayError(502, "INVALID_NEW_API_MODELS", "New API 返回了无效的模型列表"); }
  const allowlist = policy.modelAllowlist?.length ? new Set(policy.modelAllowlist) : undefined;
  const configured = Object.keys(newApiCapabilities).length > 0;
  const models: CommercialModelCatalogEntry[] = Array.isArray(payload.data) ? payload.data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const id = String((entry as Record<string, unknown>).id ?? "").trim();
    if (!id || (allowlist && !allowlist.has(id))) return [];
    const capabilities = newApiCapabilities[group]?.[id] ?? newApiCapabilities[group]?.["*"] ?? newApiCapabilities["*"]?.[id] ?? newApiCapabilities["*"]?.["*"] ?? {};
    const pricing = pricingFor(current, identity.tenantId, id);
    const reasons = commercialModelSellabilityReasons(current, identity.tenantId, group, id, "chat.completions");
    const margin = commercialMarginFor(current, pricing);
    return [{ id, sellable: reasons.length === 0, ...(reasons.length ? { reason: reasons.join("；") } : {}), capabilities, pricing, ...(margin.grossMarginPercent === undefined ? {} : { grossMarginPercent: margin.grossMarginPercent }), ...(margin.marginCurrency ? { marginCurrency: margin.marginCurrency } : {}), ...(margin.revenuePerPoint === undefined ? {} : { revenuePerPoint: margin.revenuePerPoint }) }];
  }) : [];
  success(res, { group, capabilitySource: configured ? "gateway-config" : "unconfigured", pricingSource: "gateway-pricing", generatedAt: new Date().toISOString(), models });
}

async function handleNewApiCapabilities(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity): Promise<void> {
  if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", "AI capabilities 只接受 GET");
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  const group = policy.newApiGroup ?? newApiGroup;
  const credential = newApiCredential(group);
  if (!newApiBaseUrl || !credential) throw gatewayError(503, "NEW_API_NOT_CONFIGURED", "网关未配置 New API 上游");
  assertTenantActive(policy);
  if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
  const response = await fetch(`${newApiBaseUrl}/v1/models`, { headers: { accept: "application/json", authorization: `Bearer ${credential}`, ...(group ? { "new-api-group": group } : {}), ...newApiAttributionHeaders(identity) }, signal: AbortSignal.timeout(requestTimeoutMs) });
  const text = await response.text();
  if (!response.ok) { res.statusCode = response.status; res.setHeader("content-type", response.headers.get("content-type") ?? "application/json"); res.end(text.slice(0, maxBodyBytes)); return; }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) as Record<string, unknown>; } catch { throw gatewayError(502, "INVALID_NEW_API_MODELS", "New API 返回了无效的模型列表"); }
  const allowlist = policy.modelAllowlist?.length ? new Set(policy.modelAllowlist) : undefined;
  const models = Array.isArray(payload.data) ? payload.data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = String(item.id ?? "");
    if (!id || (allowlist && !allowlist.has(id))) return [];
    if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test" && Object.keys(newApiCapabilities).length > 0 && !hasNewApiModelCapability(group, id)) return [];
    const configured = newApiCapabilities[group]?.[id] ?? newApiCapabilities[group]?.["*"] ?? newApiCapabilities["*"]?.[id] ?? newApiCapabilities["*"]?.["*"] ?? {};
    return [{ id, capabilities: configured }];
  }) : [];
  success(res, { group, capabilitySource: Object.keys(newApiCapabilities).length ? "gateway-config" : "unconfigured", models });
}

async function handleNewApiChat(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, requestId: string): Promise<void> {
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  const group = policy.newApiGroup ?? newApiGroup;
  const credential = newApiCredential(group);
  if (!newApiBaseUrl || !credential) throw gatewayError(503, "NEW_API_NOT_CONFIGURED", "网关未配置 New API 上游");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "AI Chat Completions 只接受 POST");
  const input = await body(req) as Record<string, unknown>;
  const model = normalizeSubject(input.model);
  if (!model || !input.messages || !Array.isArray(input.messages)) throw gatewayError(400, "INVALID_CHAT_REQUEST", "需要有效的 model 和 messages");
  assertTenantActive(policy);
  if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
  if (policy.modelAllowlist?.length && !policy.modelAllowlist.includes(model)) throw gatewayError(403, "MODEL_NOT_ALLOWED", "当前模型不在租户白名单");
  assertCommercialModelSellable(current, identity.tenantId, group, model);
  assertNewApiCapability(group, model, "chat.completions", input.stream === true);
  const estimated = estimateChatTokens(input);
  const reservationKey = requestIdempotency(req, requestId);
  const singleFlightKey = aiInFlightKey(identity, "chat.completions", reservationKey);
  const fingerprint = aiRequestFingerprint(input);
  const agentHeader = req.headers["x-openbuddy-agent"];
  const sessionHeader = req.headers["x-openbuddy-session"];
  const walletHeader = req.headers["x-openbuddy-wallet"];
  const agentId = normalizeSubject(Array.isArray(agentHeader) ? agentHeader[0] : agentHeader);
  const sessionId = normalizeSubject(Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader);
  const walletId = normalizeSubject(Array.isArray(walletHeader) ? walletHeader[0] : walletHeader);
  let streamedToClient = false;
  const replay = await runAiSingleFlight(singleFlightKey, fingerprint, requestId, async (): Promise<AiReplayResponse> => {
    const circuitPermit = acquireNewApiCircuit(group, model);
    let reservation: CreditLedgerEntry;
    try {
      reservation = await reserveCreditInternal(identity, 0, model, estimated.promptTokens, estimated.completionTokens, reservationKey, { requestId, ...(group ? { newApiGroup: group } : {}), ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), ...(walletId ? { walletId } : {}), ...(walletId ? { actorSubject: identity.subject } : {}) });
    } catch (error) {
      releaseNewApiCircuitPermit(circuitPermit);
      throw error;
    }
    const upstreamRequest = createUpstreamRequestContext(req, res);
    let completed = false;
    let upstreamResponseReceived = false;
    let streamingResponse = false;
    let circuitFinalized = false;
    let responseBodyParsed = false;
    const payload = { ...input, model, ...(input.stream === true ? { stream_options: { ...(input.stream_options && typeof input.stream_options === "object" ? input.stream_options : {}), include_usage: true } } : {}) };
    try {
      const response = await fetch(`${newApiBaseUrl}/v1/chat/completions`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${credential}`, ...(group ? { "new-api-group": group } : {}), ...newApiAttributionHeaders(identity, { requestId, ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), ...(walletId ? { walletId, actorSubject: identity.subject } : {}) }) }, body: JSON.stringify(payload), signal: upstreamRequest.signal });
      upstreamResponseReceived = true;
      if (!response.ok) {
        const text = await response.text();
        if (shouldCountNewApiFailure(response.status, text)) recordNewApiCircuitFailure(circuitPermit);
        else releaseNewApiCircuitPermit(circuitPermit);
        circuitFinalized = true;
        await releaseCreditInternal(identity, reservation.idempotencyKey!);
        return isNewApiProtocolUnsupported(text)
          ? { status: 501, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: { code: "NEW_API_PROTOCOL_UNSUPPORTED", message: "当前 New API 渠道不支持该协议" } }) }
          : { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" }, body: text.slice(0, maxBodyBytes) };
      }
      const isStream = input.stream === true || (response.headers.get("content-type") ?? "").includes("text/event-stream");
      streamingResponse = isStream;
      if (!isStream) {
        const result = await response.json() as Record<string, unknown>;
        responseBodyParsed = true;
        const parsedUsage = parseUsage(result.usage);
        if (!parsedUsage && !newApiAllowEstimatedUsage) {
          recordNewApiCircuitFailure(circuitPermit);
          await releaseCreditInternal(identity, reservation.idempotencyKey!);
          circuitFinalized = true;
          completed = true;
          return { status: 502, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: { code: "NEW_API_USAGE_REQUIRED", message: "New API 未返回真实 usage，已拒绝结算" } }) };
        }
        const usage = parsedUsage ?? { ...estimated, usageSource: "estimated" as const };
        await settleCreditInternal(identity, reservation.idempotencyKey!, usage, typeof result.id === "string" ? result.id : response.headers.get("x-request-id") ?? response.headers.get("x-oneapi-request-id") ?? undefined);
        recordNewApiCircuitSuccess(circuitPermit);
        circuitFinalized = true;
        completed = true;
        return { status: response.status, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(result) };
      }
      const chunks: string[] = [];
      const reader = response.body?.getReader();
      if (!reader) throw new Error("New API 未返回可读取的流");
      const capability = newApiCapability(group, model, "chat.completions");
      const streamDirectly = input.stream === true && capability?.streaming === true;
      const streamHeaders = {
        "content-type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      };
      if (streamDirectly) {
        res.statusCode = response.status;
        for (const [name, value] of Object.entries(streamHeaders)) res.setHeader(name, value);
        streamedToClient = true;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let usage: ParsedUsage = { ...estimated, usageSource: "estimated" };
      let upstreamRequestId = response.headers.get("x-request-id") ?? response.headers.get("x-oneapi-request-id") ?? undefined;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = decoder.decode(next.value, { stream: true });
        chunks.push(chunk);
        if (streamDirectly) {
          if (!res.write(chunk)) await once(res, "drain");
        }
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") continue;
          try {
            const event = JSON.parse(raw) as Record<string, unknown>;
            if (!upstreamRequestId && typeof event.id === "string" && event.id.trim()) upstreamRequestId = event.id.trim().slice(0, 200);
            usage = parseUsage(event.usage) ?? usage;
          } catch { /* partial SSE frame */ }
        }
      }
      if (buffer.startsWith("data:")) {
        const raw = buffer.slice(5).trim();
        if (raw !== "[DONE]") {
          try {
            const event = JSON.parse(raw) as Record<string, unknown>;
            if (!upstreamRequestId && typeof event.id === "string" && event.id.trim()) upstreamRequestId = event.id.trim().slice(0, 200);
            usage = parseUsage(event.usage) ?? usage;
          } catch { /* incomplete terminal frame */ }
        }
      }
      if (!newApiAllowEstimatedUsage && usage.usageSource === "estimated") {
        recordNewApiCircuitFailure(circuitPermit);
        await releaseCreditInternal(identity, reservation.idempotencyKey!);
        circuitFinalized = true;
        completed = true;
        if (streamDirectly) {
          res.destroy();
          throw gatewayError(502, "NEW_API_USAGE_REQUIRED", "New API 未返回真实 usage，已拒绝结算");
        }
        return { status: 502, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: { code: "NEW_API_USAGE_REQUIRED", message: "New API 未返回真实 usage，已拒绝结算" } }) };
      }
      await settleCreditInternal(identity, reservation.idempotencyKey!, usage, upstreamRequestId);
      recordNewApiCircuitSuccess(circuitPermit);
      circuitFinalized = true;
      completed = true;
      return { status: response.status, headers: streamHeaders, body: chunks.join("") };
    } catch (error) {
      if (!circuitFinalized) {
        if (isClientDisconnected(upstreamRequest.signal)) releaseNewApiCircuitPermit(circuitPermit);
        else if (!upstreamResponseReceived || streamingResponse) recordNewApiCircuitFailure(circuitPermit);
        else if (!responseBodyParsed) recordNewApiCircuitFailure(circuitPermit);
        else releaseNewApiCircuitPermit(circuitPermit);
      }
      if (!completed) await releaseCreditInternal(identity, reservation.idempotencyKey!).catch(() => undefined);
      throw error;
    } finally {
      upstreamRequest.cleanup();
    }
  });
  if (streamedToClient) {
    if (!res.writableEnded) res.end();
    return;
  }
  sendAiReplay(res, replay);
}

async function handleNewApiJsonApi(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, requestId: string, api: "completions" | "responses" | "embeddings" | "rerank" | "moderations"): Promise<void> {
  const current = await currentTenantStore(identity.tenantId);
  const policy = effectiveTenantPolicy(current, identity.tenantId);
  const group = policy.newApiGroup ?? newApiGroup;
  const credential = newApiCredential(group);
  if (!newApiBaseUrl || !credential) throw gatewayError(503, "NEW_API_NOT_CONFIGURED", "网关未配置 New API 上游");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", `${api} 只接受 POST`);
  const input = await body(req) as Record<string, unknown>;
  const model = normalizeSubject(input.model);
  if (!model) throw gatewayError(400, "INVALID_AI_REQUEST", "需要有效的 model");
  if ((api === "responses" || api === "completions" || api === "rerank" || api === "moderations") && input.stream === true) throw gatewayError(501, "AI_STREAM_UNSUPPORTED", `${api} 流式协议尚未接入积分结算，请先使用非流式请求`);
  if (api === "completions" && input.prompt === undefined) throw gatewayError(400, "INVALID_AI_REQUEST", "Completions 需要 prompt");
  if (api === "embeddings" && input.input === undefined) throw gatewayError(400, "INVALID_AI_REQUEST", "Embeddings 需要 input");
  if (api === "rerank" && (input.query === undefined || !Array.isArray(input.documents))) throw gatewayError(400, "INVALID_AI_REQUEST", "Rerank 需要 query 和 documents");
  if (api === "moderations" && input.input === undefined) throw gatewayError(400, "INVALID_AI_REQUEST", "Moderations 需要 input");
  assertTenantActive(policy);
  if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
  if (policy.modelAllowlist?.length && !policy.modelAllowlist.includes(model)) throw gatewayError(403, "MODEL_NOT_ALLOWED", "当前模型不在租户白名单");
  assertCommercialModelSellable(current, identity.tenantId, group, model, api);
  assertNewApiCapability(group, model, api, input.stream === true);
  const maxOutputTokens = api === "responses" ? Number(input.max_output_tokens ?? 1024) : api === "completions" ? Number(input.max_tokens ?? 1024) : 0;
  const estimated = estimateJsonUsage(input, Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 1024);
  if (api === "embeddings" || api === "rerank" || api === "moderations") estimated.completionTokens = 0;
  const reservationKey = requestIdempotency(req, requestId);
  const singleFlightKey = aiInFlightKey(identity, api, reservationKey);
  const fingerprint = aiRequestFingerprint(input);
  const agentHeader = req.headers["x-openbuddy-agent"];
  const sessionHeader = req.headers["x-openbuddy-session"];
  const walletHeader = req.headers["x-openbuddy-wallet"];
  const agentId = normalizeSubject(Array.isArray(agentHeader) ? agentHeader[0] : agentHeader);
  const sessionId = normalizeSubject(Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader);
  const walletId = normalizeSubject(Array.isArray(walletHeader) ? walletHeader[0] : walletHeader);
  const replay = await runAiSingleFlight(singleFlightKey, fingerprint, requestId, async (): Promise<AiReplayResponse> => {
    const circuitPermit = acquireNewApiCircuit(group, model);
    let reservation: CreditLedgerEntry;
    try {
      reservation = await reserveCreditInternal(identity, 0, model, estimated.promptTokens, estimated.completionTokens, reservationKey, { requestId, ...(group ? { newApiGroup: group } : {}), ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), ...(walletId ? { walletId } : {}), ...(walletId ? { actorSubject: identity.subject } : {}) });
    } catch (error) {
      releaseNewApiCircuitPermit(circuitPermit);
      throw error;
    }
    const upstreamRequest = createUpstreamRequestContext(req, res);
    let completed = false;
    let upstreamResponseReceived = false;
    let circuitFinalized = false;
    let responseBodyParsed = false;
    try {
      const response = await fetch(`${newApiBaseUrl}/v1/${api}`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${credential}`, ...(group ? { "new-api-group": group } : {}), ...newApiAttributionHeaders(identity, { requestId, ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), ...(walletId ? { walletId, actorSubject: identity.subject } : {}) }) }, body: JSON.stringify({ ...input, model }), signal: upstreamRequest.signal });
      upstreamResponseReceived = true;
      if (!response.ok) {
        const text = await response.text();
        if (shouldCountNewApiFailure(response.status, text)) recordNewApiCircuitFailure(circuitPermit);
        else releaseNewApiCircuitPermit(circuitPermit);
        circuitFinalized = true;
        await releaseCreditInternal(identity, reservation.idempotencyKey!);
        return isNewApiProtocolUnsupported(text)
          ? { status: 501, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: { code: "NEW_API_PROTOCOL_UNSUPPORTED", message: "当前 New API 渠道不支持该协议" } }) }
          : { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json" }, body: text.slice(0, maxBodyBytes) };
      }
      const result = await response.json() as Record<string, unknown>;
      responseBodyParsed = true;
      const usage = api === "embeddings" || api === "rerank" || api === "moderations" ? parseInputUsage(result.usage) : parseUsage(result.usage);
      if (!usage && !newApiAllowEstimatedUsage) {
        recordNewApiCircuitFailure(circuitPermit);
        await releaseCreditInternal(identity, reservation.idempotencyKey!);
        circuitFinalized = true;
        completed = true;
        return { status: 502, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: { code: "NEW_API_USAGE_REQUIRED", message: "New API 未返回真实 usage，已拒绝结算" } }) };
      }
      await settleCreditInternal(identity, reservation.idempotencyKey!, usage ?? { ...estimated, usageSource: "estimated" }, typeof result.id === "string" ? result.id : response.headers.get("x-request-id") ?? response.headers.get("x-oneapi-request-id") ?? undefined);
      recordNewApiCircuitSuccess(circuitPermit);
      circuitFinalized = true;
      completed = true;
      return { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8" }, body: JSON.stringify(result) };
    } catch (error) {
      if (!circuitFinalized) {
        if (isClientDisconnected(upstreamRequest.signal)) releaseNewApiCircuitPermit(circuitPermit);
        else if (!upstreamResponseReceived) recordNewApiCircuitFailure(circuitPermit);
        else if (!responseBodyParsed) recordNewApiCircuitFailure(circuitPermit);
        else releaseNewApiCircuitPermit(circuitPermit);
      }
      if (!completed) await releaseCreditInternal(identity, reservation.idempotencyKey!).catch(() => undefined);
      throw error;
    } finally {
      upstreamRequest.cleanup();
    }
  });
  sendAiReplay(res, replay);
}

type ReconciliationQuery = { sinceValue: string | null; untilValue: string | null; since: number; until: number; walletId?: string };

function parseReconciliationQuery(req: IncomingMessage, current: ResourceStore, identity: JwtIdentity): ReconciliationQuery {
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const sinceValue = url.searchParams.get("since");
  const untilValue = url.searchParams.get("until");
  const since = sinceValue ? Date.parse(sinceValue) : Number.NaN;
  const until = untilValue ? Date.parse(untilValue) : Number.NaN;
  if (sinceValue && !Number.isFinite(since)) throw gatewayError(400, "INVALID_RECONCILIATION_SINCE", "since 必须是 ISO 时间");
  if (untilValue && !Number.isFinite(until)) throw gatewayError(400, "INVALID_RECONCILIATION_UNTIL", "until 必须是 ISO 时间");
  if (Number.isFinite(since) && Number.isFinite(until) && since >= until) throw gatewayError(400, "INVALID_RECONCILIATION_RANGE", "since 必须早于 until");
  const requestedWalletId = url.searchParams.get("walletId")?.trim() ?? "";
  const walletId = requestedWalletId ? normalizeWalletId(requestedWalletId) : undefined;
  if (walletId) assertWalletAccess(current, identity, walletId, "viewer");
  return { sinceValue, untilValue, since, until, ...(walletId ? { walletId } : {}) };
}

function buildCreditReconciliationReport(current: ResourceStore, identity: JwtIdentity, query: ReconciliationQuery) {
  const { sinceValue, untilValue, since, until, walletId } = query;
  const walletSubject = walletId ? `wallet:${walletId}` : undefined;
  const entries = current.creditLedger.filter((entry) => {
    if (entry.tenantId !== identity.tenantId || entry.type !== "consume" || (walletId && entry.walletId !== walletId)) return false;
    const created = Date.parse(entry.createdAt);
    if (Number.isFinite(since) && created < since) return false;
    if (Number.isFinite(until) && created >= until) return false;
    return true;
  });
  const walletRequestIds = walletId ? new Set(entries.flatMap((entry) => entry.newApiRequestId ? [entry.newApiRequestId] : [])) : undefined;
  const imports = Object.values(current.newApiCostImports).filter((entry) => {
    if (entry.tenantId !== identity.tenantId || (walletSubject && entry.subject !== walletSubject && entry.walletId !== walletId && !(entry.newApiRequestId && walletRequestIds?.has(entry.newApiRequestId)))) return false;
    const usage = Date.parse(entry.usageAt);
    if (Number.isFinite(since) && usage < since) return false;
    if (Number.isFinite(until) && usage >= until) return false;
    return true;
  });
  const total = emptyReconciliationBucket();
  const byModel: Record<string, ReconciliationBucket> = {};
  const bySubject: Record<string, ReconciliationBucket> = {};
  const byActor: Record<string, ReconciliationBucket> = {};
  const byAgent: Record<string, ReconciliationBucket> = {};
  const bySession: Record<string, ReconciliationBucket> = {};
  const revenueAllocations = buildCreditRevenueAllocations(current, identity.tenantId, walletId);
  for (const entry of entries) {
    const allocation = revenueAllocations.get(entry.id);
    addReconciliationEntry(total, entry, allocation);
    const model = entry.model || "unknown";
    byModel[model] ??= emptyReconciliationBucket();
    addReconciliationEntry(byModel[model], entry, allocation);
    addDimensionBucket(bySubject, entry.subject, entry, allocation);
    addDimensionBucket(byActor, entry.actorSubject, entry, allocation);
    addDimensionBucket(byAgent, entry.agentId, entry, allocation);
    addDimensionBucket(bySession, entry.sessionId, entry, allocation);
  }
  const external = emptyReconciliationBucket();
  const externalByModel: Record<string, ReconciliationBucket> = {};
  const externalBySubject: Record<string, ReconciliationBucket> = {};
  const externalByActor: Record<string, ReconciliationBucket> = {};
  const externalByAgent: Record<string, ReconciliationBucket> = {};
  const externalBySession: Record<string, ReconciliationBucket> = {};
  const externalByChannel: Record<string, ReconciliationBucket> = {};
  const localRequestIds = new Set(entries.flatMap((entry) => entry.newApiRequestId ? [entry.newApiRequestId] : []));
  let matchedExternalRecords = 0;
  const providerReportedImports = imports.filter((entry) => entry.costBasis === "provider-reported");
  const providerReportedQuotaImports = imports.filter((entry) => entry.costBasis === "provider-reported-quota");
  const configuredPricingImports = imports.filter((entry) => entry.costBasis === "configured-pricing");
  const matchedRequestIds = [...new Set(imports.flatMap((entry) => entry.newApiRequestId && localRequestIds.has(entry.newApiRequestId) ? [entry.newApiRequestId] : []))];
  const costByCurrency = Object.fromEntries([...new Set(imports.map((entry) => entry.currency))].map((currency) => [currency, imports.filter((entry) => entry.currency === currency).reduce((sum, entry) => sum + entry.upstreamCost, 0)]));
  let cachedTokens = 0;
  let cachedSpend = 0;
  let cachedRequests = 0;
  let cachedRatioSum = 0;
  let cachedRatioRequests = 0;
  for (const entry of imports) {
    addReconciliationImport(external, entry);
    externalByModel[entry.model] ??= emptyReconciliationBucket();
    addReconciliationImport(externalByModel[entry.model], entry);
    addExternalDimensionBucket(externalBySubject, entry.subject, entry);
    addExternalDimensionBucket(externalByActor, entry.actorSubject, entry);
    addExternalDimensionBucket(externalByAgent, entry.agentId, entry);
    addExternalDimensionBucket(externalBySession, entry.sessionId, entry);
    const channelKey = entry.channel?.id || entry.channel?.name || "unassigned";
    externalByChannel[channelKey] ??= emptyReconciliationBucket();
    addReconciliationImport(externalByChannel[channelKey], entry);
    if (entry.cache) {
      cachedRequests += 1;
      cachedTokens += entry.cache.tokens ?? entry.cache.cacheTokens ?? 0;
      cachedSpend += entry.upstreamCost;
      if (entry.cache.ratio !== undefined) {
        cachedRatioSum += entry.cache.ratio;
        cachedRatioRequests += 1;
      }
    }
    if (entry.newApiRequestId && localRequestIds.has(entry.newApiRequestId)) matchedExternalRecords += 1;
  }
  const coverage = total.requests === 0 ? 100 : Math.round((total.newApiUsageEntries / total.requests) * 10000) / 100;
  const commerce = commerceReconciliation(current, identity.tenantId, since, until, walletId);
  const economics = commerceEconomics(commerce, imports, localRequestIds, total.pointsSettled, total.recognizedRevenueMinorByCurrency, total.paidPointsConsumed);
  const report = {
    source: "openbuddy-credit-ledger",
    externalNewApiCostFetched: providerReportedImports.length > 0 || providerReportedQuotaImports.length > 0,
    tenantId: identity.tenantId,
    ...(walletId ? { walletId } : {}),
    scope: walletId ? "wallet" : "tenant",
    generatedAt: new Date().toISOString(),
    ...(sinceValue ? { since: new Date(since).toISOString() } : {}),
    ...(untilValue ? { until: new Date(until).toISOString() } : {}),
    coveragePercent: coverage,
    total,
    commerce,
    economics,
    byModel,
    bySubject,
    byActor,
    byAgent,
    bySession,
    external: {
      source: imports.length > 0 ? "new-api-import" : "not-imported",
      records: imports.length,
      providerReportedRecords: providerReportedImports.length,
      providerReportedQuotaRecords: providerReportedQuotaImports.length,
      configuredPricingRecords: configuredPricingImports.length,
      matchedRecords: matchedExternalRecords,
      unmatchedRecords: imports.length - matchedExternalRecords,
      matchedRequestIds,
      totalCost: Object.keys(costByCurrency).length <= 1 ? external.externalCost : 0,
      totalCostByCurrency: costByCurrency,
      currencies: [...new Set(imports.map((entry) => entry.currency))],
      costBasis: Object.fromEntries([...new Set(imports.map((entry) => entry.costBasis ?? "unknown"))].map((basis) => [basis, imports.filter((entry) => (entry.costBasis ?? "unknown") === basis).reduce((sum, entry) => sum + entry.upstreamCost, 0)])),
      byModel: externalByModel,
      bySubject: externalBySubject,
      byActor: externalByActor,
      byAgent: externalByAgent,
      bySession: externalBySession,
      byChannel: externalByChannel,
      cache: {
        requests: cachedRequests,
        tokens: cachedTokens,
        spend: cachedSpend,
        averageRatio: cachedRatioRequests > 0 ? Number((cachedRatioSum / cachedRatioRequests).toFixed(4)) : 0,
      },
    },
  };
  const stableReport = Object.fromEntries(Object.entries(report).filter(([key]) => key !== "generatedAt"));
  const statementHash = createHash("sha256").update(canonicalJson(stableReport)).digest("hex");
  return {
    ...report,
    reportId: `reconciliation_${statementHash.slice(0, 24)}`,
    reportHash: statementHash,
  };
}

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(protectedText) ? `"${protectedText.replace(/"/g, '""')}"` : protectedText;
}

function appendCsvRows(rows: string[][], section: string, value: unknown, path: string[] = []): void {
  if (value === null || value === undefined) {
    rows.push([section, path.join("."), "", ""]);
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    rows.push([section, path.slice(0, -1).join("."), path.at(-1) ?? "value", Array.isArray(value) ? value.join(",") : String(value)]);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) appendCsvRows(rows, section, child, [...path, key]);
}

function reconciliationCsv(report: Record<string, unknown>): { body: string; hash: string } {
  const rows: string[][] = [];
  for (const [section, value] of Object.entries(report)) appendCsvRows(rows, section, value, [section]);
  const hash = typeof report.reportHash === "string" ? report.reportHash : createHash("sha256").update(canonicalJson(report)).digest("hex");
  rows.unshift(["metadata", "", "reportId", typeof report.reportId === "string" ? report.reportId : ""]);
  rows.unshift(["metadata", "", "reportHash", hash]);
  const body = `\uFEFFsection,key,metric,value\n${rows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`;
  return { body, hash };
}

async function handleCreditReconciliation(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, exportCsv = false): Promise<void> {
  if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", "成本对账只接受 GET");
  assertReconciliationRead(identity);
  const current = await getStore();
  const query = parseReconciliationQuery(req, current, identity);
  if (exportCsv) {
    const format = new URL(req.url ?? "/", "http://gateway.invalid").searchParams.get("format");
    if (format && format !== "csv") throw gatewayError(400, "INVALID_RECONCILIATION_FORMAT", "导出格式只支持 csv");
  }
  const report = buildCreditReconciliationReport(current, identity, query) as Record<string, unknown>;
  await audit({ requestId: randomUUID(), at: String(report.generatedAt), subject: identity.subject, tenantId: identity.tenantId, resource: exportCsv ? "credits/reconciliation/export" : "credits/reconciliation", action: "read", outcome: "success", reason: `requests=${(report.total as { requests: number }).requests}` });
  if (!exportCsv) {
    success(res, report);
    return;
  }
  const { body, hash } = reconciliationCsv(report);
  if (body.length > 10 * 1024 * 1024) throw gatewayError(413, "RECONCILIATION_EXPORT_TOO_LARGE", "对账导出文件超过大小限制");
  const scope = report.scope === "wallet" ? `wallet-${String(report.walletId)}` : "tenant";
  const date = String(report.generatedAt).slice(0, 10);
  res.statusCode = 200;
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="openbuddy-reconciliation-${scope}-${date}.csv"`);
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-openbuddy-report-id", String(report.reportId));
  res.setHeader("x-openbuddy-report-hash", hash);
  res.end(body);
}

function normalizeImportText(value: unknown, field: string, maximum: number, minimum = 1): string {
  const result = typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, maximum) : "";
  if (result.length < minimum) throw gatewayError(400, `INVALID_COST_IMPORT_${field.toUpperCase()}`, `${field} 无效`);
  return result;
}

function normalizeImportTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw gatewayError(400, "INVALID_COST_IMPORT_USAGE_AT", "usageAt 必须是有效 ISO 时间");
  return new Date(value).toISOString();
}

function importedSubjectForLocalUsage(localUsage: CreditLedgerEntry): string | undefined {
  return localUsage.walletId ? localUsage.actorSubject : localUsage.subject;
}

function validateImportedCostRecord(state: ResourceStore, item: NewApiCostImport): void {
  if (!item.newApiRequestId) return;
  const existingImport = Object.values(state.newApiCostImports).find((entry) => entry.tenantId === item.tenantId && entry.newApiRequestId === item.newApiRequestId);
  if (existingImport && existingImport.importKey !== item.importKey) {
    throw gatewayError(409, "COST_IMPORT_REQUEST_ID_CONFLICT", "同一 New API 请求不能绑定多个外部成本记录");
  }
  const localUsage = state.creditLedger.find((entry) => entry.tenantId === item.tenantId && entry.type === "consume" && entry.newApiRequestId === item.newApiRequestId);
  if (!localUsage) return;
  const subjectMatches = importedSubjectForLocalUsage(localUsage) === item.subject;
  const walletMatches = localUsage.walletId ? item.walletId === localUsage.walletId : item.walletId === undefined;
  if (!subjectMatches || !walletMatches || (item.actorSubject !== undefined && item.actorSubject !== localUsage.actorSubject) || localUsage.model !== item.model || localUsage.promptTokens !== item.promptTokens || localUsage.completionTokens !== item.completionTokens || (item.agentId !== undefined && localUsage.agentId !== item.agentId) || (item.sessionId !== undefined && localUsage.sessionId !== item.sessionId)) {
    throw gatewayError(409, "COST_IMPORT_USAGE_MISMATCH", "外部成本记录与 OpenBuddy 已结算 usage 不一致");
  }
}

function enrichImportedCostAttribution(state: ResourceStore, item: NewApiCostImport): NewApiCostImport {
  if (!item.newApiRequestId) return item;
  const localUsage = state.creditLedger.find((entry) => entry.tenantId === item.tenantId && entry.type === "consume" && entry.newApiRequestId === item.newApiRequestId);
  if (!localUsage) return item;
  if (item.actorSubject !== undefined && item.actorSubject !== localUsage.actorSubject) throw gatewayError(409, "COST_IMPORT_ACTOR_MISMATCH", "外部成本记录与 OpenBuddy 发起成员归属不一致");
  if (item.agentId !== undefined && item.agentId !== localUsage.agentId) throw gatewayError(409, "COST_IMPORT_AGENT_MISMATCH", "外部成本记录与 OpenBuddy Agent 归属不一致");
  if (item.sessionId !== undefined && item.sessionId !== localUsage.sessionId) throw gatewayError(409, "COST_IMPORT_SESSION_MISMATCH", "外部成本记录与 OpenBuddy 会话归属不一致");
  return {
    ...item,
    ...(item.walletId === undefined && localUsage.walletId ? { walletId: localUsage.walletId } : {}),
    ...(item.actorSubject === undefined && localUsage.actorSubject ? { actorSubject: localUsage.actorSubject } : {}),
    ...(item.agentId === undefined && localUsage.agentId ? { agentId: localUsage.agentId } : {}),
    ...(item.sessionId === undefined && localUsage.sessionId ? { sessionId: localUsage.sessionId } : {}),
  };
}

function validateSettlementRequestIdentity(state: ResourceStore, identity: JwtIdentity, reservation: CreditLedgerEntry, usage: ParsedUsage, newApiRequestId?: string): void {
  if (!newApiRequestId) return;
  const settledKey = `${reservation.idempotencyKey}:settled`;
  const existingConsume = state.creditLedger.find((entry) => entry.tenantId === identity.tenantId && entry.type === "consume" && entry.newApiRequestId === newApiRequestId && entry.idempotencyKey !== settledKey);
  if (existingConsume) throw gatewayError(409, "NEW_API_REQUEST_ID_CONFLICT", "同一 New API 请求不能绑定多个 OpenBuddy 消费流水");
  const imported = Object.values(state.newApiCostImports).find((entry) => entry.tenantId === identity.tenantId && entry.newApiRequestId === newApiRequestId);
  if (!imported) return;
  const expectedSubject = reservation.walletId ? reservation.actorSubject : identity.subject;
  if (imported.subject !== expectedSubject || (reservation.walletId && imported.walletId !== undefined && imported.walletId !== reservation.walletId) || (reservation.walletId && imported.walletId === undefined) || (reservation.walletId && imported.actorSubject !== undefined && imported.actorSubject !== reservation.actorSubject) || imported.model !== reservation.model || imported.promptTokens !== usage.promptTokens || imported.completionTokens !== usage.completionTokens || (imported.agentId !== undefined && imported.agentId !== reservation.agentId) || (imported.sessionId !== undefined && imported.sessionId !== reservation.sessionId)) {
    throw gatewayError(409, "COST_IMPORT_USAGE_MISMATCH", "New API 成本记录与本次 OpenBuddy 结算 usage 不一致");
  }
}

function costImportSignature(raw: string, provided: string, secret: string): boolean {
  const normalized = provided.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

async function handleNewApiCostImport(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, skipSignatureCheck = false, preParsedBody?: { raw: string; value: unknown }): Promise<void> {
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "成本对账导入只接受 POST");
  assertReconciliationImport(identity);
  if (!newApiCostImportSecret && process.env.NODE_ENV !== "development") throw gatewayError(503, "COST_IMPORT_SIGNATURE_REQUIRED", "生产环境必须配置成本导入 HMAC 密钥");
  const { raw, value } = preParsedBody ?? (await bodyWithRaw(req));
  if (newApiCostImportSecret && !skipSignatureCheck) {
    const signature = (req.headers["x-openbuddy-new-api-cost-signature"] ?? "").toString();
    if (!signature || !costImportSignature(raw, signature, newApiCostImportSecret)) throw gatewayError(401, "COST_IMPORT_SIGNATURE_INVALID", "成本导入签名校验失败");
  }
  const input = value as { records?: unknown };
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 1000) throw gatewayError(400, "INVALID_COST_IMPORT_RECORDS", "records 必须包含 1-1000 条记录");
  const current = await getStore();
  const parsed = input.records.map((record): NewApiCostImport => {
    if (!record || typeof record !== "object") throw gatewayError(400, "INVALID_COST_IMPORT_RECORD", "成本导入记录格式无效");
    const item = record as NewApiCostImportInput;
    const tenantId = normalizeImportText(item.tenantId ?? identity.tenantId, "tenantId", 200);
    if (tenantId !== identity.tenantId) throw gatewayError(403, "COST_IMPORT_TENANT_MISMATCH", "成本导入记录不能跨租户写入");
    const subject = normalizeImportText(item.subject, "subject", 200);
    const walletId = item.walletId === undefined ? undefined : normalizeWalletId(item.walletId);
    if (walletId && !findWallet(current, identity.tenantId, walletId)) throw gatewayError(404, "COST_IMPORT_WALLET_NOT_FOUND", "成本导入记录引用的钱包不存在");
    const model = normalizeImportText(item.model, "model", 200);
    const promptTokens = creditAmount(item.promptTokens, "promptTokens", 1_000_000_000);
    const completionTokens = creditAmount(item.completionTokens, "completionTokens", 1_000_000_000);
    const upstreamCost = Number(item.upstreamCost);
    if (!Number.isFinite(upstreamCost) || upstreamCost < 0 || upstreamCost > 1_000_000_000) throw gatewayError(400, "INVALID_COST_IMPORT_UPSTREAM_COST", "upstreamCost 必须是合法的非负数字");
    const currency = normalizeCurrency(item.currency, "USD");
    const source = normalizeImportText(item.source ?? "new-api-log", "source", 80);
    const externalId = normalizeImportText(item.externalId, "externalId", 240);
    const importKey = normalizeImportText(item.importKey ?? externalId, "importKey", 320, 8);
    const usageAt = normalizeImportTimestamp(item.usageAt);
    const newApiRequestId = item.newApiRequestId === undefined ? undefined : normalizeImportText(item.newApiRequestId, "newApiRequestId", 200);
    const newApiGroup = item.newApiGroup === undefined ? undefined : normalizeImportText(item.newApiGroup, "newApiGroup", 120);
    const actorSubject = item.actorSubject === undefined ? undefined : normalizeImportText(item.actorSubject, "actorSubject", 200);
    const agentId = item.agentId === undefined ? undefined : normalizeImportText(item.agentId, "agentId", 160);
    const sessionId = item.sessionId === undefined ? undefined : normalizeImportText(item.sessionId, "sessionId", 160);
    validateImportedWalletAttribution(current, identity.tenantId, walletId, subject, actorSubject, newApiRequestId);
    const costBasis = item.costBasis === "provider-reported" || item.costBasis === "provider-reported-quota" ? item.costBasis : item.costBasis === "configured-pricing" ? "configured-pricing" : (() => { throw gatewayError(400, "INVALID_COST_IMPORT_BASIS", "costBasis 必须显式为 provider-reported、provider-reported-quota 或 configured-pricing"); })();
    const channelInput = item.channel && typeof item.channel === "object" && !Array.isArray(item.channel) ? item.channel as Record<string, unknown> : undefined;
    const channelId = channelInput && typeof channelInput.id === "string" && channelInput.id.trim() ? channelInput.id.replace(/[\r\n\t]/g, " ").trim().slice(0, 40) : "";
    const channelName = channelInput && typeof channelInput.name === "string" && channelInput.name.trim() ? channelInput.name.replace(/[\r\n\t]/g, " ").trim().slice(0, 120) : "";
    const cacheInput = item.cache && typeof item.cache === "object" && !Array.isArray(item.cache) ? item.cache as Record<string, unknown> : undefined;
    const cacheTokens = cacheInput && Number.isSafeInteger(cacheInput.tokens) && (cacheInput.tokens as number) >= 0 ? Math.min(cacheInput.tokens as number, 1_000_000_000) : undefined;
    const cacheRatio = cacheInput && Number.isFinite(Number(cacheInput.ratio)) ? Math.max(0, Math.min(1, Number(cacheInput.ratio))) : undefined;
    const cacheCacheTokens = cacheInput && Number.isSafeInteger(cacheInput.cacheTokens) && (cacheInput.cacheTokens as number) >= 0 ? Math.min(cacheInput.cacheTokens as number, 1_000_000_000) : undefined;
    return { id: randomUUID(), tenantId, subject, ...(walletId ? { walletId } : {}), ...(actorSubject ? { actorSubject } : {}), model, promptTokens, completionTokens, upstreamCost, currency, source, externalId, importKey, usageAt, importedAt: new Date().toISOString(), ...(newApiRequestId ? { newApiRequestId } : {}), ...(newApiGroup ? { newApiGroup } : {}), ...(agentId ? { agentId } : {}), ...(sessionId ? { sessionId } : {}), ...(channelId || channelName ? { channel: { ...(channelId ? { id: channelId } : {}), ...(channelName ? { name: channelName } : {}) } } : {}), ...(cacheTokens !== undefined || cacheRatio !== undefined || cacheCacheTokens !== undefined ? { cache: { ...(cacheTokens !== undefined ? { tokens: cacheTokens } : {}), ...(cacheRatio !== undefined ? { ratio: cacheRatio } : {}), ...(cacheCacheTokens !== undefined ? { cacheTokens: cacheCacheTokens } : {}) } } : {}), costBasis };
  });
  const result = await serialized(async () => {
    const next = await getStore();
    const imported: NewApiCostImport[] = [];
    const duplicates: NewApiCostImport[] = [];
    const pendingByImportKey = new Map<string, NewApiCostImport>();
    const pendingByRequestId = new Map<string, NewApiCostImport>();
    for (const parsedItem of parsed) {
      const item = enrichImportedCostAttribution(next, parsedItem);
      const key = `${item.tenantId}:${item.importKey}`;
      const existing = next.newApiCostImports[key];
      if (existing) {
        if (!sameImportedCostRecord(existing, item)) throw gatewayError(409, "COST_IMPORT_IDEMPOTENCY_CONFLICT", "成本导入幂等键已对应不同记录");
        duplicates.push(existing);
        continue;
      }
      validateImportedCostRecord(next, item);
      const pending = pendingByImportKey.get(key);
      if (pending) {
        if (!sameImportedCostRecord(pending, item)) throw gatewayError(409, "COST_IMPORT_IDEMPOTENCY_CONFLICT", "同一批次的成本导入幂等键对应不同记录");
        duplicates.push(pending);
        continue;
      }
      if (item.newApiRequestId) {
        const pendingRequest = pendingByRequestId.get(`${item.tenantId}:${item.newApiRequestId}`);
        if (pendingRequest && pendingRequest.importKey !== item.importKey) throw gatewayError(409, "COST_IMPORT_REQUEST_ID_CONFLICT", "同一批次的 New API 请求不能绑定多个外部成本记录");
        pendingByRequestId.set(`${item.tenantId}:${item.newApiRequestId}`, item);
      }
      pendingByImportKey.set(key, item);
      next.newApiCostImports[key] = item;
      imported.push(item);
    }
    if (imported.length) await saveStore(next);
    return { imported, duplicates };
  });
  const at = new Date().toISOString();
  await audit({ requestId: randomUUID(), at, subject: identity.subject, tenantId: identity.tenantId, resource: "credits/reconciliation/import", action: "create", outcome: "success", reason: `imported=${result.imported.length},duplicates=${result.duplicates.length}` });
  success(res, { imported: result.imported.length, duplicates: result.duplicates.length, records: [...result.imported, ...result.duplicates] }, result.imported.length ? 201 : 200);
}

function sameImportedCostRecord(left: NewApiCostImport, right: NewApiCostImport): boolean {
  return left.subject === right.subject
    && left.walletId === right.walletId
    && (left.actorSubject === undefined || right.actorSubject === undefined || left.actorSubject === right.actorSubject)
    && left.model === right.model
    && left.promptTokens === right.promptTokens
    && left.completionTokens === right.completionTokens
    && left.upstreamCost === right.upstreamCost
    && left.currency === right.currency
    && left.source === right.source
    && left.externalId === right.externalId
    && left.usageAt === right.usageAt
    && left.newApiRequestId === right.newApiRequestId
    && left.newApiGroup === right.newApiGroup
    && left.agentId === right.agentId
    && left.sessionId === right.sessionId
    && JSON.stringify(left.channel ?? null) === JSON.stringify(right.channel ?? null)
    && JSON.stringify(left.cache ?? null) === JSON.stringify(right.cache ?? null)
    && (left.costBasis ?? "unknown") === (right.costBasis ?? "unknown");
}

async function handleCredits(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, operation?: string): Promise<void> {
  const requestId = randomUUID();
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const current = await serialized(async () => {
    const next = await getStore();
    const subject = normalizedCreditSubject(url.searchParams.get("subject"), identity.subject);
    const expired = operation !== "expire" ? expireTenantCredits(next, identity.tenantId, subject) : 0;
    const entitlementsExpired = expireBillingEntitlements(next, identity.tenantId);
    if (expired > 0 || entitlementsExpired) await saveStore(next);
    return next;
  });
  assertTenantActive(tenantPolicy(current, identity.tenantId));
  const requestedSubject = normalizedCreditSubject(url.searchParams.get("subject"), identity.subject);
  if (operation === undefined && req.method === "GET") {
    assertCreditRead(identity, requestedSubject);
    const account = accountFor(current, identity.tenantId, requestedSubject);
    success(res, { ...account, available: account.balance - account.reserved });
    return;
  }
  if (operation === "ledger" && req.method === "GET") {
    assertCreditRead(identity, requestedSubject);
    const limit = boundedNumber(url.searchParams.get("limit") ?? undefined, 100, 1, 500);
    success(res, current.creditLedger.filter((entry) => entry.tenantId === identity.tenantId && entry.subject === requestedSubject).slice(-limit).reverse());
    return;
  }
  if (operation === "integrity" && req.method === "GET") {
    assertCreditRead(identity, requestedSubject);
    success(res, { tenantId: identity.tenantId, scope: "tenant", ...creditLedgerIntegrity(current) });
    return;
  }
  if (operation === "quote" && req.method === "POST") {
    const input = await body(req) as CreditQuoteInput;
    const policy = effectiveTenantPolicy(current, identity.tenantId);
    assertTenantActive(policy);
    if (policy.killSwitch) throw gatewayError(423, "TENANT_RUNTIME_DISABLED", "当前租户已暂停智能体运行");
    const model = normalizeSubject(input.model);
    if (policy.modelAllowlist?.length && !policy.modelAllowlist.includes(model)) throw gatewayError(403, "MODEL_NOT_ALLOWED", "当前模型不在租户白名单");
    assertCommercialModelSellable(current, identity.tenantId, policy.newApiGroup ?? newApiGroup, model, "chat.completions");
    success(res, creditQuote(current, identity.tenantId, input));
    return;
  }
  if (operation === "pricing" && req.method === "GET") {
    const entries = Object.entries(current.creditPricing).filter(([key]) => key.startsWith(`${identity.tenantId}::`)).map(([, entry]) => entry);
    success(res, entries.length ? entries : [pricingFor(current, identity.tenantId, "*")]);
    return;
  }
  if (operation === "pricing" && req.method === "PATCH") {
    assertCreditAdmin(identity);
    const input = await body(req) as CreditPricingInput;
    const model = normalizeSubject(input.model);
    if (!model || model.length > 200) throw gatewayError(400, "INVALID_CREDIT_MODEL", "计费模型标识无效");
    const inputRate = creditAmount(input.inputPointsPerThousand, "inputPointsPerThousand", 1_000_000);
    const outputRate = creditAmount(input.outputPointsPerThousand, "outputPointsPerThousand", 1_000_000);
    const minimumPoints = creditAmount(input.minimumPoints, "minimumPoints", 1_000_000);
    const inputCost = input.inputCostPerMillion === undefined ? undefined : Number(input.inputCostPerMillion);
    const outputCost = input.outputCostPerMillion === undefined ? undefined : Number(input.outputCostPerMillion);
    if ((inputCost === undefined) !== (outputCost === undefined) || (inputCost !== undefined && (!Number.isFinite(inputCost) || inputCost < 0 || inputCost > 1_000_000)) || (outputCost !== undefined && (!Number.isFinite(outputCost) || outputCost < 0 || outputCost > 1_000_000))) throw gatewayError(400, "INVALID_PROVIDER_COST_PRICING", "供应商输入和输出成本必须同时提供合法的非负金额");
    const costCurrency = inputCost === undefined ? undefined : normalizeCurrency(input.costCurrency, "USD");
    const costSource = inputCost === undefined ? undefined : input.costSource === undefined ? "configured-pricing" : input.costSource;
    if (costSource !== undefined && costSource !== "configured-pricing" && costSource !== "provider-reported" && costSource !== "provider-reported-quota") throw gatewayError(400, "INVALID_PROVIDER_COST_BASIS", "供应商成本依据无效");
    const updated = await serialized(async () => {
      const next = await getStore();
      const price: CreditPricing = { model, inputPointsPerThousand: inputRate, outputPointsPerThousand: outputRate, minimumPoints, ...(inputCost === undefined ? {} : { inputCostPerMillion: inputCost, outputCostPerMillion: outputCost, costCurrency, costSource }), updatedAt: new Date().toISOString(), updatedBy: identity.subject };
      next.creditPricing[creditKey(identity.tenantId, model)] = price;
      await saveStore(next);
      return price;
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `credits/pricing/${model}`, action: "update", outcome: "success" });
    success(res, updated);
    return;
  }
  if (operation === "expire" && req.method === "POST") {
    assertCreditAdmin(identity);
    const walletId = url.searchParams.get("walletId");
    const all = url.searchParams.get("all") === "true";
    if (all && (walletId || url.searchParams.has("subject"))) throw gatewayError(400, "INVALID_CREDIT_EXPIRY_SCOPE", "all=true 不能与 walletId 或 subject 同时使用");
    const subject = walletId ? `wallet:${normalizeWalletId(walletId)}` : normalizedCreditSubject(url.searchParams.get("subject"), identity.subject);
    if (walletId) {
      const state = await getStore();
      assertWalletAccess(state, identity, normalizeWalletId(walletId), "owner");
    }
    const result = await serialized(async () => {
      const next = await getStore();
      if (all) {
        const summary = expireAllTenantCredits(next, identity.tenantId);
        const entitlementsExpired = expireBillingEntitlements(next, identity.tenantId);
        if (summary.expired > 0 || entitlementsExpired) await saveStore(next);
        return { ...summary, entitlementsExpired };
      }
      const expired = walletId ? expireCreditLots(next, identity.tenantId, `wallet:${normalizeWalletId(walletId)}`) : expireTenantCredits(next, identity.tenantId, subject);
      if (expired > 0) await saveStore(next);
      return { expired, account: walletId ? accountForWallet(next, identity.tenantId, normalizeWalletId(walletId)) : accountFor(next, identity.tenantId, subject) };
    });
    if (all) {
      if (!("accounts" in result) || !("wallets" in result)) throw gatewayError(500, "CREDIT_EXPIRY_RESULT_INVALID", "批量积分过期结果无效");
      await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "credits/all", action: "expire", outcome: "success", reason: `expired=${result.expired};accounts=${result.accounts};wallets=${result.wallets}` });
      success(res, result);
      return;
    }
    if (!("account" in result) || !result.account) throw gatewayError(500, "CREDIT_EXPIRY_RESULT_INVALID", "积分过期结果无效");
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: walletId ? `credits/wallet/${normalizeWalletId(walletId)}` : `credits/${subject}`, action: "expire", outcome: "success", reason: `expired=${result.expired}` });
    success(res, { ...result, account: { ...result.account, available: result.account.balance - result.account.reserved } });
    return;
  }
  if (operation === "transfer" && req.method === "POST") {
    const input = await body(req) as { source?: { subject?: unknown; walletId?: unknown }; destination?: { subject?: unknown; walletId?: unknown }; amount?: unknown; idempotencyKey?: unknown; reason?: unknown };
    const source = input.source ?? {};
    const destination = input.destination ?? {};
    const sourceWalletRaw = typeof source.walletId === "string" && source.walletId.trim() ? source.walletId.trim() : "";
    const sourceSubjectRaw = typeof source.subject === "string" && source.subject.trim() ? source.subject.trim() : "";
    const destWalletRaw = typeof destination.walletId === "string" && destination.walletId.trim() ? destination.walletId.trim() : "";
    const destSubjectRaw = typeof destination.subject === "string" && destination.subject.trim() ? destination.subject.trim() : "";
    if ((sourceWalletRaw ? 1 : 0) + (sourceSubjectRaw ? 1 : 0) !== 1) throw gatewayError(400, "INVALID_TRANSFER_SOURCE", "源账户必须且只能指定 subject 或 walletId 之一");
    if ((destWalletRaw ? 1 : 0) + (destSubjectRaw ? 1 : 0) !== 1) throw gatewayError(400, "INVALID_TRANSFER_DESTINATION", "目标账户必须且只能指定 subject 或 walletId 之一");
    const sourceWalletId = sourceWalletRaw ? normalizeWalletId(sourceWalletRaw) : "";
    const destWalletId = destWalletRaw ? normalizeWalletId(destWalletRaw) : "";
    const sourceSubject = sourceWalletId ? `wallet:${sourceWalletId}` : normalizedCreditSubject(sourceSubjectRaw, identity.subject);
    const destSubject = destWalletId ? `wallet:${destWalletId}` : normalizedCreditSubject(destSubjectRaw, identity.subject);
    if (sourceSubject === destSubject) throw gatewayError(400, "TRANSFER_SAME_ACCOUNT", "源与目标账户不能相同");
    const amount = creditAmount(input.amount, "amount");
    if (amount < 1) throw gatewayError(400, "INVALID_CREDIT_AMOUNT", "转账积分必须大于 0");
    const idempotencyKey = creditIdempotency(input.idempotencyKey);
    const transferReason = typeof input.reason === "string" ? input.reason.slice(0, 240) : undefined;
    const result = await serialized(async () => {
      const next = await getStore();
      if (sourceWalletId) assertWalletAccess(next, identity, sourceWalletId, "owner");
      else if (sourceSubject !== identity.subject && !isGlobalAdmin(identity.claims) && !isAdmin(identity.claims)) {
        throw gatewayError(403, "TRANSFER_SOURCE_DENIED", "源个人账户仅本人或租户管理员可发起转账");
      }
      if (destWalletId) assertWalletAccess(next, identity, destWalletId, "owner");
      const existingOut = findLedgerByKey(next, identity.tenantId, sourceSubject, `transfer:${idempotencyKey}:out`);
      const existingIn = findLedgerByKey(next, identity.tenantId, destSubject, `transfer:${idempotencyKey}:in`);
      if (existingOut && existingIn) {
        return {
          source: sourceWalletId ? accountForWallet(next, identity.tenantId, sourceWalletId) : accountFor(next, identity.tenantId, sourceSubject),
          destination: destWalletId ? accountForWallet(next, identity.tenantId, destWalletId) : accountFor(next, identity.tenantId, destSubject),
          outEntry: existingOut,
          inEntry: existingIn,
          replay: true,
        };
      }
      if (existingOut || existingIn) throw gatewayError(409, "TRANSFER_IDEMPOTENCY_CONFLICT", "转账幂等键冲突：源或目标侧已存在部分记录");
      const previousSource = sourceWalletId ? accountForWallet(next, identity.tenantId, sourceWalletId) : accountFor(next, identity.tenantId, sourceSubject);
      const sourceAvailable = previousSource.balance - previousSource.reserved;
      if (sourceAvailable < amount) throw gatewayError(402, "INSUFFICIENT_CREDITS", sourceWalletId ? "共享钱包可用积分不足" : "个人积分可用余额不足");
      const previousDest = destWalletId ? accountForWallet(next, identity.tenantId, destWalletId) : accountFor(next, identity.tenantId, destSubject);
      const sourceAccountKey = sourceWalletId ? walletAccountKey(identity.tenantId, sourceWalletId) : creditKey(identity.tenantId, sourceSubject);
      const destAccountKey = destWalletId ? walletAccountKey(identity.tenantId, destWalletId) : creditKey(identity.tenantId, destSubject);
      const sourceExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
      const outEntry = creditEntry({ tenantId: identity.tenantId, subject: sourceSubject, ...(sourceWalletId ? { walletId: sourceWalletId } : {}), type: "adjustment", amount, pointsSettled: -amount, idempotencyKey: `transfer:${idempotencyKey}:out`, expiresAt: sourceExpiresAt, reason: transferReason ?? "积分转出", createdBy: identity.subject });
      const inEntry = creditEntry({ tenantId: identity.tenantId, subject: destSubject, ...(destWalletId ? { walletId: destWalletId } : {}), type: "adjustment", amount, pointsSettled: amount, idempotencyKey: `transfer:${idempotencyKey}:in`, expiresAt: sourceExpiresAt, sourceLedgerId: outEntry.id, reason: transferReason ?? "积分转入", createdBy: identity.subject });
      outEntry.sourceLedgerId = inEntry.id;
      const updatedSource: CreditAccount = { ...previousSource, balance: previousSource.balance - amount, lifetimeConsumed: previousSource.lifetimeConsumed + amount, ...(sourceWalletId ? { walletId: sourceWalletId } : {}), updatedAt: new Date().toISOString(), version: previousSource.version + 1 };
      const updatedDest: CreditAccount = { ...previousDest, balance: previousDest.balance + amount, lifetimeGranted: previousDest.lifetimeGranted + amount, ...(destWalletId ? { walletId: destWalletId } : {}), updatedAt: new Date().toISOString(), version: previousDest.version + 1 };
      next.creditAccounts[sourceAccountKey] = updatedSource;
      next.creditAccounts[destAccountKey] = updatedDest;
      appendCreditLedgerEntry(next, outEntry);
      appendCreditLedgerEntry(next, inEntry);
      await saveStore(next);
      return { source: updatedSource, destination: updatedDest, outEntry, inEntry, replay: false };
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `credits/transfer`, action: "transfer", outcome: "success", reason: `from=${result.outEntry.subject};to=${result.inEntry.subject};amount=${amount};idempotencyKey=${idempotencyKey};replay=${result.replay}` });
    success(res, {
      amount,
      idempotencyKey,
      source: { ...result.source, available: result.source.balance - result.source.reserved },
      destination: { ...result.destination, available: result.destination.balance - result.destination.reserved },
      outEntryId: result.outEntry.id,
      inEntryId: result.inEntry.id,
      replay: result.replay,
    }, result.replay ? 200 : 201);
    return;
  }
  if (operation === "welcome" && req.method === "POST") {
    assertCreditAdmin(identity);
    const input = await body(req) as { subject?: unknown; idempotencyKey?: unknown };
    const subject = normalizedCreditSubject(input.subject, identity.subject);
    const idempotencyKey = creditIdempotency(input.idempotencyKey);
    const result = await issueWelcomeCredit(identity.tenantId, subject, idempotencyKey);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `credits/${subject}`, action: "welcome-grant", outcome: "success" });
    const { created: _created, ...welcomeResult } = result;
    success(res, { ...welcomeResult, account: { ...result.account, available: result.account.balance - result.account.reserved } }, 201);
    return;
  }
  if (operation === "grant" && req.method === "POST") {
    assertCreditAdmin(identity);
    const input = await body(req) as { subject?: unknown; walletId?: unknown; amount?: unknown; type?: unknown; reason?: unknown; idempotencyKey?: unknown; validDays?: unknown };
    if (input.type === "purchase") throw gatewayError(400, "PURCHASE_REQUIRES_BILLING_ORDER", "购买积分必须通过待支付订单和已验证的支付回调完成");
    if (input.type !== undefined && input.type !== "grant") throw gatewayError(400, "INVALID_CREDIT_GRANT_TYPE", "积分发放接口仅支持 grant 类型");
    const walletId = typeof input.walletId === "string" && input.walletId.trim() ? normalizeWalletId(input.walletId) : "";
    const subject = walletId ? `wallet:${walletId}` : normalizedCreditSubject(input.subject, identity.subject);
    if (walletId) {
      const state = await getStore();
      assertWalletAccess(state, identity, walletId, "owner");
    }
    const amount = creditAmount(input.amount, "amount");
    if (amount < 1) throw gatewayError(400, "INVALID_CREDIT_AMOUNT", "发放积分必须大于 0");
    const idempotencyKey = creditIdempotency(input.idempotencyKey);
    const type = "grant" as const;
    const validDays = input.validDays === undefined ? undefined : creditAmount(input.validDays, "validDays", 3650);
    if (validDays !== undefined && validDays < 1) throw gatewayError(400, "INVALID_POINTS_VALID_DAYS", "积分有效期必须至少为 1 天");
    const result = await serialized(async () => {
      const next = await getStore();
      const existing = findLedgerByKey(next, identity.tenantId, subject, idempotencyKey);
      if (existing) {
        assertCreditReplayMatches(existing, { type, amount });
        return { account: walletId ? accountForWallet(next, identity.tenantId, walletId) : accountFor(next, identity.tenantId, subject), entry: existing };
      }
      const previous = walletId ? accountForWallet(next, identity.tenantId, walletId) : accountFor(next, identity.tenantId, subject);
      const account: CreditAccount = { ...previous, balance: previous.balance + amount, lifetimeGranted: previous.lifetimeGranted + amount, ...(walletId ? { walletId } : {}), updatedAt: new Date().toISOString(), version: previous.version + 1 };
      const expiresAt = validDays === undefined ? undefined : new Date(Date.now() + validDays * 86_400_000).toISOString();
      const entry = creditEntry({ tenantId: identity.tenantId, subject, ...(walletId ? { walletId } : {}), type, amount, idempotencyKey, ...(expiresAt ? { expiresAt } : {}), reason: typeof input.reason === "string" ? input.reason.slice(0, 240) : undefined, createdBy: identity.subject });
      next.creditAccounts[walletId ? walletAccountKey(identity.tenantId, walletId) : creditKey(identity.tenantId, subject)] = account;
      appendCreditLedgerEntry(next, entry);
      await saveStore(next);
      return { account, entry };
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: walletId ? `credits/wallet/${walletId}` : `credits/${subject}`, action: type, outcome: "success" });
    success(res, { ...result, account: { ...result.account, available: result.account.balance - result.account.reserved } }, 201);
    return;
  }
  if (operation === "reserve" && req.method === "POST") {
    const input = await body(req) as { amount?: unknown; model?: unknown; promptTokens?: unknown; completionTokens?: unknown; idempotencyKey?: unknown; reason?: unknown; walletId?: unknown };
    const idempotencyKey = creditIdempotency(input.idempotencyKey);
    const model = normalizeSubject(input.model) || "unknown";
    const promptTokens = creditAmount(input.promptTokens ?? 0, "promptTokens", 10_000_000_000);
    const completionTokens = creditAmount(input.completionTokens ?? 0, "completionTokens", 10_000_000_000);
    const requestedAmount = input.amount === undefined ? undefined : creditAmount(input.amount, "amount");
    const result = await serialized(async () => {
      const next = await getStore();
      const target = resolveWalletTarget(next, identity, input.walletId, "spend");
      const accountSubject = target.wallet ? `wallet:${target.wallet.id}` : identity.subject;
      const expired = target.wallet ? expireCreditLots(next, identity.tenantId, accountSubject) : expireTenantCredits(next, identity.tenantId, identity.subject);
      const entitlementsExpired = expireBillingEntitlements(next, identity.tenantId);
      if (expired > 0 || entitlementsExpired) await saveStore(next);
      const amount = requestedAmount ?? estimatedCreditCost(next, identity.tenantId, model, promptTokens, completionTokens);
      if (amount < 1) throw gatewayError(400, "INVALID_CREDIT_AMOUNT", "预扣积分必须大于 0");
      const existing = findLedgerByKey(next, identity.tenantId, accountSubject, idempotencyKey);
      if (existing) {
        assertCreditReplayMatches(existing, { type: "reservation", amount, model, promptTokens, completionTokens });
        return { account: target.wallet ? accountForWallet(next, identity.tenantId, target.wallet.id) : accountFor(next, identity.tenantId, identity.subject), entry: existing };
      }
      const policy = effectiveTenantPolicy(next, identity.tenantId);
      const previous = target.wallet ? accountForWallet(next, identity.tenantId, target.wallet.id) : accountFor(next, identity.tenantId, identity.subject);
      if (previous.balance - previous.reserved < amount) throw gatewayError(402, "INSUFFICIENT_CREDITS", target.wallet ? "共享钱包积分余额不足" : "积分余额不足");
      reserveRuntimeUsage(next, identity.tenantId, policy, promptTokens + completionTokens, amount);
      const pricingSnapshot = pricingFor(next, identity.tenantId, model);
      const account: CreditAccount = { ...previous, reserved: previous.reserved + amount, ...(target.wallet ? { walletId: target.wallet.id } : {}), updatedAt: new Date().toISOString(), version: previous.version + 1 };
      const entry = creditEntry({ tenantId: identity.tenantId, subject: accountSubject, ...(target.wallet ? { walletId: target.wallet.id } : {}), type: "reservation", amount, idempotencyKey, model, promptTokens, completionTokens, pricingSnapshot, reason: typeof input.reason === "string" ? input.reason.slice(0, 240) : undefined });
      next.creditAccounts[target.accountKey] = account;
      appendCreditLedgerEntry(next, entry);
      await saveStore(next);
      return { account, entry };
    });
    success(res, { ...result, account: { ...result.account, available: result.account.balance - result.account.reserved } }, 201);
    return;
  }
  if ((operation === "settle" || operation === "release") && req.method === "POST") {
    const input = await body(req) as { reservationKey?: unknown; amount?: unknown; promptTokens?: unknown; completionTokens?: unknown; model?: unknown; newApiRequestId?: unknown; reason?: unknown; walletId?: unknown };
    const reservationKey = creditIdempotency(input.reservationKey);
    const result = await serialized(async () => {
      const next = await getStore();
      const reservation = lookupReservationAcrossWallet(next, identity, reservationKey);
      if (!reservation || reservation.type !== "reservation") throw gatewayError(404, "CREDIT_RESERVATION_NOT_FOUND", "积分预扣记录不存在");
      if (reservation.walletId) {
        assertWalletAccess(next, identity, reservation.walletId, "spender");
      }
      const accountKey = reservation.walletId ? walletAccountKey(identity.tenantId, reservation.walletId) : creditKey(identity.tenantId, identity.subject);
      const actual = operation === "release" ? 0 : creditAmount(input.amount, "amount");
      const settled = findLedgerByKey(next, identity.tenantId, reservation.subject, `${reservationKey}:settled`);
      if (settled) {
        if (operation === "settle" && settled.type === "release" && settled.reason?.startsWith("真实用量超过预扣")) {
          throw gatewayError(402, "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE", "真实用量超过预扣且当前可用积分不足，预扣已释放");
        }
        assertCreditReplayMatches(settled, { type: actual ? "consume" : "release", amount: actual, ...(typeof input.model === "string" ? { model: input.model.slice(0, 200) } : {}) });
        return { account: reservation.walletId ? accountForWallet(next, identity.tenantId, reservation.walletId) : accountFor(next, identity.tenantId, identity.subject), entry: settled };
      }
      const policy = tenantPolicy(next, identity.tenantId);
      if (operation === "settle" && runtimePointsBudgetExceeded(next, identity.tenantId, policy, reservation.amount, actual)) {
        releaseCreditReservationState(next, identity, reservation, "真实用量超过租户每日积分预算");
        await saveStore(next);
        throw gatewayError(429, "POINTS_QUOTA_EXCEEDED", "真实用量超过当前租户今日积分预算，预扣已释放");
      }
      const previous = reservation.walletId ? accountForWallet(next, identity.tenantId, reservation.walletId) : accountFor(next, identity.tenantId, identity.subject);
      const availableOutsideReservation = previous.balance - Math.max(0, previous.reserved - reservation.amount);
      if (actual > availableOutsideReservation) {
        releaseCreditReservationState(next, identity, reservation, "真实用量超过预扣且当前可用积分不足");
        await saveStore(next);
        throw gatewayError(402, "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE", "真实用量超过预扣且当前可用积分不足，预扣已释放");
      }
      const refund = Math.max(0, reservation.amount - actual);
      const additionalCharged = Math.max(0, actual - reservation.amount);
      const account: CreditAccount = { ...previous, balance: previous.balance - actual, reserved: previous.reserved - reservation.amount, lifetimeConsumed: previous.lifetimeConsumed + actual, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), updatedAt: new Date().toISOString(), version: previous.version + 1 };
      const entry = creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: actual ? "consume" : "release", amount: actual, idempotencyKey: `${reservationKey}:settled`, model: typeof input.model === "string" ? input.model.slice(0, 200) : reservation.model, pricingSnapshot: reservation.pricingSnapshot, promptTokens: creditAmount(input.promptTokens ?? reservation.promptTokens ?? 0, "promptTokens", 10_000_000_000), completionTokens: creditAmount(input.completionTokens ?? reservation.completionTokens ?? 0, "completionTokens", 10_000_000_000), newApiRequestId: typeof input.newApiRequestId === "string" ? input.newApiRequestId.slice(0, 200) : undefined, reason: typeof input.reason === "string" ? input.reason.slice(0, 240) : undefined });
      next.creditAccounts[accountKey] = account;
      appendCreditLedgerEntry(next, entry);
      if (refund > 0) appendCreditLedgerEntry(next, creditEntry({ tenantId: identity.tenantId, subject: reservation.subject, ...(reservation.walletId ? { walletId: reservation.walletId } : {}), type: "refund", amount: refund, idempotencyKey: `${reservationKey}:refund`, model: reservation.model, pricingSnapshot: reservation.pricingSnapshot, reason: "预扣与实际用量差额" }));
      const settledTokens = entry.promptTokens !== undefined && entry.completionTokens !== undefined && actual > 0 ? entry.promptTokens + entry.completionTokens : 0;
      settleRuntimeUsage(next, identity.tenantId, (reservation.promptTokens ?? 0) + (reservation.completionTokens ?? 0), reservation.amount, settledTokens, actual);
      await saveStore(next);
      return { account, entry, refunded: refund, additionalCharged };
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "credits", action: operation, outcome: "success" });
    success(res, { ...result, account: { ...result.account, available: result.account.balance - result.account.reserved } });
    return;
  }
  throw gatewayError(405, "METHOD_NOT_ALLOWED", "积分接口方法不支持");
}

async function handleWallets(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, walletId?: string, memberSubject?: string): Promise<void> {
  const requestId = randomUUID();
  if (walletId === undefined) {
    if (req.method === "GET") {
      const current = await getStore();
      const wallets = Object.values(current.creditWallets).filter((wallet) => wallet.tenantId === identity.tenantId && (isGlobalAdmin(identity.claims) || isAdmin(identity.claims) || listWalletMembers(current, identity.tenantId, wallet.id).some((member) => member.subject === identity.subject)));
      await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "wallets", action: "read", outcome: "success" });
      success(res, wallets.map((wallet) => ({ ...wallet, members: listWalletMembers(current, identity.tenantId, wallet.id) })));
      return;
    }
    if (req.method === "POST") {
      assertCreditAdmin(identity);
      const input = await body(req) as { id?: unknown; name?: unknown; idempotencyKey?: unknown };
      const requestedId = typeof input.id === "string" && input.id.trim() ? normalizeWalletId(input.id) : randomUUID().replace(/-/g, "").slice(0, 24);
      const name = normalizeWalletName(input.name);
      const idempotencyKey = creditIdempotency(input.idempotencyKey ?? `wallet-create:${requestedId}`);
      const created = await serialized(async () => {
        const next = await getStore();
        const existing = findWallet(next, identity.tenantId, requestedId);
        const owner = next.creditWalletMembers[walletMemberKey(identity.tenantId, requestedId, identity.subject)];
        if (existing) {
          if (existing.name !== name) throw gatewayError(409, "WALLET_IDEMPOTENCY_CONFLICT", "该钱包 ID 已用于不同名称的钱包");
          return { wallet: existing, member: owner ?? { walletId: requestedId, tenantId: identity.tenantId, subject: identity.subject, role: "owner", createdAt: existing.createdAt, updatedAt: existing.updatedAt, createdBy: existing.createdBy } };
        }
        const now = new Date().toISOString();
        const wallet: CreditWallet = { id: requestedId, tenantId: identity.tenantId, name, status: "active", createdAt: now, updatedAt: now, createdBy: identity.subject };
        const member: CreditWalletMember = { walletId: requestedId, tenantId: identity.tenantId, subject: identity.subject, role: "owner", createdAt: now, updatedAt: now, createdBy: identity.subject };
        next.creditWallets[walletAccountKey(identity.tenantId, requestedId)] = wallet;
        next.creditWalletMembers[walletMemberKey(identity.tenantId, requestedId, identity.subject)] = member;
        await saveStore(next);
        return { wallet, member };
      });
      await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `wallets/${requestedId}`, action: "create", outcome: "success" });
      success(res, created, 201);
      return;
    }
    throw gatewayError(405, "METHOD_NOT_ALLOWED", "钱包列表只接受 GET，钱包创建只接受 POST");
  }
  if (memberSubject !== undefined) {
    const current = await getStore();
    assertWalletAccess(current, identity, walletId, "owner");
    const memberKey = walletMemberKey(identity.tenantId, walletId, memberSubject);
    if (req.method === "PUT") {
      const input = await body(req) as { role?: unknown };
      const role = normalizeWalletRole(input.role);
      const updated = await serialized(async () => {
        const next = await getStore();
        assertWalletAccess(next, identity, walletId, "owner");
        const ownerCount = listWalletMembers(next, identity.tenantId, walletId).filter((entry) => entry.role === "owner").length;
        const existing = next.creditWalletMembers[memberKey];
        if (existing && existing.role === "owner" && role !== "owner" && ownerCount <= 1) throw gatewayError(409, "WALLET_OWNER_REQUIRED", "共享钱包必须至少保留一个 owner 角色");
        const now = new Date().toISOString();
        const member: CreditWalletMember = { walletId, tenantId: identity.tenantId, subject: memberSubject, role, createdAt: existing?.createdAt ?? now, updatedAt: now, createdBy: existing?.createdBy ?? identity.subject };
        next.creditWalletMembers[memberKey] = member;
        await saveStore(next);
        return member;
      });
      await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `wallets/${walletId}/members/${memberSubject}`, action: "upsert", outcome: "success" });
      success(res, updated);
      return;
    }
    if (req.method === "DELETE") {
      const removed = await serialized(async () => {
        const next = await getStore();
        assertWalletAccess(next, identity, walletId, "owner");
        const existing = next.creditWalletMembers[memberKey];
        if (!existing) return false;
        if (existing.role === "owner") {
          const ownerCount = listWalletMembers(next, identity.tenantId, walletId).filter((entry) => entry.role === "owner").length;
          if (ownerCount <= 1) throw gatewayError(409, "WALLET_OWNER_REQUIRED", "共享钱包必须至少保留一个 owner 角色");
        }
        delete next.creditWalletMembers[memberKey];
        await saveStore(next);
        return true;
      });
      await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `wallets/${walletId}/members/${memberSubject}`, action: removed ? "remove" : "remove_missing", outcome: removed ? "success" : "deny" });
      success(res, { removed });
      return;
    }
    throw gatewayError(405, "METHOD_NOT_ALLOWED", "钱包成员接口只接受 PUT/DELETE");
  }
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const tail = url.pathname.split("/").pop();
  if (tail === "members" && req.method === "GET") {
    const current = await getStore();
    assertWalletAccess(current, identity, walletId, "viewer");
    success(res, listWalletMembers(current, identity.tenantId, walletId));
    return;
  }
  if (tail === "ledger" && req.method === "GET") {
    const current = await getStore();
    assertWalletAccess(current, identity, walletId, "viewer");
    const limit = boundedNumber(url.searchParams.get("limit") ?? undefined, 100, 1, 500);
    const entries = current.creditLedger.filter((entry) => entry.tenantId === identity.tenantId && entry.walletId === walletId).slice(-limit).reverse();
    success(res, entries);
    return;
  }
  if ((tail === "credits" || tail === undefined) && req.method === "GET") {
    const current = await getStore();
    assertWalletAccess(current, identity, walletId, "viewer");
    const account = accountForWallet(current, identity.tenantId, walletId);
    success(res, { ...account, available: account.balance - account.reserved });
    return;
  }
  if (req.method === "GET") {
    const current = await getStore();
    const access = assertWalletAccess(current, identity, walletId, "viewer");
    success(res, { ...access.wallet, members: listWalletMembers(current, identity.tenantId, walletId) });
    return;
  }
  if (req.method === "PATCH") {
    const current = await getStore();
    assertWalletAccess(current, identity, walletId, "owner");
    const input = await body(req) as { name?: unknown; status?: unknown };
    const updates: Partial<CreditWallet> = {};
    if (input.name !== undefined) updates.name = normalizeWalletName(input.name);
    if (input.status !== undefined) updates.status = normalizeWalletStatus(input.status);
    if (Object.keys(updates).length === 0) throw gatewayError(400, "INVALID_WALLET_UPDATE", "钱包更新字段不能为空");
    const updated = await serialized(async () => {
      const next = await getStore();
      assertWalletAccess(next, identity, walletId, "owner");
      const existing = findWallet(next, identity.tenantId, walletId);
      if (!existing) throw gatewayError(404, "WALLET_NOT_FOUND", "共享钱包不存在");
      const nextWallet: CreditWallet = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      next.creditWallets[walletAccountKey(identity.tenantId, walletId)] = nextWallet;
      await saveStore(next);
      return nextWallet;
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `wallets/${walletId}`, action: "update", outcome: "success" });
    success(res, updated);
    return;
  }
  throw gatewayError(405, "METHOD_NOT_ALLOWED", "钱包接口方法不支持");
}

async function handleBilling(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, operation?: string, orderNo?: string): Promise<void> {
  const requestId = randomUUID();
  const url = new URL(req.url ?? "/", "http://gateway.invalid");
  const current = await serialized(async () => {
    const next = await getStore();
    const pendingExpired = expirePendingBillingOrders(next).length > 0;
    const entitlementsExpired = expireBillingEntitlements(next, identity.tenantId);
    if (pendingExpired || entitlementsExpired) await saveStore(next);
    return next;
  });
  assertTenantActive(tenantPolicy(current, identity.tenantId));
  const plans = billingPlans(current);
  if (operation === "subscription" && req.method === "GET") {
    assertBillingSubscriptionRead(identity);
    const subscription = current.billingSubscriptions[identity.tenantId];
    success(res, subscription ? billingSubscriptionView(subscription) : null);
    return;
  }
  if (operation === "plans" && req.method === "GET") {
    success(res, Object.values(plans).filter((plan) => plan.active));
    return;
  }
  if (operation === "plans" && req.method === "PATCH") {
    assertBillingCatalogAdmin(identity);
    const input = await body(req) as BillingPlanInput;
    const id = normalizeBillingPlanId(input.id);
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
    if (!name) throw gatewayError(400, "INVALID_BILLING_PLAN_NAME", "套餐名称不能为空");
    const priceMinor = creditAmount(input.priceMinor, "priceMinor", 10_000_000_000);
    const points = creditAmount(input.points, "points", 10_000_000_000);
    if (points < 1) throw gatewayError(400, "INVALID_BILLING_PLAN_POINTS", "套餐积分必须大于 0");
    const features = Array.isArray(input.features) ? input.features.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().slice(0, 120)).filter(Boolean).slice(0, 32) : [];
    const entitlements = normalizeBillingEntitlements(input) ?? {};
    if (entitlements.newApiGroup && !newApiCredential(entitlements.newApiGroup)) throw gatewayError(400, "NEW_API_GROUP_NOT_CONFIGURED", "套餐指定的 New API Group 尚未配置服务端凭据");
    const updated = await serialized(async () => {
      const next = await getStore();
      const pointsValidDays = input.pointsValidDays === undefined ? undefined : creditAmount(input.pointsValidDays, "pointsValidDays", 3650);
      if (pointsValidDays !== undefined && pointsValidDays < 1) throw gatewayError(400, "INVALID_POINTS_VALID_DAYS", "积分有效期必须至少为 1 天");
      const entitlementsValidDays = input.entitlementsValidDays === undefined ? undefined : creditAmount(input.entitlementsValidDays, "entitlementsValidDays", 3650);
      if (entitlementsValidDays !== undefined && entitlementsValidDays < 1) throw gatewayError(400, "INVALID_ENTITLEMENTS_VALID_DAYS", "权益有效期必须至少为 1 天");
      const plan: BillingPlan = { id, name, ...(typeof input.description === "string" && input.description.trim() ? { description: input.description.trim().slice(0, 500) } : {}), currency: normalizeCurrency(input.currency), priceMinor, points, active: input.active !== false, features, ...entitlements, ...(pointsValidDays === undefined ? {} : { pointsValidDays }), ...(entitlementsValidDays === undefined ? {} : { entitlementsValidDays }), updatedAt: new Date().toISOString(), updatedBy: identity.subject };
      next.billingPlans[id] = plan;
      await saveStore(next);
      return plan;
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `billing/plans/${id}`, action: "update", outcome: "success" });
    success(res, updated);
    return;
  }
  if (operation === "orders" && req.method === "GET") {
    const subject = normalizedCreditSubject(url.searchParams.get("subject"), identity.subject);
    assertCreditRead(identity, subject);
    const limit = boundedNumber(url.searchParams.get("limit") ?? undefined, 100, 1, 500);
    const orders = (Object.values(current.billingOrders) as BillingOrder[]).filter((order) => order.tenantId === identity.tenantId && order.subject === subject).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    success(res, orders);
    return;
  }
  if (operation === "orders" && req.method === "POST") {
    const input = await body(req) as BillingOrderInput & { walletId?: unknown };
    const planId = normalizeBillingPlanId(input.planId);
    const plan = plans[planId];
    if (!plan || !plan.active) throw gatewayError(404, "BILLING_PLAN_NOT_FOUND", "套餐不存在或已下架");
    const idempotencyKey = creditIdempotency(input.idempotencyKey ?? requestId);
    const walletId = typeof input.walletId === "string" && input.walletId.trim() ? normalizeWalletId(input.walletId) : "";
    if (walletId) {
      const state = await getStore();
      assertWalletAccess(state, identity, walletId, "spender");
    }
    const requestedSubject = walletId ? `wallet:${walletId}` : normalizedCreditSubject(input.subject, identity.subject);
    if (!walletId && requestedSubject !== identity.subject) assertCreditAdmin(identity);
    const expiresInSeconds = input.expiresInSeconds === undefined ? 1800 : creditAmount(input.expiresInSeconds, "expiresInSeconds", 86_400);
    if (expiresInSeconds < 60) throw gatewayError(400, "INVALID_ORDER_EXPIRY", "订单有效期至少为 60 秒");
    const created = await serialized(async () => {
      const next = await getStore();
      const existing = billingOrderByIdempotency(next, identity.tenantId, requestedSubject, idempotencyKey);
      if (existing) {
        if (existing.planId !== planId) throw gatewayError(409, "BILLING_ORDER_IDEMPOTENCY_CONFLICT", "幂等键已用于其他套餐订单");
        return existing;
      }
      const now = new Date();
      const orderNo = `ob_${now.getTime().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const orderEntitlements = walletId ? {} : normalizeBillingEntitlements(plan) ?? {};
      const order: BillingOrder = { id: randomUUID(), orderNo, tenantId: identity.tenantId, subject: requestedSubject, ...(walletId ? { walletId } : {}), planId, points: plan.points, amountMinor: plan.priceMinor, currency: plan.currency, status: "pending", idempotencyKey, ...(plan.pointsValidDays === undefined ? {} : { pointsValidDays: plan.pointsValidDays }), ...(!walletId && plan.entitlementsValidDays !== undefined ? { entitlementsValidDays: plan.entitlementsValidDays } : {}), entitlements: orderEntitlements, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString() };
      next.billingOrders[orderNo] = order;
      await saveStore(next);
      return order;
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `billing/orders/${created.orderNo}`, action: "create", outcome: "success" });
    success(res, created, 201);
    return;
  }
  if ((operation === "refund" || operation === "expire") && req.method === "POST" && orderNo) {
    assertCreditAdmin(identity);
    const result = await serialized(async () => {
      const next = await getStore();
      const order = billingOrderFor(next, orderNo);
      if (order.tenantId !== identity.tenantId) throw gatewayError(404, "BILLING_ORDER_NOT_FOUND", "订单不存在");
      if (operation === "expire") {
        if (order.status === "expired") return order;
        if (order.status !== "pending") throw gatewayError(409, "BILLING_ORDER_NOT_EXPIRABLE", "只有待支付订单可以过期");
        const now = new Date().toISOString();
        const updated: BillingOrder = { ...order, status: "expired", updatedAt: now };
        next.billingOrders[order.orderNo] = updated;
        await saveStore(next);
        return updated;
      }
      if (order.status === "refunded") return order;
      if (order.status !== "paid") throw gatewayError(409, "BILLING_ORDER_NOT_REFUNDABLE", "只有已支付订单可以退款");
    const previous = order.walletId ? accountForWallet(next, order.tenantId, order.walletId) : accountFor(next, order.tenantId, order.subject);
      if (refundablePurchasePoints(next, order) < order.points) throw gatewayError(409, "BILLING_REFUND_POINTS_CONSUMED", "订单积分已被消费或过期，不能执行全额退款");
      if (previous.balance - previous.reserved < order.points) throw gatewayError(409, "BILLING_REFUND_BALANCE_INSUFFICIENT", "当前可用余额不足以冲销订单积分");
      const now = new Date().toISOString();
      const updated: BillingOrder = { ...order, status: "refunded", refundedAt: now, updatedAt: now };
      next.billingOrders[order.orderNo] = updated;
      next.creditAccounts[order.walletId ? walletAccountKey(order.tenantId, order.walletId) : creditKey(order.tenantId, order.subject)] = { ...previous, balance: previous.balance - order.points, lifetimeRefunded: previous.lifetimeRefunded + order.points, ...(order.walletId ? { walletId: order.walletId } : {}), updatedAt: now, version: previous.version + 1 };
      appendCreditLedgerEntry(next, creditEntry({ tenantId: order.tenantId, subject: order.subject, ...(order.walletId ? { walletId: order.walletId } : {}), type: "refund", amount: order.points, orderId: order.orderNo, paymentId: order.paymentId, paymentChannel: order.paymentChannel, amountMinor: order.amountMinor, currency: order.currency, pointsSettled: -order.points, idempotencyKey: `refund:${order.orderNo}`, reason: "订单退款", createdBy: identity.subject }));
      const subscription = order.walletId ? undefined : next.billingSubscriptions[order.tenantId];
      if (subscription?.orderNo === order.orderNo && subscription.status === "active") {
        subscription.status = "cancelled";
        subscription.endedAt = now;
        const currentPolicy = tenantPolicy(next, order.tenantId);
        const previousOrder = previousPaidBillingOrder(next, order.tenantId, order.orderNo);
        if (previousOrder) {
          const restoredPolicy = applyBillingEntitlements(currentPolicy, previousOrder.entitlements ?? {}, "billing-refund");
          next.tenantPolicies[order.tenantId] = restoredPolicy;
          next.billingSubscriptions[order.tenantId] = {
            tenantId: order.tenantId,
            subject: previousOrder.subject,
            planId: previousOrder.planId,
            orderNo: previousOrder.orderNo,
            status: "active",
            entitlements: previousOrder.entitlements ?? {},
            startedAt: previousOrder.paidAt ?? previousOrder.updatedAt,
            ...(previousOrder.entitlementsExpiresAt ? { entitlementsExpiresAt: previousOrder.entitlementsExpiresAt } : {}),
            appliedPolicyVersion: restoredPolicy.version,
            ...(subscription.previousPolicy ? { previousPolicy: subscription.previousPolicy } : {}),
          };
        } else if (subscription.previousPolicy) {
          next.tenantPolicies[order.tenantId] = { ...subscription.previousPolicy, version: currentPolicy.version + 1, updatedAt: now, updatedBy: identity.subject };
        }
      }
      await saveStore(next);
      return updated;
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `billing/orders/${orderNo}`, action: operation, outcome: "success" });
    success(res, result);
    return;
  }
  throw gatewayError(405, "METHOD_NOT_ALLOWED", "商业计费接口不支持当前方法");
}

async function handleBillingCallback(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  const secret = runtimeSecret("RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET", billingCallbackSecret);
  if (!secret) throw gatewayError(503, "BILLING_CALLBACK_DISABLED", "网关未配置支付回调签名密钥");
  if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "支付回调只接受 POST");
  const signature = (req.headers["x-openbuddy-billing-signature"] ?? req.headers["x-billing-signature"] ?? "").toString();
  const { raw, value } = await bodyWithRaw(req);
  if (!signature || !billingSignature(raw, signature, secret)) throw gatewayError(401, "BILLING_CALLBACK_SIGNATURE_INVALID", "支付回调签名校验失败");
  const input = value as BillingCallbackInput;
  const orderNo = normalizeBillingOrderNo(input.orderNo);
  const status = billingStatus(input.status);
  if (!["paid", "failed", "cancelled"].includes(status)) throw gatewayError(400, "BILLING_CALLBACK_STATUS_UNSUPPORTED", "支付回调只支持 paid、failed 或 cancelled");
  const paymentId = normalizePaymentValue(input.paymentId, "paymentId");
  const paymentChannel = normalizePaymentValue(input.paymentChannel, "paymentChannel", 80);
  if (status === "paid" && !paymentId) throw gatewayError(400, "BILLING_PAYMENT_ID_REQUIRED", "支付成功回调必须包含支付流水号");
  if (status === "paid" && !paymentChannel) throw gatewayError(400, "BILLING_PAYMENT_CHANNEL_REQUIRED", "支付成功回调必须包含支付渠道");
  if (status === "paid" && input.amountMinor === undefined) throw gatewayError(400, "BILLING_AMOUNT_REQUIRED", "支付成功回调必须包含订单金额");
  if (status === "paid" && input.currency === undefined) throw gatewayError(400, "BILLING_CURRENCY_REQUIRED", "支付成功回调必须包含订单币种");
  const updated = await serialized(async () => {
    const next = await getStore();
    const order = billingOrderFor(next, orderNo);
    if (expireBillingEntitlements(next, order.tenantId)) await saveStore(next);
    if (paymentId) {
      const existingPayment = findBillingOrderByPayment(next, paymentId, paymentChannel, orderNo);
      if (existingPayment) throw gatewayError(409, "BILLING_PAYMENT_REPLAY_CONFLICT", "支付流水号已归属其他订单，拒绝重复入账");
    }
    if (input.amountMinor !== undefined && creditAmount(input.amountMinor, "amountMinor", 10_000_000_000) !== order.amountMinor) throw gatewayError(409, "BILLING_AMOUNT_MISMATCH", "支付回调金额与订单金额不一致");
    if (input.currency !== undefined && normalizeCurrency(input.currency) !== order.currency) throw gatewayError(409, "BILLING_CURRENCY_MISMATCH", "支付回调币种与订单币种不一致");
    if (order.status === status) {
      if ((paymentId && order.paymentId && paymentId !== order.paymentId) || (paymentChannel && order.paymentChannel && paymentChannel !== order.paymentChannel)) {
        throw gatewayError(409, "BILLING_CALLBACK_REPLAY_CONFLICT", "重复支付回调的支付标识与已记录事件不一致");
      }
      return order;
    }
    if (order.status !== "pending") throw gatewayError(409, "BILLING_ORDER_STATE_CONFLICT", "订单已经完成或关闭，不能重复回调");
    if (new Date(order.expiresAt).getTime() <= Date.now()) {
      const expired: BillingOrder = { ...order, status: "expired", updatedAt: new Date().toISOString() };
      next.billingOrders[orderNo] = expired;
      await saveStore(next);
      throw gatewayError(409, "BILLING_ORDER_EXPIRED", "订单已过期");
    }
    const now = new Date().toISOString();
    const updatedOrder: BillingOrder = { ...order, status, updatedAt: now, ...(paymentId ? { paymentId } : {}), ...(paymentChannel ? { paymentChannel } : {}), ...(status !== "paid" ? { failureReason: normalizePaymentValue(input.failureReason, "failureReason", 240) } : { paidAt: now }) };
    next.billingOrders[orderNo] = updatedOrder;
    if (status === "paid") {
      const previous = order.walletId ? accountForWallet(next, order.tenantId, order.walletId) : accountFor(next, order.tenantId, order.subject);
      next.creditAccounts[order.walletId ? walletAccountKey(order.tenantId, order.walletId) : creditKey(order.tenantId, order.subject)] = { ...previous, balance: previous.balance + order.points, lifetimeGranted: previous.lifetimeGranted + order.points, ...(order.walletId ? { walletId: order.walletId } : {}), plan: order.planId, updatedAt: now, version: previous.version + 1 };
      const pointsExpiresAt = order.pointsValidDays === undefined ? undefined : new Date(Date.parse(now) + order.pointsValidDays * 86_400_000).toISOString();
      const entitlementsExpiresAt = order.entitlementsValidDays === undefined ? undefined : new Date(Date.parse(now) + order.entitlementsValidDays * 86_400_000).toISOString();
      const paidOrder = pointsExpiresAt || entitlementsExpiresAt ? { ...updatedOrder, ...(pointsExpiresAt ? { pointsExpiresAt } : {}), ...(entitlementsExpiresAt ? { entitlementsExpiresAt } : {}) } : updatedOrder;
      next.billingOrders[order.orderNo] = paidOrder;
      appendCreditLedgerEntry(next, creditEntry({ tenantId: order.tenantId, subject: order.subject, ...(order.walletId ? { walletId: order.walletId } : {}), type: "purchase", amount: order.points, orderId: order.orderNo, paymentId, paymentChannel, amountMinor: order.amountMinor, currency: order.currency, pointsSettled: order.points, ...(pointsExpiresAt ? { expiresAt: pointsExpiresAt } : {}), idempotencyKey: `purchase:${order.orderNo}`, reason: "支付成功充值", createdBy: "billing-callback" }));
      if (!order.walletId) {
        const previousSubscription = next.billingSubscriptions[order.tenantId];
        const previousPolicy = tenantPolicy(next, order.tenantId);
        const entitlementPolicy = applyBillingEntitlements(previousPolicy, order.entitlements ?? {}, "billing-callback");
        next.tenantPolicies[order.tenantId] = entitlementPolicy;
        next.billingSubscriptions[order.tenantId] = { tenantId: order.tenantId, subject: order.subject, planId: order.planId, orderNo: order.orderNo, status: "active", entitlements: order.entitlements ?? {}, startedAt: now, ...(entitlementsExpiresAt ? { entitlementsExpiresAt } : {}), appliedPolicyVersion: entitlementPolicy.version, previousPolicy: previousSubscription?.previousPolicy ?? previousPolicy };
      }
    }
    await saveStore(next);
    return next.billingOrders[order.orderNo] ?? updatedOrder;
  });
  await audit({ requestId, at: new Date().toISOString(), subject: updated.subject, tenantId: updated.tenantId, resource: `billing/orders/${updated.orderNo}`, action: `payment.${status}`, outcome: "success" });
  success(res, { orderNo: updated.orderNo, status: updated.status, paidAt: updated.paidAt });
}

function assertTenantLifecycleAccess(identity: JwtIdentity): void {
  if (!isGlobalAdmin(identity.claims) && !hasNamedPermission(identity.claims, ["tenant.lifecycle.write"])) {
    throw gatewayError(403, "PERMISSION_DENIED", "当前主体没有租户生命周期权限");
  }
}

async function assertMemberNotRevoked(identity: JwtIdentity): Promise<void> {
  if (isGlobalAdmin(identity.claims)) return;
  const store = await getStore();
  if (store.memberRevocations[identity.tenantId]?.[identity.subject] || store.memberRevocations[identity.tenantId]?.["*"]) {
    throw gatewayError(403, "TENANT_MEMBER_REVOKED", "当前主体已被租户管理员撤销访问");
  }
}

async function readTenantAudit(tenantId: string, limit: number): Promise<AuditEvent[]> {
  return storeAdapter.listAudit(tenantId, limit);
}

async function handleTenantControl(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, action: "policy" | "runtime" | "runtime-usage" | "audit"): Promise<void> {
  const requestId = randomUUID();
  const current = await currentTenantStore(identity.tenantId);
  if (action === "audit") {
    if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", "审计接口只支持读取");
    assertTenantAuditAccess(identity);
    const query = new URL(req.url ?? "/", "http://gateway.invalid").searchParams;
    const limit = boundedNumber(query.get("limit") ?? undefined, 100, 1, 500);
    const events = await readTenantAudit(identity.tenantId, limit);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "tenant-audit", action: "read", outcome: "success" });
    success(res, events);
    return;
  }
  if (action === "runtime") {
    if (req.method !== "GET") throw gatewayError(405, "METHOD_NOT_ALLOWED", "运行策略只支持读取");
    const policy = effectiveTenantPolicy(current, identity.tenantId);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "tenant-runtime-policy", action: "read", outcome: "success" });
    success(res, policy);
    return;
  }
  if (action === "runtime-usage") {
    if (req.method !== "POST") throw gatewayError(405, "METHOD_NOT_ALLOWED", "运行用量只支持写入");
    assertTenantUsageAccess(identity);
    const input = await body(req) as { tokens?: unknown; points?: unknown };
    const tokens = Number(input.tokens);
    if (!Number.isInteger(tokens) || tokens < 0 || tokens > 10_000_000) throw gatewayError(400, "INVALID_RUNTIME_USAGE", "运行 token 用量无效");
    const points = input.points === undefined ? 0 : Number(input.points);
    if (!Number.isSafeInteger(points) || points < 0 || points > 1_000_000_000) throw gatewayError(400, "INVALID_RUNTIME_POINTS", "运行积分用量无效");
    const updated = await serialized(async () => {
      const next = await getStore();
      assertTenantActive(tenantPolicy(next, identity.tenantId));
      const previous = todayRuntimeUsage(next, identity.tenantId);
      next.runtimeUsage[identity.tenantId] = { ...previous, tokens: Math.min(2_000_000_000, previous.tokens + tokens), points: (previous.points ?? 0) + points };
      await saveStore(next);
      return effectiveTenantPolicy(next, identity.tenantId);
    });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "tenant-runtime-policy", action: "usage", outcome: "success" });
    success(res, updated);
    return;
  }
  if (req.method === "GET") {
    assertTenantPolicyAccess(identity, "read");
    const policy = tenantPolicy(current, identity.tenantId);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "tenant-policy", action: "read", outcome: "success" });
    success(res, policy);
    return;
  }
  if (req.method !== "PATCH") throw gatewayError(405, "METHOD_NOT_ALLOWED", "租户策略只支持读取和更新");
  assertTenantPolicyAccess(identity, "write");
  const input = await body(req) as TenantPolicyPatch;
  const expectedVersion = input.expectedVersion === undefined ? undefined : Number(input.expectedVersion);
  if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) throw gatewayError(400, "INVALID_TENANT_POLICY_VERSION", "租户策略版本无效");
  const status = input.status === undefined ? undefined : input.status === "active" || input.status === "suspended" || input.status === "archived" ? input.status : undefined;
  if (input.status !== undefined && !status) throw gatewayError(400, "INVALID_TENANT_STATUS", "租户状态无效");
  const max = input.maxResources === undefined ? undefined : Number(input.maxResources);
  if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > maxResources)) throw gatewayError(400, "INVALID_TENANT_QUOTA", "租户资源配额无效");
  const modelAllowlist = input.modelAllowlist === undefined ? undefined : normalizeAllowlist(input.modelAllowlist);
  const mcpAllowlist = input.mcpAllowlist === undefined ? undefined : normalizeAllowlist(input.mcpAllowlist);
  if (input.modelAllowlist !== undefined && !modelAllowlist) throw gatewayError(400, "INVALID_MODEL_ALLOWLIST", "模型白名单无效");
  if (input.mcpAllowlist !== undefined && !mcpAllowlist) throw gatewayError(400, "INVALID_MCP_ALLOWLIST", "MCP 白名单无效");
  if (input.killSwitch !== undefined && typeof input.killSwitch !== "boolean") throw gatewayError(400, "INVALID_KILL_SWITCH", "kill switch 值无效");
  const maxTokensPerDay = input.maxTokensPerDay === undefined ? undefined : Number(input.maxTokensPerDay);
  if (maxTokensPerDay !== undefined && (!Number.isInteger(maxTokensPerDay) || maxTokensPerDay < 0)) throw gatewayError(400, "INVALID_TOKEN_QUOTA", "每日 token 配额无效");
  const maxPointsPerDay = input.maxPointsPerDay === undefined ? undefined : Number(input.maxPointsPerDay);
  if (maxPointsPerDay !== undefined && (!Number.isSafeInteger(maxPointsPerDay) || maxPointsPerDay < 0)) throw gatewayError(400, "INVALID_POINTS_QUOTA", "每日积分预算无效");
  const newApiGroup = input.newApiGroup === undefined ? undefined : normalizeNewApiGroup(input.newApiGroup);
  if (input.newApiGroup !== undefined && typeof input.newApiGroup !== "string") throw gatewayError(400, "INVALID_NEW_API_GROUP", "New API Group 无效");
  if (typeof input.newApiGroup === "string" && input.newApiGroup.trim() && !newApiGroup) throw gatewayError(400, "INVALID_NEW_API_GROUP", "New API Group 无效");
  if (newApiGroup && !newApiCredential(newApiGroup)) throw gatewayError(400, "NEW_API_GROUP_NOT_CONFIGURED", "New API Group 尚未配置服务端凭据");
  const updated = await serialized(async () => {
    const next = await getStore();
    const previous = tenantPolicy(next, identity.tenantId);
    if (status === "archived" || previous.status === "archived") assertTenantLifecycleAccess(identity);
    if (expectedVersion !== undefined && expectedVersion !== previous.version) throw gatewayError(409, "TENANT_POLICY_VERSION_CONFLICT", "租户策略已被其他管理员更新，请刷新后重试");
    const clearedGroup = input.newApiGroup !== undefined && input.newApiGroup.trim() === "";
    const policy: TenantPolicy = { ...previous, version: previous.version + 1, ...(status ? { status } : {}), ...(max !== undefined ? { maxResources: max } : {}), ...(modelAllowlist === undefined ? {} : { modelAllowlist }), ...(mcpAllowlist === undefined ? {} : { mcpAllowlist }), ...(input.killSwitch === undefined ? {} : { killSwitch: input.killSwitch }), ...(maxTokensPerDay === undefined ? {} : { maxTokensPerDay }), ...(maxPointsPerDay === undefined ? {} : { maxPointsPerDay }), ...(clearedGroup ? {} : newApiGroup === undefined ? {} : { newApiGroup: newApiGroup || undefined }), updatedAt: new Date().toISOString(), updatedBy: identity.subject };
    if (clearedGroup) delete policy.newApiGroup;
    next.tenantPolicies[identity.tenantId] = policy;
    await saveStore(next);
    return policy;
  });
  await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: "tenant-policy", action: "update", outcome: "success" });
  success(res, updated);
}

async function handleMemberRevocation(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, subject?: string): Promise<void> {
  const requestId = randomUUID();
  assertTenantLifecycleAccess(identity);
  if (req.method === "GET" && subject === undefined) {
    const store = await getStore();
    const entries = Object.values(store.memberRevocations[identity.tenantId] ?? {}).map(({ subject: memberSubject, revokedAt, revokedBy, reason }) => ({ subject: memberSubject, revoked: true, revokedAt, revokedBy, ...(reason ? { reason } : {}) }));
    success(res, entries);
    return;
  }
  if (req.method !== "PATCH" || subject === undefined) throw gatewayError(405, "METHOD_NOT_ALLOWED", "成员撤销接口支持 GET 列表和 PATCH 单成员变更");
  const normalizedSubject = normalizeSubject(subject);
  if (!normalizedSubject) throw gatewayError(400, "INVALID_MEMBER_SUBJECT", "成员主体标识无效");
  const input = await body(req) as { revoked?: unknown; reason?: unknown };
  if (typeof input.revoked !== "boolean") throw gatewayError(400, "INVALID_MEMBER_REVOCATION", "需要明确的 revoked 布尔值");
  const result = await serialized(async () => {
    const next = await getStore();
    const tenantEntries = next.memberRevocations[identity.tenantId] ?? {};
    if (input.revoked) {
      const reason = normalizeRevocationReason(input.reason);
      tenantEntries[normalizedSubject] = { subject: normalizedSubject, revokedAt: new Date().toISOString(), revokedBy: identity.subject, ...(reason ? { reason } : {}) };
    } else {
      delete tenantEntries[normalizedSubject];
    }
    if (Object.keys(tenantEntries).length) next.memberRevocations[identity.tenantId] = tenantEntries;
    else delete next.memberRevocations[identity.tenantId];
    await saveStore(next);
    const entry = next.memberRevocations[identity.tenantId]?.[normalizedSubject];
    return { subject: normalizedSubject, revoked: input.revoked, ...(entry ? { revokedAt: entry.revokedAt, revokedBy: entry.revokedBy, ...(entry.reason ? { reason: entry.reason } : {}) } : {}) };
  });
  await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `member/${normalizedSubject}`, action: input.revoked ? "revoke" : "restore", outcome: "success", reason: normalizeRevocationReason(input.reason) });
  success(res, result);
}

async function handleSession(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, sessionId?: string): Promise<void> {
  const requestId = randomUUID();
  if (req.method === "GET" && sessionId === undefined) {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    const limit = boundedNumber(url.searchParams.get("limit") ?? undefined, 200, 1, 1000);
    const sessions = await storeAdapter.listSessions(identity.tenantId, limit);
    success(res, sessions);
    return;
  }
  if (req.method === "POST" && sessionId === undefined) {
    const input = await body(req) as { sessionId?: unknown; subject?: unknown; deviceFingerprint?: unknown; kind?: unknown; scopes?: unknown; metadata?: unknown };
    const parsedSessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
    const parsedSubject = typeof input.subject === "string" ? input.subject.trim() : identity.subject;
    const kindRaw = typeof input.kind === "string" ? input.kind.trim() : "";
    const scopes = Array.isArray(input.scopes) ? input.scopes.filter((value): value is string => typeof value === "string") : [];
    const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata as Record<string, string | number | boolean | null> : undefined;
    if (!parsedSessionId) throw gatewayError(400, "INVALID_SESSION_ID", "需要提供 sessionId");
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(parsedSessionId)) throw gatewayError(400, "INVALID_SESSION_ID", "sessionId 仅支持字母数字与 _.:-，长度 1-128");
    if (!parsedSubject) throw gatewayError(400, "INVALID_SESSION_SUBJECT", "session 必须绑定 subject");
    if (parsedSubject !== identity.subject && !isAdmin(identity.claims)) throw gatewayError(403, "PERMISSION_DENIED", "session 只能注册到当前主体");
    const kind = kindRaw === "desktop" || kindRaw === "web" || kindRaw === "automation" || kindRaw === "team" || kindRaw === "session" ? kindRaw : "desktop";
    const binding = await storeAdapter.registerSession(identity.tenantId, { sessionId: parsedSessionId, subject: parsedSubject, kind, scopes, startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), ...(metadata ? { metadata } : {}) });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `session/${parsedSessionId}`, action: "register", outcome: "success" });
    success(res, binding, 201);
    return;
  }
  if (req.method === "DELETE" && sessionId) {
    const normalized = decodeURIComponent(sessionId);
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(normalized)) throw gatewayError(400, "INVALID_SESSION_ID", "sessionId 仅支持字母数字与 _.:-，长度 1-128");
    const result = await storeAdapter.unregisterSession(identity.tenantId, normalized);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `session/${normalized}`, action: result.removed ? "unregister" : "unregister_missing", outcome: result.removed ? "success" : "deny" });
    success(res, result);
    return;
  }
  throw gatewayError(405, "METHOD_NOT_ALLOWED", "session 接口支持 GET 列表、POST 注册、DELETE 注销");
}

async function handleResource(req: IncomingMessage, res: ServerResponse, identity: JwtIdentity, type?: CasdoorResourceType, id?: string): Promise<void> {
  const requestId = randomUUID();
  const method = req.method ?? "GET";
  const query = new URL(req.url ?? "/", "http://gateway.invalid").searchParams;
  const current = await getStore();
  const policy = tenantPolicy(current, identity.tenantId);
  if (method === "GET") assertTenantReadable(policy);
  else assertTenantActive(policy);
  if (method === "GET" && id) {
    const record = current.resources.find((entry) => entry.id === id && entry.tenantId === identity.tenantId);
    if (!record) throw gatewayError(404, "RESOURCE_NOT_FOUND", "企业资源不存在");
    authorize(identity, record.type, "read", record);
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: `${record.type}/${record.id}`, action: "read", outcome: "success" });
    success(res, { ...record, encryption: summarizeEncryption(record.metadata) });
    return;
  }
  if (method === "GET") {
    const resources = current.resources.filter((entry) => entry.tenantId === identity.tenantId && (!type || entry.type === type));
    const visible = resources.filter((entry) => { try { authorize(identity, entry.type, "read", entry); return true; } catch { return false; } });
    await audit({ requestId, at: new Date().toISOString(), subject: identity.subject, tenantId: identity.tenantId, resource: type, action: "read", outcome: "success" });
    success(res, visible.map((entry) => ({ ...entry, encryption: summarizeEncryption(entry.metadata) })));
    return;
  }
  if (method === "POST" && !id) {
    const input = await body(req) as Partial<CasdoorResourceCreateInput>;
    if (!isCasdoorResourceType(input.type)) throw gatewayError(400, "INVALID_RESOURCE_TYPE", "企业资源类型无效");
    const name = normalizeCasdoorResourceName(input.name);
    if (!name) throw gatewayError(400, "INVALID_RESOURCE_NAME", "企业资源名称不能为空");
    authorize(identity, input.type, "create");
    const key = normalizeCasdoorResourceIdempotencyKey(req.headers["idempotency-key"] ?? input.idempotencyKey);
    const result = await serialized(async () => {
      const next = await getStore();
      const currentPolicy = tenantPolicy(next, identity.tenantId);
      assertTenantActive(currentPolicy);
      const previousId = key ? next.idempotency[`${identity.tenantId}:${identity.subject}:${key}`] : undefined;
      const previous = previousId ? next.resources.find((entry) => entry.id === previousId) : undefined;
      if (previous) return previous;
      const tenantResourceCount = next.resources.filter((entry) => entry.tenantId === identity.tenantId).length;
      if (tenantResourceCount >= currentPolicy.maxResources) throw gatewayError(429, "TENANT_QUOTA_EXCEEDED", "当前租户资源配额已用尽");
      const now = new Date().toISOString();
      const normalizedMetadata = normalizeCasdoorResourceMetadata(input.metadata);
      const { metadata: finalMetadata, encryptedFieldCount } = encryptMetadata(normalizedMetadata, encryptionContext);
      const record: CasdoorResourceRecord = { id: randomUUID(), tenantId: identity.tenantId, ownerSubject: identity.subject, type: input.type!, name, metadata: finalMetadata, createdAt: now, updatedAt: now, version: 1 };
      await audit({ requestId, at: now, subject: identity.subject, tenantId: identity.tenantId, resource: `${record.type}/${record.id}`, action: "create", outcome: "success", reason: encryptedFieldCount > 0 ? `encrypted_fields=${encryptedFieldCount}` : `name=${record.name}` });
      next.resources = [...next.resources, record].slice(-maxResources);
      if (key) next.idempotency[`${identity.tenantId}:${identity.subject}:${key}`] = record.id;
      await saveStore(next);
      return record;
    });
    success(res, { ...result, encryption: summarizeEncryption(result.metadata) }, 201);
    return;
  }
  if ((method === "PATCH" || method === "DELETE") && id) {
    const input = method === "PATCH" ? await body(req) as Partial<CasdoorResourceUpdateInput> : {};
    const expectedVersion = Number(req.headers["if-match"] ?? input.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw gatewayError(400, "INVALID_VERSION", "需要有效的 If-Match 版本");
    const result = await serialized(async () => {
      const next = await getStore();
      assertTenantActive(tenantPolicy(next, identity.tenantId));
      const index = next.resources.findIndex((entry) => entry.id === id && entry.tenantId === identity.tenantId);
      const record = index >= 0 ? next.resources[index] : undefined;
      if (!record) throw gatewayError(404, "RESOURCE_NOT_FOUND", "企业资源不存在");
      authorize(identity, record.type, method === "PATCH" ? "update" : "delete", record);
      if (record.version !== expectedVersion) throw gatewayError(409, "VERSION_CONFLICT", "企业资源版本已变更，请刷新后重试");
      if (method === "DELETE") { next.resources.splice(index, 1); await saveStore(next); return undefined; }
      const name = input.name === undefined ? record.name : normalizeCasdoorResourceName(input.name);
      if (!name) throw gatewayError(400, "INVALID_RESOURCE_NAME", "企业资源名称不能为空");
      const baseMetadata = input.metadata === undefined ? record.metadata : normalizeCasdoorResourceMetadata(input.metadata);
      const { metadata: finalMetadata, encryptedFieldCount } = encryptMetadata(baseMetadata, encryptionContext);
      const updated: CasdoorResourceRecord = { ...record, name, metadata: finalMetadata, updatedAt: new Date().toISOString(), version: record.version + 1 };
      void audit({ requestId, at: updated.updatedAt, subject: identity.subject, tenantId: identity.tenantId, resource: `${type ?? record.type}/${id}`, action: "update", outcome: "success", reason: encryptedFieldCount > 0 ? `encrypted_fields=${encryptedFieldCount}` : `name=${name}` });
      next.resources[index] = updated;
      await saveStore(next);
      return updated;
    });
    if (!result) {
      success(res, { ok: true });
      return;
    }
    success(res, { ...result, encryption: summarizeEncryption(result.metadata) });
    return;
  }
  throw gatewayError(404, "NOT_FOUND", "资源 API 路径不存在");
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  const trace = deriveTraceContext(req.headers as Record<string, string | string[] | undefined>, true);
  res.setHeader("traceparent", trace.raw);
  res.setHeader("x-trace-id", trace.traceId);
  await withTrace(trace, () => dispatch(req, res, requestId));
}

async function dispatch(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  let identity: JwtIdentity | undefined;
  let requestedTenantId: string | undefined;
  let trackedPath = "/unknown";
  try {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    trackedPath = url.pathname;
    if (url.pathname === "/metrics") {
      trackRequest("/metrics", "success");
      const lines: string[] = [];
      const processSeconds = (Date.now() - metrics.startedAt.getTime()) / 1000;
      lines.push("# HELP openbuddy_gateway_uptime_seconds Process uptime in seconds");
      lines.push("# TYPE openbuddy_gateway_uptime_seconds gauge");
      lines.push(`openbuddy_gateway_uptime_seconds ${processSeconds.toFixed(3)}`);
      lines.push("# HELP openbuddy_gateway_store_kind Storage adapter kind");
      lines.push("# TYPE openbuddy_gateway_store_kind gauge");
      lines.push(`openbuddy_gateway_store_kind{kind="${storeAdapter.kind}"} 1`);
      lines.push("# HELP openbuddy_gateway_http_requests_total HTTP requests by path");
      lines.push("# TYPE openbuddy_gateway_http_requests_total counter");
      for (const [path, count] of metrics.httpRequests.entries()) {
        lines.push(`openbuddy_gateway_http_requests_total{path="${path}"} ${count}`);
      }
      lines.push("# HELP openbuddy_gateway_http_outcomes_total HTTP outcomes by path");
      lines.push("# TYPE openbuddy_gateway_http_outcomes_total counter");
      for (const [key, count] of metrics.httpOutcomes.entries()) {
        const [path, outcome] = key.split("|");
        lines.push(`openbuddy_gateway_http_outcomes_total{path="${path}",outcome="${outcome}"} ${count}`);
      }
      lines.push("# HELP openbuddy_gateway_rate_limited_total Rate-limited requests");
      lines.push("# TYPE openbuddy_gateway_rate_limited_total counter");
      lines.push(`openbuddy_gateway_rate_limited_total ${metrics.rateLimited}`);
      lines.push("# HELP openbuddy_gateway_webhook_accepted_total Accepted Casdoor webhooks");
      lines.push("# TYPE openbuddy_gateway_webhook_accepted_total counter");
      lines.push(`openbuddy_gateway_webhook_accepted_total ${metrics.webhookAccepted}`);
      lines.push("# HELP openbuddy_gateway_webhook_rejected_total Rejected Casdoor webhooks");
      lines.push("# TYPE openbuddy_gateway_webhook_rejected_total counter");
      lines.push(`openbuddy_gateway_webhook_rejected_total ${metrics.webhookRejected}`);
      lines.push("# HELP openbuddy_gateway_audit_events_total Persisted audit events");
      lines.push("# TYPE openbuddy_gateway_audit_events_total counter");
      lines.push(`openbuddy_gateway_audit_events_total ${metrics.auditEvents}`);
      lines.push("# HELP openbuddy_gateway_new_api_circuit_opened_total New API circuit openings");
      lines.push("# TYPE openbuddy_gateway_new_api_circuit_opened_total counter");
      lines.push(`openbuddy_gateway_new_api_circuit_opened_total ${metrics.newApiCircuitOpened}`);
      lines.push("# HELP openbuddy_gateway_new_api_circuit_rejected_total Requests rejected by an open New API circuit");
      lines.push("# TYPE openbuddy_gateway_new_api_circuit_rejected_total counter");
      lines.push(`openbuddy_gateway_new_api_circuit_rejected_total ${metrics.newApiCircuitRejected}`);
      lines.push("# HELP openbuddy_gateway_new_api_circuit_recovered_total New API circuits recovered through a half-open probe");
      lines.push("# TYPE openbuddy_gateway_new_api_circuit_recovered_total counter");
      lines.push(`openbuddy_gateway_new_api_circuit_recovered_total ${metrics.newApiCircuitRecovered}`);
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(lines.join("\n") + "\n");
      return;
    }
    if (url.pathname === "/healthz") {
      const health = await storeAdapter.health();
      const version = process.env.RESOURCE_GATEWAY_VERSION?.trim() || "dev";
      trackRequest("/healthz", "success");
      success(res, { ok: health.ok, store: storeAdapter.kind, version, latencyMs: health.latencyMs, error: health.error });
      return;
    }
    if (url.pathname === "/v1/webhooks/casdoor") {
      await handleWebhook(req, res, requestId);
      return;
    }
    if (url.pathname === "/v1/backchannel-logout/casdoor") {
      await handleBackchannelLogout(req, res, requestId);
      return;
    }
    if (url.pathname === "/v1/billing/callback") {
      await handleBillingCallback(req, res, requestId);
      return;
    }
    if (url.pathname === "/readyz") { await checkReadiness(); success(res, { ok: true }); return; }
    await enforceRateLimit(req, res);
    if (url.pathname === "/v1/token-exchange/weknora/introspect") {
      await handleWeKnoraTokenIntrospection(req, res);
      return;
    }
    if (url.pathname === "/internal/v1/credits/expire") {
      await handleInternalCreditExpiry(req, res);
      return;
    }
    const internalCostImportMatch = url.pathname.match(/^\/internal\/v1\/tenants\/([^\/]+)\/credits\/reconciliation\/import$/);
    if (internalCostImportMatch) {
      const tenantId = decodeURIComponent(internalCostImportMatch[1]);
      await handleInternalNewApiCostImport(req, res, tenantId);
      return;
    }
    if (url.pathname === "/v1/token-exchange/weknora") {
      await handleWeKnoraTokenExchange(req, res, requestId);
      return;
    }
    if (url.pathname === "/v1/token-exchange/weknora/refresh") {
      await handleWeKnoraTokenRefresh(req, res, requestId);
      return;
    }
    const healthMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/health$/);
    if (healthMatch) {
      const tenantId = decodeURIComponent(healthMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleTenantHealth(res, identity);
      return;
    }
    const archiveMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/audit-archive$/);
    if (archiveMatch) {
      const tenantId = decodeURIComponent(archiveMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleAuditArchive(req, res, identity);
      return;
    }
    const auditExportMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/audit-export$/);
    if (auditExportMatch) {
      const tenantId = decodeURIComponent(auditExportMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleAuditExport(req, res, identity);
      return;
    }
    const controlMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/(policy|runtime-policy|runtime-usage|audit)$/);
    if (controlMatch) {
      const tenantId = decodeURIComponent(controlMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleTenantControl(req, res, identity, controlMatch[2] === "runtime-policy" ? "runtime" : controlMatch[2] === "runtime-usage" ? "runtime-usage" : controlMatch[2] as "policy" | "audit");
      return;
    }
    const reconciliationMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/credits\/reconciliation$/);
    const reconciliationExportMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/credits\/reconciliation\/export$/);
    if (reconciliationExportMatch) {
      const tenantId = decodeURIComponent(reconciliationExportMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleCreditReconciliation(req, res, identity, true);
      return;
    }
    if (reconciliationMatch) {
      const tenantId = decodeURIComponent(reconciliationMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleCreditReconciliation(req, res, identity);
      return;
    }
    const reconciliationImportMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/credits\/reconciliation\/import$/);
    if (reconciliationImportMatch) {
      const tenantId = decodeURIComponent(reconciliationImportMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiCostImport(req, res, identity);
      return;
    }
    const creditMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/credits(?:\/(ledger|integrity|pricing|quote|grant|welcome|reserve|settle|release|expire|transfer))?$/);
    if (creditMatch) {
      const tenantId = decodeURIComponent(creditMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleCredits(req, res, identity, creditMatch[2]);
      return;
    }
    const walletMemberMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/wallets\/([^/]+)\/members\/([^/]+)$/);
    if (walletMemberMatch) {
      const tenantId = decodeURIComponent(walletMemberMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      const walletId = decodeURIComponent(walletMemberMatch[2]);
      const memberSubject = decodeURIComponent(walletMemberMatch[3]);
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleWallets(req, res, identity, walletId, memberSubject);
      return;
    }
    const walletMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/wallets(?:\/([^/]+)(?:\/(credits|ledger|members))?)?$/);
    if (walletMatch) {
      const tenantId = decodeURIComponent(walletMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleWallets(req, res, identity, walletMatch[2] ? decodeURIComponent(walletMatch[2]) : undefined, undefined);
      return;
    }
    const billingMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/billing\/(plans|orders|subscription)(?:\/([^/]+)\/(refund|expire))??$/);
    if (billingMatch) {
      const tenantId = decodeURIComponent(billingMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      const operation = billingMatch[2] === "plans" ? "plans" : billingMatch[2];
      if (billingMatch[4] && billingMatch[2] !== "orders") throw gatewayError(404, "NOT_FOUND", "商业计费路径不存在");
      await handleBilling(req, res, identity, billingMatch[4] ?? operation, billingMatch[3] ? decodeURIComponent(billingMatch[3]) : undefined);
      return;
    }
    const aiChatMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/chat\/completions$/);
    if (aiChatMatch) {
      const tenantId = decodeURIComponent(aiChatMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiChat(req, res, identity, requestId);
      return;
    }
    const aiResponsesMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/responses$/);
    if (aiResponsesMatch) {
      const tenantId = decodeURIComponent(aiResponsesMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiJsonApi(req, res, identity, requestId, "responses");
      return;
    }
    const aiCompletionsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/completions$/);
    if (aiCompletionsMatch) {
      const tenantId = decodeURIComponent(aiCompletionsMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiJsonApi(req, res, identity, requestId, "completions");
      return;
    }
    const aiEmbeddingsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/embeddings$/);
    if (aiEmbeddingsMatch) {
      const tenantId = decodeURIComponent(aiEmbeddingsMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiJsonApi(req, res, identity, requestId, "embeddings");
      return;
    }
    const aiRerankMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/rerank$/);
    if (aiRerankMatch) {
      const tenantId = decodeURIComponent(aiRerankMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiJsonApi(req, res, identity, requestId, "rerank");
      return;
    }
    const aiModerationsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/moderations$/);
    if (aiModerationsMatch) {
      const tenantId = decodeURIComponent(aiModerationsMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiJsonApi(req, res, identity, requestId, "moderations");
      return;
    }
    const aiModelsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/models$/);
    if (aiModelsMatch) {
      const tenantId = decodeURIComponent(aiModelsMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiModels(req, res, identity);
      return;
    }
    const aiCatalogMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/catalog$/);
    if (aiCatalogMatch) {
      const tenantId = decodeURIComponent(aiCatalogMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleCommercialModelCatalog(req, res, identity);
      return;
    }
    const aiCapabilitiesMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/ai\/capabilities$/);
    if (aiCapabilitiesMatch) {
      const tenantId = decodeURIComponent(aiCapabilitiesMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleNewApiCapabilities(req, res, identity);
      return;
    }
    const memberMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/member-revocations(?:\/([^/]+))?$/);
    if (memberMatch) {
      const tenantId = decodeURIComponent(memberMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleMemberRevocation(req, res, identity, memberMatch[2] ? decodeURIComponent(memberMatch[2]) : undefined);
      return;
    }
    const sessionMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/sessions(?:\/([^/]+))?$/);
    if (sessionMatch) {
      const tenantId = decodeURIComponent(sessionMatch[1]);
      requestedTenantId = tenantId;
      if (!/^[a-zA-Z0-9_.:\/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
      identity = await authenticate(req, tenantId);
      await assertMemberNotRevoked(identity);
      await handleSession(req, res, identity, sessionMatch[2] ? decodeURIComponent(sessionMatch[2]) : undefined);
      return;
    }
    const match = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/resources(?:\/([^/]+))?$/);
    if (!match) throw gatewayError(404, "NOT_FOUND", "资源 API 路径不存在");
    const tenantId = decodeURIComponent(match[1]);
    requestedTenantId = tenantId;
    if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(tenantId)) throw gatewayError(400, "INVALID_TENANT", "租户标识无效");
    const typeParam = url.searchParams.get("type");
    if (typeParam && !isCasdoorResourceType(typeParam)) throw gatewayError(400, "INVALID_RESOURCE_TYPE", "企业资源类型无效");
    identity = await authenticate(req, tenantId);
    await assertMemberNotRevoked(identity);
    await handleResource(req, res, identity, typeParam as CasdoorResourceType | undefined, match[2] ? decodeURIComponent(match[2]) : undefined);
  } catch (error) {
    const outcome = (error as GatewayError).statusCode && (error as GatewayError).statusCode! < 500 ? "deny" : "error";
    trackRequest(trackedPath, outcome);
    await audit({ requestId, at: new Date().toISOString(), subject: identity?.subject, tenantId: identity?.tenantId ?? requestedTenantId, action: req.method ?? "unknown", outcome, reason: (error as GatewayError).code ?? "request_failed" }).catch(() => undefined);
    failure(res, error, requestId);
  }
}

const port = boundedNumber(process.env.PORT, 8787, 1, 65535);
const host = process.env.HOST?.trim() || "127.0.0.1";

// handle() returns a Promise; `void` alone swallows the result, which on Node ≥15
// promotes any rejection to `unhandledRejection` and (with --unhandled-rejections=strict,
// the default since Node 15) terminates the process. Wrap with `.catch` so a single
// rejected request never crashes the dev/test server. The handler itself catches
// per-request errors and writes a JSON response, so this catch is purely a safety net.
export const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error("[gateway] unhandled rejection in request handler:", message);
    if (!res.headersSent) {
      try {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "error", code: "INTERNAL_ERROR", message: "unexpected gateway failure" }));
      } catch {
        // socket may already be closed; nothing more we can do
      }
    }
  });
});

function closeServer(signal: string): void {
  if (!server.listening) return;
  server.close((error) => {
    if (error) console.error(`Casdoor Resource Gateway shutdown (${signal}) failed`, error);
    process.exitCode = error ? 1 : 0;
  });
}

process.once("SIGTERM", () => closeServer("SIGTERM"));
process.once("SIGINT", () => closeServer("SIGINT"));

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  loadStoreAdapter()
    .then(() => server.listen(port, host, () => console.log(`Casdoor Resource Gateway listening on ${host}:${port} (store=${process.env.RESOURCE_GATEWAY_STORE?.trim() || "json"})`)))
    .catch((error) => {
      console.error("Casdoor Resource Gateway failed to start", error);
      process.exit(1);
    });
}
