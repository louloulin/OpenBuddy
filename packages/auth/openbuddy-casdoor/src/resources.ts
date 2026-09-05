export const CASDOOR_RESOURCE_TYPES = [
  "project",
  "knowledge_base",
  "storage_connection",
] as const;

export type CasdoorResourceType = (typeof CASDOOR_RESOURCE_TYPES)[number];

export interface CasdoorResourceRecord {
  id: string;
  tenantId: string;
  ownerSubject: string;
  type: CasdoorResourceType;
  name: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CasdoorResourceCreateInput {
  type: CasdoorResourceType;
  name: string;
  metadata?: Record<string, string | number | boolean | null>;
  idempotencyKey?: string;
}

export interface CasdoorResourceUpdateInput {
  name?: string;
  metadata?: Record<string, string | number | boolean | null>;
  expectedVersion: number;
}

export type CasdoorTenantPolicyStatus = "active" | "suspended" | "archived";

export interface CasdoorTenantPolicy {
  status: CasdoorTenantPolicyStatus;
  maxResources: number;
  version: number;
  updatedAt: string;
  updatedBy?: string;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  killSwitch?: boolean;
  maxTokensPerDay?: number;
  tokensUsedToday?: number;
  tokensReservedToday?: number;
  maxPointsPerDay?: number;
  pointsUsedToday?: number;
  pointsReservedToday?: number;
  newApiGroup?: string;
}

export interface CasdoorTenantPolicyPatch {
  expectedVersion?: number;
  status?: CasdoorTenantPolicyStatus;
  maxResources?: number;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  killSwitch?: boolean;
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  newApiGroup?: string;
}

export type CasdoorAiProtocol = "chat.completions" | "completions" | "responses" | "embeddings" | "rerank" | "moderations" | "images" | "audio" | "realtime" | "video";

export interface CasdoorAiCapability {
  supported: boolean;
  streaming?: boolean;
  usage?: "required" | "optional" | "none";
  reason?: string;
  verifiedAt?: string;
}

export interface CasdoorAiCapabilityModel {
  id: string;
  capabilities: Partial<Record<CasdoorAiProtocol, CasdoorAiCapability>>;
}

export interface CasdoorAiCapabilities {
  group?: string;
  capabilitySource: "gateway-config" | "unconfigured";
  models: CasdoorAiCapabilityModel[];
}

export interface CasdoorCommercialModelCatalogEntry {
  id: string;
  sellable: boolean;
  reason?: string;
  capabilities: Record<string, CasdoorAiCapability>;
  pricing: CasdoorCreditPricing;
  grossMarginPercent?: number;
  marginCurrency?: string;
  revenuePerPoint?: number;
}

export interface CasdoorCommercialModelCatalog {
  group?: string;
  capabilitySource: "gateway-config" | "unconfigured";
  pricingSource: "gateway-pricing";
  generatedAt: string;
  models: CasdoorCommercialModelCatalogEntry[];
}

export interface CasdoorMemberRevocation {
  subject: string;
  revoked: boolean;
  revokedAt?: string;
  revokedBy?: string;
  reason?: string;
  configured?: boolean;
}

export interface CasdoorCreditAccount {
  tenantId: string;
  subject: string;
  plan: string;
  balance: number;
  reserved: number;
  available: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
  lifetimeRefunded: number;
  lifetimeExpired: number;
  updatedAt: string;
  version: number;
}

export type CasdoorCreditWalletRole = "owner" | "spender" | "viewer";

export interface CasdoorCreditWalletMember {
  walletId: string;
  tenantId: string;
  subject: string;
  role: CasdoorCreditWalletRole;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CasdoorCreditWallet {
  id: string;
  tenantId: string;
  name: string;
  status: "active" | "suspended" | "archived";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  members?: CasdoorCreditWalletMember[];
}

export type CasdoorCreditLedgerType = "grant" | "purchase" | "consume" | "refund" | "expire" | "adjustment" | "reservation" | "release";

export interface CasdoorCreditLedgerEntry {
  id: string;
  tenantId: string;
  subject: string;
  type: CasdoorCreditLedgerType;
  amount: number;
  unit: "points";
  requestId?: string;
  idempotencyKey?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  newApiRequestId?: string;
  newApiGroup?: string;
  agentId?: string;
  sessionId?: string;
  pricingSnapshot?: CasdoorCreditPricing;
  expiresAt?: string;
  sourceLedgerId?: string;
  previousHash?: string;
  entryHash?: string;
  reason?: string;
  createdAt: string;
  createdBy?: string;
}

export interface CasdoorCreditLedgerIntegrity {
  tenantId: string;
  scope: "tenant";
  status: "verified" | "backfillable" | "invalid";
  checked: number;
  creditLedgerAnchorHash?: string;
  headHash?: string;
  firstInvalidId?: string;
}

export interface CasdoorReconciliationBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  pointsSettled: number;
  upstreamCost: number;
  upstreamCostEntries: number;
  externalCost?: number;
  externalCostEntries?: number;
  paidPointsConsumed: number;
  freePointsConsumed: number;
  recognizedRevenueMinorByCurrency: Record<string, number>;
}

export interface CasdoorReconciliationReport {
  source: "openbuddy-credit-ledger";
  externalNewApiCostFetched: boolean;
  tenantId: string;
  walletId?: string;
  scope?: "tenant" | "wallet";
  reportId: string;
  reportHash: string;
  generatedAt: string;
  since?: string;
  until?: string;
  coveragePercent: number;
  total: CasdoorReconciliationBucket;
  commerce?: {
    grossOrders: number;
    refundedOrders: number;
    grossPoints: number;
    refundedPoints: number;
    netPoints: number;
    grossAmountMinorByCurrency: Record<string, number>;
    refundedAmountMinorByCurrency: Record<string, number>;
    netAmountMinorByCurrency: Record<string, number>;
  };
  economics?: {
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
  byModel: Record<string, CasdoorReconciliationBucket>;
  bySubject: Record<string, CasdoorReconciliationBucket>;
  byActor: Record<string, CasdoorReconciliationBucket>;
  byAgent: Record<string, CasdoorReconciliationBucket>;
  bySession: Record<string, CasdoorReconciliationBucket>;
  external?: {
    source: string;
    records: number;
    providerReportedRecords?: number;
    providerReportedQuotaRecords?: number;
    configuredPricingRecords?: number;
    matchedRecords: number;
    unmatchedRecords: number;
    totalCost: number;
    totalCostByCurrency?: Record<string, number>;
    currencies: string[];
    costBasis?: Record<string, number>;
    byModel: Record<string, CasdoorReconciliationBucket>;
    bySubject: Record<string, CasdoorReconciliationBucket>;
    byActor: Record<string, CasdoorReconciliationBucket>;
    byAgent: Record<string, CasdoorReconciliationBucket>;
    bySession: Record<string, CasdoorReconciliationBucket>;
  };
}

export interface CasdoorReconciliationExport {
  filename: string;
  contentType: string;
  reportId: string;
  reportHash: string;
  body: string;
}

export interface CasdoorCreditPricing {
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

export interface CasdoorCreditQuote {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedPoints: number;
  unit: "points";
  priceBasis: "gateway-pricing";
  pricing: CasdoorCreditPricing;
  estimatedProviderCost?: number;
  costCurrency?: string;
  costBasis?: "configured-pricing" | "provider-reported" | "provider-reported-quota";
  quoteValidUntil: string;
}

export type CasdoorTenantBudgetStatus = "unlimited" | "healthy" | "warning" | "critical" | "exhausted";

export interface CasdoorTenantBudgetSummary {
  limit?: number;
  used: number;
  reserved: number;
  committed: number;
  remaining?: number;
  utilizationPercent?: number;
  status: CasdoorTenantBudgetStatus;
}

export type CasdoorBillingOrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "expired"
  | "cancelled";

export interface CasdoorBillingPlan {
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

export interface CasdoorBillingEntitlements {
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  newApiGroup?: string;
}

export interface CasdoorBillingSubscription {
  tenantId: string;
  subject: string;
  planId: string;
  orderNo: string;
  status: "active" | "cancelled";
  entitlements: CasdoorBillingEntitlements;
  startedAt: string;
  entitlementsExpiresAt?: string;
  endedAt?: string;
  appliedPolicyVersion?: number;
}

export interface CasdoorBillingOrder {
  id: string;
  orderNo: string;
  tenantId: string;
  subject: string;
  walletId?: string;
  planId: string;
  points: number;
  amountMinor: number;
  currency: string;
  status: CasdoorBillingOrderStatus;
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
  entitlements?: CasdoorBillingEntitlements;
  paidAt?: string;
  refundedAt?: string;
}

export interface CasdoorBillingPlanInput {
  id?: string;
  name?: string;
  description?: string;
  currency?: string;
  priceMinor?: number;
  points?: number;
  active?: boolean;
  features?: string[];
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  newApiGroup?: string;
  pointsValidDays?: number;
  entitlementsValidDays?: number;
}

export interface CasdoorBillingOrderInput {
  planId?: string;
  subject?: string;
  walletId?: string;
  idempotencyKey?: string;
  expiresInSeconds?: number;
}

export function isCasdoorResourceType(value: unknown): value is CasdoorResourceType {
  return typeof value === "string" && (CASDOOR_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function normalizeCasdoorResourceMetadata(
  value: unknown,
  maxEntries = 64,
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, maxEntries)) {
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(key)) continue;
    if (/(secret|password|token|credential|private.?key|access.?key)/i.test(key)) continue;
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      result[key] = typeof entry === "string" ? entry.slice(0, 2_000) : entry;
    }
  }
  return result;
}

export function normalizeCasdoorResourceIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().slice(0, 120);
  return /^[a-zA-Z0-9_.:-]+$/.test(key) ? key : undefined;
}

export function normalizeCasdoorResourceName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]/g, " ").trim().slice(0, 200) : "";
}
