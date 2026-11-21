/**
 * 用量 (pii W5.6) wire types: per-session token / cost totals aggregated in the host, so the
 * renderer no longer keeps its own localStorage ledger.
 */

/**
 * 费用来源 (compute use): 本地按模型定价表估算 vs 上游网关返回的权威账单。
 * 两者并列展示，不混算 —— 估算可能因为未知定价而偏小，权威值只对走网关的会话存在。
 */
export type UsageCostSource = "estimate" | "gateway";

export interface UsageSessionEntry {
  sessionId: string;
  /** Sidebar title at the time of the last turn (optional). */
  title?: string;
  cwd: string;
  /** ISO time of the last recorded turn. */
  at: string;
  /** `provider/model`. */
  modelKey?: string;
  /** `provider`（modelKey 的前缀）；预算与网关读数按它归属。 */
  providerId?: string;
  /** 本条目费用的来源；缺省视为估算值。 */
  costSource?: UsageCostSource;
  /** Bound expert name, when the session ran under one. */
  expertName?: string;
  tokens: { input: number; output: number; total: number };
  cost: number;
  toolCalls: number;
}

export interface UsageBucket {
  tokens: number;
  cost: number;
  sessions: number;
}

/** 一次回合的用量增量（compute use）：事件流是 append-only 的，按日 / 按厂商聚合的依据。 */
export interface UsageEvent {
  sessionId: string;
  /** ISO 时间（该回合结束时）。 */
  at: string;
  providerId?: string;
  /** `provider/model`。 */
  modelKey?: string;
  expertName?: string;
  tokens: { input: number; output: number; total: number };
  cost: number;
  costSource: UsageCostSource;
}

export interface UsageSnapshot {
  generatedAt: string;
  totals: { tokens: number; prompt: number; completion: number; cost: number; sessions: number };
  /** YYYY-MM-DD → totals of the sessions whose last turn was that day. */
  byDate: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  byExpert: Record<string, UsageBucket>;
  /** providerId → totals；预算与网关读数按它归属。 */
  byProvider: Record<string, UsageBucket>;
  /** 估算费用与权威费用分列（权威值只统计上游网关报告过的会话）。 */
  cost: { estimated: number; authoritative: number };
  sessions: UsageSessionEntry[];
}

/**
 * 供应商余额读取失败的原因（compute use, 仿 lumos `QuotaUnavailableReason`）。
 * `unauthorized` 表示凭据被拒，`unsupported-provider` 表示该厂商没有账单接口。
 */
export type QuotaUnavailableReason =
  | "unsupported-provider"
  | "missing-credentials"
  | "unauthorized"
  | "http-error"
  | "network"
  | "protocol";

/** 一次权威余额读取的结果；`balanceUsd` 为 null 表示上游不是美元计价。 */
export interface ProviderQuotaReading {
  providerId: string;
  /** 适配器 id（如 `vercel-ai-gateway`），便于排错。 */
  quotaProviderId: string;
  /** 剩余额度（美元等价）；上游报其它币种时为 null，绝不臆造折算。 */
  balanceUsd: number | null;
  /** 上游报告的余额明细。 */
  balance: { currency: string; total: number | null } | null;
  /** 上游报告的累计消费（美元）。 */
  spentUsd: number | null;
  /** 上游附带的其它事实（如 Token Pass 重置时间），键值均为标量。 */
  extra: Record<string, string | number | null> | null;
  /** 读取时间（ISO）。 */
  capturedAt: string;
}

/**
 * 余额读取的返回形状：失败不是异常，而是一个带原因的结果 ——
 * `unauthorized`（凭据被拒）与 `network`（网络不通）需要不同的提示。
 */
export type ProviderQuotaResponse =
  | { status: "ok"; reading: ProviderQuotaReading }
  | { status: "unavailable"; reason: QuotaUnavailableReason };

/** 单个供应商的日/月预算与已花金额。 */
export interface UsageBudget {
  providerId: string;
  name: string;
  /** 日限额（美元）；0 表示不限制。 */
  limitDailyUsd: number;
  /** 月限额（美元）；0 表示不限制。 */
  limitMonthlyUsd: number;
  spentTodayUsd: number;
  spentMonthUsd: number;
}
