/**
 * 本地用量统计与提醒配置。
 *
 * 记录桌面端可观察到的 token 消耗，提供日/月统计和本地提醒。
 * 企业积分、余额、真实 usage、订单和财务对账由 Resource Gateway 服务端账本负责，
 * 不使用本地记录进行扣费或结算。纯函数 + localStorage 持久化。
 */

/** 一条用量记录。 */
export interface UsageRecord {
  /** ISO 日期(YYYY-MM-DD)。 */
  date: string;
  /** 模型 id。 */
  modelId: string;
  /** 提示 token。 */
  promptTokens: number;
  /** 补全 token。 */
  completionTokens: number;
  /** 估算费用(可选,用户配置费率后计算)。 */
  cost?: number;
  /** 时间戳(ms)。 */
  ts: number;
}

/** 用量统计汇总。 */
export interface UsageSummary {
  /** 总 token。 */
  totalTokens: number;
  /** 总提示 token。 */
  totalPrompt: number;
  /** 总补全 token。 */
  totalCompletion: number;
  /** 总估算费用。 */
  totalCost: number;
  /** 记录数。 */
  count: number;
  /** 按模型分组。 */
  byModel: Record<string, { tokens: number; cost: number; count: number }>;
  /** 按日期分组(YYYY-MM-DD)。 */
  byDate: Record<string, { tokens: number; cost: number; count: number }>;
}

/** 配额配置。 */
export interface QuotaConfig {
  /** 配额周期("daily" | "monthly")。 */
  period: "daily" | "monthly";
  /** token 上限。 */
  tokenLimit: number;
  /** 费率表(modelId → 每千 token 价格)。 */
  rates?: Record<string, { prompt: number; completion: number }>;
}

const STORAGE_KEY = "openbuddy.usage";
const QUOTA_KEY = "openbuddy.quota";

/** 取今日 ISO 日期。 */
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 取当月 ISO 月(YYYY-MM)。 */
export function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 估算单次调用费用(按费率表)。 */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  rates?: Record<string, { prompt: number; completion: number }>,
): number | undefined {
  if (!rates || !rates[modelId]) return undefined;
  const r = rates[modelId];
  return (promptTokens / 1000) * r.prompt + (completionTokens / 1000) * r.completion;
}

/** 读取全部用量记录(按时间顺序)。 */
export function loadUsage(): UsageRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as UsageRecord[]) : [];
  } catch {
    return [];
  }
}

/** 追加一条用量记录(自动算费用)。 */
export function recordUsage(
  records: UsageRecord[],
  entry: { modelId: string; promptTokens: number; completionTokens: number },
  config?: QuotaConfig,
): UsageRecord[] {
  const cost = estimateCost(entry.modelId, entry.promptTokens, entry.completionTokens, config?.rates);
  const record: UsageRecord = {
    date: todayKey(),
    modelId: entry.modelId,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    cost,
    ts: Date.now(),
  };
  const next = [...records, record];
  saveUsage(next);
  return next;
}

/** 持久化。 */
function saveUsage(records: UsageRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* quota / 隐私模式 — 静默降级 */
  }
}

/** 清空用量(测试/重置用)。 */
export function clearUsage(): UsageRecord[] {
  saveUsage([]);
  return [];
}

/** 汇总用量(全部或按日期范围过滤)。 */
export function summarizeUsage(records: UsageRecord[], dateFilter?: { from: string; to: string }): UsageSummary {
  const filtered = dateFilter
    ? records.filter((r) => r.date >= dateFilter.from && r.date <= dateFilter.to)
    : records;
  const byModel: Record<string, { tokens: number; cost: number; count: number }> = {};
  const byDate: Record<string, { tokens: number; cost: number; count: number }> = {};
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCost = 0;
  for (const r of filtered) {
    const tokens = r.promptTokens + r.completionTokens;
    totalPrompt += r.promptTokens;
    totalCompletion += r.completionTokens;
    totalCost += r.cost ?? 0;
    if (!byModel[r.modelId]) byModel[r.modelId] = { tokens: 0, cost: 0, count: 0 };
    byModel[r.modelId].tokens += tokens;
    byModel[r.modelId].cost += r.cost ?? 0;
    byModel[r.modelId].count += 1;
    if (!byDate[r.date]) byDate[r.date] = { tokens: 0, cost: 0, count: 0 };
    byDate[r.date].tokens += tokens;
    byDate[r.date].cost += r.cost ?? 0;
    byDate[r.date].count += 1;
  }
  return {
    totalTokens: totalPrompt + totalCompletion,
    totalPrompt,
    totalCompletion,
    totalCost,
    count: filtered.length,
    byModel,
    byDate,
  };
}

/** 检查配额:返回当前周期已用比例(0–1)及是否超限。 */
export function checkQuota(records: UsageRecord[], config: QuotaConfig): {
  used: number;
  limit: number;
  pct: number;
  exceeded: boolean;
  nearLimit: boolean;
} {
  const key = config.period === "daily" ? todayKey() : monthKey();
  const periodRecords = records.filter((r) =>
    config.period === "daily" ? r.date === key : r.date.startsWith(key),
  );
  const used = periodRecords.reduce((s, r) => s + r.promptTokens + r.completionTokens, 0);
  const pct = config.tokenLimit > 0 ? used / config.tokenLimit : 0;
  return {
    used,
    limit: config.tokenLimit,
    pct: Math.round(pct * 100),
    exceeded: config.tokenLimit > 0 && used >= config.tokenLimit,
    nearLimit: pct >= 0.8 && pct < 1,
  };
}

/** 读取配额配置。 */
export function loadQuotaConfig(): QuotaConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(QUOTA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QuotaConfig;
  } catch {
    return null;
  }
}

/** 保存配额配置。 */
export function saveQuotaConfig(config: QuotaConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUOTA_KEY, JSON.stringify(config));
  } catch {
    /* noop */
  }
}
