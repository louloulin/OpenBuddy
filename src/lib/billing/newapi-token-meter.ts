/**
 * Newapi Token Meter（in-memory + 订阅）
 *
 * 用途：实时跟踪 Newapi 调用产生的 token 消耗，本地聚合、按模型汇总。
 *
 * 设计边界（重要）：
 * 1. **不参与真实扣费**：本 meter 是 transient 内存态；持久化由调用方负责。
 * 2. **不替代 casdoor-resource-gateway**：gateway 才是企业积分/账本的事实源。
 * 3. **可订阅**：订阅者获得每次 record* 的回调，用于 UI 实时显示。
 * 4. **可漂移检测**：与 newapi 服务端真实 usage 对账时计算 drift。
 *
 * 与 src/lib/usage-quota.ts 的关系：
 *   - usage-quota.ts 面向桌面端 localStorage 持久化的 UI 配额
 *   - 本 meter 面向服务端调用时的高频内存统计
 *   - 二者通过 `meterSummaryToUsageRecords` 互转
 */

import type {
  NewapiChatCompletionRequest,
  NewapiChatCompletionResponse,
  NewapiTokenUsageLog,
} from "./newapi-client";

// ----------------------------------------------------------------------------
// 模型
// ----------------------------------------------------------------------------

/** 一条 token 计量记录。 */
export interface NewapiMeterEntry {
  /** ISO 时间。 */
  timestamp: string;
  /** 毫秒时间戳。 */
  ts: number;
  /** 模型 id。 */
  model: string;
  /** 提示 token。 */
  promptTokens: number;
  /** 补全 token。 */
  completionTokens: number;
  /** 合计 token。 */
  totalTokens: number;
  /** Newapi quota（1 quota = 1/500000 USD）。 */
  quota: number;
  /** USD 等价。 */
  usd: number;
  /** 调用来源（如 "agent", "command", "test"）。 */
  source?: string;
  /** 关联 token id（如有）。 */
  tokenId?: string | number;
  /** Newapi request id。 */
  requestId?: string;
}

/** 按模型聚合的 meter 摘要。 */
export interface NewapiMeterSummary {
  count: number;
  totalPrompt: number;
  totalCompletion: number;
  totalTokens: number;
  totalQuota: number;
  totalUsd: number;
  byModel: Record<string, { count: number; prompt: number; completion: number; total: number; quota: number; usd: number }>;
  firstTs?: number;
  lastTs?: number;
}

/** 订阅回调签名。 */
export type NewapiMeterListener = (entry: NewapiMeterEntry) => void;

// ----------------------------------------------------------------------------
// 估算
// ----------------------------------------------------------------------------

/** USD 单价（每千 token）。默认 GPT-4 级别，可由调用方覆盖。 */
export interface NewapiPricingTable {
  /** 每千 prompt token USD。 */
  promptPer1k: number;
  /** 每千 completion token USD。 */
  completionPer1k: number;
}

export const DEFAULT_NEWAPI_PRICING: NewapiPricingTable = {
  promptPer1k: 0.005,
  completionPer1k: 0.015,
};

const QUOTA_PER_USD = 500_000;

/** 估算一次 chat 调用的 prompt token 数（启发式）。 */
export function estimateChatPromptTokens(req: NewapiChatCompletionRequest): number {
  let chars = 0;
  for (const msg of req.messages) {
    if (typeof msg.content === "string") chars += msg.content.length;
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") chars += part.text.length;
      }
    }
  }
  return Math.max(1, Math.ceil(chars / 3));
}

/** 按模型/分组查表。缺省时退回 DEFAULT_NEWAPI_PRICING。 */
export function resolvePricing(model: string, table?: Record<string, NewapiPricingTable>): NewapiPricingTable {
  if (table && table[model]) return table[model];
  return DEFAULT_NEWAPI_PRICING;
}

/** 计算 quota 与 USD。 */
export function computeUsageCost(
  promptTokens: number,
  completionTokens: number,
  pricing: NewapiPricingTable = DEFAULT_NEWAPI_PRICING,
): { usd: number; quota: number } {
  const usd = (promptTokens / 1000) * pricing.promptPer1k + (completionTokens / 1000) * pricing.completionPer1k;
  const quota = Math.ceil(usd * QUOTA_PER_USD);
  return { usd, quota };
}

// ----------------------------------------------------------------------------
// Meter
// ----------------------------------------------------------------------------

export interface NewapiMeterOptions {
  /** 上限记录数（环形缓冲）。默认 10000。 */
  maxEntries?: number;
  /** 自定义时钟（测试可注入）。 */
  now?: () => Date;
  /** 定价表（按模型 id）。 */
  pricingTable?: Record<string, NewapiPricingTable>;
  /** 初始条目。 */
  initial?: NewapiMeterEntry[];
}

