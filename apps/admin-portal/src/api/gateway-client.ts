/**
 * OpenBuddy Admin Portal · Resource Gateway REST Client
 *
 * Portal 不重复实现任何商业逻辑，只调 Gateway 的 REST API。
 * Bearer access_token 从 Casdoor OIDC 换取，与 Gateway 共享同一份 JWT。
 *
 * 关键路径：
 *   Gateway: /v1/tenants/{tenantId}/credits/{pricing, quote, grant, ledger, reconciliation}
 *   Gateway: /v1/tenants/{tenantId}/wallets/{walletId}/{credits, ledger, members}
 *   Gateway: /v1/tenants/{tenantId}/billing/{plans, orders}
 *   Gateway: /v1/tenants/{tenantId}/policy
 *   Gateway: /v1/tenants/{tenantId}/audit
 */

import { loadTokens } from "../auth/oidc-client";

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_URL || "/api/gateway";

export interface GatewayError {
  code: string;
  message: string;
  status: number;
}

export class GatewayApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; tenantId?: string } = {},
): Promise<T> {
  const tokens = loadTokens();
  if (!tokens) throw new GatewayApiError(401, "NO_TOKEN", "未登录");

  const url = `${GATEWAY_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `${tokens.tokenType} ${tokens.accessToken}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let body: { code?: string; message?: string } = {};
    try {
      body = (await res.json()) as { code?: string; message?: string };
    } catch {
      // 忽略
    }
    throw new GatewayApiError(
      res.status,
      body.code ?? `HTTP_${res.status}`,
      body.message ?? `${res.status} ${res.statusText}`,
    );
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const gatewayClient = {
  /** 健康检查（不需要 token）。 */
  async health(): Promise<{ ok: boolean; store: string; version: string; latencyMs: number }> {
    const res = await fetch(`${GATEWAY_BASE}/healthz`);
    if (!res.ok) throw new GatewayApiError(res.status, "HEALTH_FAILED", "Gateway unhealthy");
    return res.json();
  },

  // ---- Credits ----
  listCreditPricing(tid: string): Promise<{ data: CreditPricingEntry[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/credits/pricing`);
  },
  updateCreditPricing(tid: string, body: CreditPricingPatch): Promise<{ data: CreditPricingEntry }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/credits/pricing`, {
      method: "PATCH",
      body,
    });
  },
  quoteCredits(tid: string, model: string, promptTokens: number, completionTokens: number): Promise<{ data: CreditQuote }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/credits/quote`, {
      method: "POST",
      body: { model, promptTokens, completionTokens },
    });
  },
  getReconciliation(tid: string, walletId?: string): Promise<{ data: ReconciliationReport }> {
    const path = walletId
      ? `/v1/tenants/${encodeURIComponent(tid)}/credits/reconciliation?walletId=${encodeURIComponent(walletId)}`
      : `/v1/tenants/${encodeURIComponent(tid)}/credits/reconciliation`;
    return request(path);
  },

  // ---- Wallets ----
  listWallets(tid: string): Promise<{ data: CreditWallet[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/wallets`);
  },
  createWallet(tid: string, body: { id: string; name: string; ownerSubject: string }): Promise<{ data: CreditWallet }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/wallets`, {
      method: "POST",
      body,
    });
  },
  getWalletCredits(tid: string, walletId: string): Promise<{ data: CreditAccount }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/wallets/${encodeURIComponent(walletId)}/credits`);
  },
  listWalletLedger(tid: string, walletId: string, limit = 50): Promise<{ data: CreditLedgerEntry[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/wallets/${encodeURIComponent(walletId)}/ledger?limit=${limit}`);
  },

  // ---- Billing ----
  listBillingPlans(tid: string): Promise<{ data: BillingPlan[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/billing/plans`);
  },
  upsertBillingPlan(tid: string, plan: BillingPlan): Promise<{ data: BillingPlan }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/billing/plans`, {
      method: "POST",
      body: plan,
    });
  },
  listBillingOrders(tid: string, limit = 50): Promise<{ data: BillingOrder[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/billing/orders?limit=${limit}`);
  },
  getBillingSubscription(tid: string): Promise<{ data: BillingSubscription | null }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/billing/subscription`);
  },

  // ---- Policy ----
  getTenantPolicy(tid: string): Promise<{ data: TenantPolicy }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/policy`);
  },
  patchTenantPolicy(tid: string, patch: TenantPolicyPatch): Promise<{ data: TenantPolicy }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/policy`, {
      method: "PATCH",
      body: patch,
    });
  },

  // ---- Audit ----
  listAudit(tid: string, limit = 100): Promise<{ data: AuditEntry[] }> {
    return request(`/v1/tenants/${encodeURIComponent(tid)}/audit?limit=${limit}`);
  },
};

// ---- Types（与 Gateway 对齐，参考 src/lib/casdoor-resources.ts）----
export interface CreditPricingEntry {
  model: string;
  inputPointsPerThousand: number;
  outputPointsPerThousand: number;
  minimumPoints: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  costCurrency?: string;
  costSource?: "configured-pricing" | "provider-reported" | "provider-reported-quota";
}

export type CreditPricingPatch = Partial<Omit<CreditPricingEntry, "model">>;

export interface CreditQuote {
  model: string;
  promptTokens: number;
  completionTokens: number;
  points: number;
  providerCost?: number;
  currency?: string;
}

export interface ReconciliationReport {
  tenantId: string;
  scope: "tenant" | "wallet";
  walletId?: string;
  bucketsByModel: Record<string, ReconciliationBucket>;
  bucketsBySubject: Record<string, ReconciliationBucket>;
  externalNewApiCostFetched: boolean;
  externalSource?: string;
  generatedAt: string;
}

export interface ReconciliationBucket {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  pointsSettled: number;
  upstreamCost: number;
  externalCost?: number;
  externalCostEntries?: number;
}

export interface CreditAccount {
  balance: number;
  reserved: number;
  available: number;
  lifetimeConsumed: number;
  lifetimeGranted: number;
  lifetimeRefunded: number;
}

export interface CreditWallet {
  id: string;
  tenantId: string;
  name: string;
  ownerSubject: string;
  status: "active" | "archived";
  balance: number;
  reserved: number;
  members?: { subject: string; role: "owner" | "spender" | "viewer"; addedAt: string }[];
}

export interface CreditLedgerEntry {
  id: string;
  type: "reservation" | "consume" | "release" | "adjustment" | "expire" | "purchase" | "refund" | "transfer";
  amount: number;
  balance: number;
  model?: string;
  requestId?: string;
  walletId?: string;
  sourceLedgerId?: string;
  reason?: string;
  createdAt: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  currency: string;
  priceMinor: number;
  points: number;
  pointsValidDays?: number;
  entitlementsValidDays?: number;
  active: boolean;
  features?: string[];
  newApiGroup?: string;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
}

export interface BillingOrder {
  orderNo: string;
  planId: string;
  subject?: string;
  walletId?: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded" | "expired" | "cancelled";
  points: number;
  createdAt: string;
  paidAt?: string;
  refundedAt?: string;
  paymentChannel?: string;
  externalPaymentId?: string;
}

export interface BillingSubscription {
  subject?: string;
  walletId?: string;
  planId: string;
  pointsGranted: number;
  entitlementsValidUntil?: string;
  autoRenew: boolean;
}

export interface TenantPolicy {
  status: "active" | "suspended" | "archived";
  maxResources: number;
  version: number;
  updatedAt: string;
  modelAllowlist?: string[];
  mcpAllowlist?: string[];
  killSwitch?: boolean;
  maxTokensPerDay?: number;
  maxPointsPerDay?: number;
  newApiGroup?: string;
}

export type TenantPolicyPatch = Partial<Omit<TenantPolicy, "version" | "updatedAt">>;

export interface AuditEntry {
  id: string;
  event: string;
  subject: string;
  resource?: string;
  action?: string;
  outcome: "success" | "failure";
  requestId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