export class NewapiTokenMeter {
  private readonly maxEntries: number;
  private readonly now: () => Date;
  private readonly pricingTable?: Record<string, NewapiPricingTable>;
  private readonly entries: NewapiMeterEntry[] = [];
  private readonly listeners = new Set<NewapiMeterListener>();

  constructor(opts: NewapiMeterOptions = {}) {
    this.maxEntries = Number.isFinite(opts.maxEntries) && (opts.maxEntries ?? 0) > 0 ? Math.floor(opts.maxEntries!) : 10_000;
    this.now = opts.now ?? (() => new Date());
    this.pricingTable = opts.pricingTable;
    if (opts.initial?.length) {
      for (const entry of opts.initial) this.appendEntry(entry);
    }
  }

  // 订阅 ---------------------------------------------------------

  subscribe(listener: NewapiMeterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  // 记录 ---------------------------------------------------------

  /** 记录一次 chat 请求 + 响应。返回创建的条目。 */
  recordChat(
    request: NewapiChatCompletionRequest,
    response: NewapiChatCompletionResponse | { usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } },
    opts: { source?: string; tokenId?: string | number; requestId?: string } = {},
  ): NewapiMeterEntry {
    const usage = response.usage;
    const promptTokens = usage?.prompt_tokens ?? estimateChatPromptTokens(request);
    const completionTokens = usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
    const pricing = resolvePricing(request.model, this.pricingTable);
    const cost = computeUsageCost(promptTokens, completionTokens, pricing);
    const now = this.now();
    const entry: NewapiMeterEntry = {
      timestamp: now.toISOString(),
      ts: now.getTime(),
      model: request.model,
      promptTokens,
      completionTokens,
      totalTokens,
      quota: cost.quota,
      usd: cost.usd,
      source: opts.source,
      tokenId: opts.tokenId,
      requestId: opts.requestId,
    };
    this.appendEntry(entry);
    return entry;
  }

  /** 直接摄入一条 Newapi 服务端日志（用于对账时反向补回本地 meter）。 */
  recordUsageLog(log: NewapiTokenUsageLog, opts: { source?: string; pricingTable?: Record<string, NewapiPricingTable> } = {}): NewapiMeterEntry {
    const prompt = Number(log.promptTokens) || 0;
    const completion = Number(log.completionTokens) || 0;
    const total = Number(log.totalTokens) || prompt + completion;
    const quota = Number(log.quota) || 0;
    const pricing = resolvePricing(log.model ?? "unknown", opts.pricingTable ?? this.pricingTable);
    const usd = quota > 0 ? quota / QUOTA_PER_USD : (prompt / 1000) * pricing.promptPer1k + (completion / 1000) * pricing.completionPer1k;
    const ts = typeof log.createdAtMs === "number" ? log.createdAtMs : (log.createdAt ? Date.parse(log.createdAt) : this.now().getTime());
    const entry: NewapiMeterEntry = {
      timestamp: new Date(ts).toISOString(),
      ts,
      model: String(log.model ?? "unknown"),
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      quota,
      usd,
      source: opts.source ?? "newapi.usage",
      tokenId: log.tokenId,
      requestId: log.requestId,
    };
    this.appendEntry(entry);
    return entry;
  }

  private appendEntry(entry: NewapiMeterEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) this.entries.shift();
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 订阅者异常不影响主流程
      }
    }
  }

  // 聚合 ---------------------------------------------------------

  summarize(opts: { sinceMs?: number; untilMs?: number; model?: string } = {}): NewapiMeterSummary {
    const { sinceMs, untilMs, model } = opts;
    const byModel: NewapiMeterSummary["byModel"] = {};
    let count = 0;
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalTokens = 0;
    let totalQuota = 0;
    let totalUsd = 0;
    let firstTs: number | undefined;
    let lastTs: number | undefined;
    for (const entry of this.entries) {
      if (sinceMs !== undefined && entry.ts < sinceMs) continue;
      if (untilMs !== undefined && entry.ts > untilMs) continue;
      if (model && entry.model !== model) continue;
      count += 1;
      totalPrompt += entry.promptTokens;
      totalCompletion += entry.completionTokens;
      totalTokens += entry.totalTokens;
      totalQuota += entry.quota;
      totalUsd += entry.usd;
      if (firstTs === undefined || entry.ts < firstTs) firstTs = entry.ts;
      if (lastTs === undefined || entry.ts > lastTs) lastTs = entry.ts;
      if (!byModel[entry.model]) byModel[entry.model] = { count: 0, prompt: 0, completion: 0, total: 0, quota: 0, usd: 0 };
      const bucket = byModel[entry.model]!;
      bucket.count += 1;
      bucket.prompt += entry.promptTokens;
      bucket.completion += entry.completionTokens;
      bucket.total += entry.totalTokens;
      bucket.quota += entry.quota;
      bucket.usd += entry.usd;
    }
    const summary: NewapiMeterSummary = {
      count,
      totalPrompt,
      totalCompletion,
      totalTokens,
      totalQuota,
      totalUsd,
      byModel,
    };
    if (firstTs !== undefined) summary.firstTs = firstTs;
    if (lastTs !== undefined) summary.lastTs = lastTs;
    return summary;
  }

  // 维护 ---------------------------------------------------------

  /** 删除早于 cutoffMs 的条目。返回删除数量。 */
  pruneOlderThan(cutoffMs: number): number {
    if (!Number.isFinite(cutoffMs)) return 0;
    let removed = 0;
    while (this.entries.length > 0 && (this.entries[0]?.ts ?? 0) < cutoffMs) {
      this.entries.shift();
      removed += 1;
    }
    return removed;
  }

  reset(): void {
    this.entries.length = 0;
  }

  size(): number {
    return this.entries.length;
  }

  capacity(): number {
    return this.maxEntries;
  }

  getEntries(): NewapiMeterEntry[] {
    return this.entries.slice();
  }
}

// ----------------------------------------------------------------------------
// 互转
// ----------------------------------------------------------------------------

/** 把 NewapiTokenMeter 摘要转换为 usage-quota.ts 兼容的 UsageRecord[]。 */
export function meterSummaryToUsageRecords(
  summary: NewapiMeterSummary,
  dateFn: (ts: number) => string = defaultDateKey,
): Array<{ date: string; modelId: string; promptTokens: number; completionTokens: number; cost?: number; ts: number }> {
  const out: Array<{ date: string; modelId: string; promptTokens: number; completionTokens: number; cost?: number; ts: number }> = [];
  for (const [model, bucket] of Object.entries(summary.byModel)) {
    out.push({
      date: dateFn(summary.lastTs ?? Date.now()),
      modelId: model,
      promptTokens: bucket.prompt,
      completionTokens: bucket.completion,
      cost: bucket.usd,
      ts: summary.lastTs ?? Date.now(),
    });
  }
  return out;
}

/** 把多个 meter 合并到一个目标 meter（不复制 source 引用）。 */
export function absorbMeter(target: NewapiTokenMeter, source: NewapiTokenMeter): number {
  let absorbed = 0;
  for (const entry of source.getEntries()) {
    // 跳过已存在（按 ts + model + requestId 去重）
    if (entry.requestId && target.getEntries().some((e) => e.requestId === entry.requestId)) continue;
    target.recordUsageLog({
      model: entry.model,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
      quota: entry.quota,
      createdAt: entry.timestamp,
      createdAtMs: entry.ts,
      tokenId: entry.tokenId,
      requestId: entry.requestId,
    });
    absorbed += 1;
  }
  return absorbed;
}

// ----------------------------------------------------------------------------
// 对账
// ----------------------------------------------------------------------------

export interface UsageLogDriftEntry {
  model: string;
  meterPrompt: number;
  meterCompletion: number;
  meterTotal: number;
  serverPrompt: number;
  serverCompletion: number;
  serverTotal: number;
  promptDelta: number;
  completionDelta: number;
  totalDelta: number;
}

/** 计算本地 meter 与服务端 usage 日志的漂移（按模型）。 */
export function compareMeterToUsageLogs(
  meter: NewapiTokenMeter,
  logs: NewapiTokenUsageLog[],
  opts: { sinceMs?: number; untilMs?: number } = {},
): UsageLogDriftEntry[] {
  const meterSummary = meter.summarize(opts);
  const serverByModel: Record<string, { prompt: number; completion: number; total: number }> = {};
  for (const log of logs) {
    const model = String(log.model ?? "unknown");
    const prompt = Number(log.promptTokens) || 0;
    const completion = Number(log.completionTokens) || 0;
    const total = Number(log.totalTokens) || prompt + completion;
    if (!serverByModel[model]) serverByModel[model] = { prompt: 0, completion: 0, total: 0 };
    const bucket = serverByModel[model]!;
    bucket.prompt += prompt;
    bucket.completion += completion;
    bucket.total += total;
  }
  const allModels = new Set([...Object.keys(meterSummary.byModel), ...Object.keys(serverByModel)]);
  const out: UsageLogDriftEntry[] = [];
  for (const model of allModels) {
    const meterBucket = meterSummary.byModel[model] ?? { count: 0, prompt: 0, completion: 0, total: 0, quota: 0, usd: 0 };
    const serverBucket = serverByModel[model] ?? { prompt: 0, completion: 0, total: 0 };
    out.push({
      model,
      meterPrompt: meterBucket.prompt,
      meterCompletion: meterBucket.completion,
      meterTotal: meterBucket.total,
      serverPrompt: serverBucket.prompt,
      serverCompletion: serverBucket.completion,
      serverTotal: serverBucket.total,
      promptDelta: meterBucket.prompt - serverBucket.prompt,
      completionDelta: meterBucket.completion - serverBucket.completion,
      totalDelta: meterBucket.total - serverBucket.total,
    });
  }
  out.sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta));
  return out;
}

function defaultDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
