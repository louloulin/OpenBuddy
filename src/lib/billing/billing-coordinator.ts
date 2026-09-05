/**
 * 计费协调器（对账桥）
 *
 * 职责：把 Newapi 客户端的实时用量与 casdoor-resource-gateway 的企业积分账本对齐。
 *
 * 关键边界（重要）：
 * 1. **gateway 是事实源**：计费、扣费、积分都在 casdoor-resource-gateway；
 *    本模块只做"对账"+"对账结果上报"。
 * 2. **不修改 gateway**：本模块不直接调 casdoor-resource-gateway 的扣费端点；
 *    上报走注入式 BillingGatewayClient。
 * 3. **session 派生**：每个用户用其 Newapi API Key 派生独立 coordinator（meter 共享）。
 * 4. **dry-run 默认**：默认所有上报都是 dryRun=true，由调用方选择真实推送。
 *
 * 桥接的三个事实：
 *   - NewapiClient.getUsageSummary(tokenId, opts)   → 服务端真实用量
 *   - NewapiTokenMeter.summarize(opts)              → 本地实时估算
 *   - BillingGatewayClient.importReconciliation(tid, payload, headers)  → gateway 接收
 *
 * 不变量：
 *   - drift.totalDelta > 0 表示本地多算（上报时应使用 server 数据）
 *   - drift.totalDelta < 0 表示本地少算（上报时应使用 meter 数据）
 *   - 默认对账时窗：最近 24 小时（可覆盖）
 */

import type {
  NewapiClient,
  NewapiConfig,
  NewapiTokenUsageLog,
  NewapiSession,
} from "./newapi-client";
import {
  NewapiClient as NewapiClientClass,
  newapiSessionFromCasdoorClaim,
  type NewapiEnvSource,
  type NewapiQuotaBalance,
} from "./newapi-client";
import {
  NewapiTokenMeter,
  compareMeterToUsageLogs,
  type UsageLogDriftEntry,
} from "./newapi-token-meter";

// ----------------------------------------------------------------------------
// 接口
// ----------------------------------------------------------------------------

/** 注入式：上游 casdoor-resource-gateway 客户端（用于上报对账）。 */
export interface BillingGatewayClient {
  /**
   * 上报对账结果到 gateway。
   * 真实实现：`POST /v1/tenants/{tid}/credits/reconciliation/import`（HMAC 内网鉴权）。
   */
  importReconciliation(
    tenantId: string,
    payload: BillingReconciliationPayload,
    headers: Record<string, string>,
  ): Promise<BillingReconciliationImportResult>;
}

/** 协调器配置。 */
export interface BillingCoordinatorConfig {
  /** Newapi 客户端。 */
  client: NewapiClient;
  /** 本地 meter（可跨 session 共享以保留诊断数据）。 */
  meter?: NewapiTokenMeter;
  /** Gateway 客户端（可选；缺失时对账结果仅返回不入库）。 */
  gatewayClient?: BillingGatewayClient;
  /** 默认对账时间窗（ms）。默认 24h。 */
  defaultReconciliationWindowMs?: number;
  /** 最大时间窗（ms）。默认 7d。 */
  maxReconciliationWindowMs?: number;
}

/** 对账载荷。 */
export interface BillingReconciliationPayload {
  /** ISO 起始。 */
  startTime: string;
  /** ISO 终止。 */
  endTime: string;
  /** Newapi token id。 */
  tokenId: string | number;
  /** 按模型漂移。 */
  drift: UsageLogDriftEntry[];
  /** 是否 dry-run。 */
  dryRun: boolean;
  /** 来源标签。 */
  source: "newapi-meter" | "newapi-server" | "merged";
  /** 总 USD 偏差。 */
  totalUsdDelta: number;
  /** 总 quota 偏差（1 quota = 1/500000 USD）。 */
  totalQuotaDelta: number;
  /** 备注。 */
  notes?: string;
}

/** 对账导入结果。 */
export interface BillingReconciliationImportResult {
  accepted: boolean;
  reportId: string;
  message?: string;
}

/** 对账报告。 */
export interface SyncReconciliationReport {
  payload: BillingReconciliationPayload;
  imported: boolean;
  importResult?: BillingReconciliationImportResult;
  /** 推送到 gateway 的错误（如果失败）。 */
  importError?: string;
}

// ----------------------------------------------------------------------------
// Bootstrap
// ----------------------------------------------------------------------------

export interface BootstrapClientInput {
  /** Casdoor OIDC claim（可选：从中提取 newapi_* 字段）。 */
  casdoorClaim?: Record<string, unknown> | null;
  /** env 源（可选：从中读取 OPENBUDDY_NEWAPI_* 变量）。 */
  env?: NewapiEnvSource;
  /** 显式 baseUrl 覆盖。 */
  baseUrl?: string;
  /** 显式 API Key 覆盖。 */
  apiKey?: string;
  /** 显式 userId 覆盖。 */
  userId?: string;
  /** Gateway 客户端（可选）。 */
  gatewayClient?: BillingGatewayClient;
  /** 共享 meter（可选）。 */
  meter?: NewapiTokenMeter;
  /** fetch 注入。 */
  fetchImpl?: NewapiConfig["fetchImpl"];
}

/** 引导：从多种来源构造 BillingCoordinator。 */
export class BillingCoordinator {
  private constructor(
    private readonly config: BillingCoordinatorConfig,
  ) {}

  /** 引导一个协调器。 */
  static bootstrapClient(input: BootstrapClientInput = {}): BillingCoordinator {
    const { client, error } = resolveClient(input);
    if (error || !client) {
      throw new Error(`无法引导 BillingCoordinator: ${error}`);
    }
    return new BillingCoordinator({
      client,
      meter: input.meter,
      gatewayClient: input.gatewayClient,
    });
  }

  static fromConfig(config: BillingCoordinatorConfig): BillingCoordinator {
    return new BillingCoordinator(config);
  }

  // 派生 ---------------------------------------------------------

  /** 派生新的 coordinator（保留 meter 与 gatewayClient，更换 client）。 */
  withSession(session: NewapiSession): BillingCoordinator {
    return new BillingCoordinator({
      ...this.config,
      client: this.config.client.withApiKey(session.apiKey).withUserId(session.userId) as NewapiClient,
    });
  }

  withClient(client: NewapiClient): BillingCoordinator {
    return new BillingCoordinator({ ...this.config, client });
  }

  withMeter(meter: NewapiTokenMeter): BillingCoordinator {
    return new BillingCoordinator({ ...this.config, meter });
  }

  withGatewayClient(gatewayClient: BillingGatewayClient): BillingCoordinator {
    return new BillingCoordinator({ ...this.config, gatewayClient });
  }

  // 访问器 --------------------------------------------------------

  get client(): NewapiClient {
    return this.config.client;
  }

  get meter(): NewapiTokenMeter | undefined {
    return this.config.meter;
  }

  get gatewayClient(): BillingGatewayClient | undefined {
    return this.config.gatewayClient;
  }

  // 用量 ---------------------------------------------------------

  /** 拉取服务端 usage 日志（Newapi 服务端）。 */
  async fetchUsageLogs(opts: {
    tokenId: string | number;
    startTime: number;
    endTime: number;
    pageSize?: number;
  }): Promise<NewapiTokenUsageLog[]> {
    return this.config.client.listTokenUsage(opts.tokenId, {
      startTime: opts.startTime,
      endTime: opts.endTime,
      pageSize: opts.pageSize,
    });
  }

  /** 拉取服务端聚合。 */
  async fetchUsageSummary(opts: {
    tokenId: string | number;
    startTime: number;
    endTime: number;
  }) {
    return this.config.client.getUsageSummary(opts.tokenId, { startTime: opts.startTime, endTime: opts.endTime });
  }

  // 余额 ---------------------------------------------------------

  /** 查余额；返回 NewapiQuotaBalance。 */
  async getRemainingBalance(): Promise<NewapiQuotaBalance> {
    return this.config.client.getQuotaBalance();
  }

  /** 余额转 USD（剩余 quota ÷ 500000）。 */
  async getRemainingBudget(): Promise<{ quota: number; usd: number; currency?: string }> {
    const balance = await this.getRemainingBalance();
    return {
      quota: balance.remainQuota,
      usd: balance.usdEquivalent ?? balance.remainQuota / 500_000,
      currency: balance.currency,
    };
  }

  // 对账 ---------------------------------------------------------

  /**
   * 同步对账：
   *  1. 拉 Newapi 服务端 usage 日志
   *  2. 与本地 meter（若提供）计算 drift
   *  3. 构造 payload 并（可选）推到 gateway
   */
  async syncReconciliation(opts: {
    tenantId: string;
    tokenId: string | number;
    startTime?: number;
    endTime?: number;
    dryRun?: boolean;
    source?: BillingReconciliationPayload["source"];
    notes?: string;
  }): Promise<SyncReconciliationReport> {
    const endTime = opts.endTime ?? Date.now();
    const startTime = opts.startTime ?? (endTime - this.windowMs());
    this.assertWindow(startTime, endTime);

    const logs = await this.fetchUsageLogs({ tokenId: opts.tokenId, startTime, endTime });
    const drift = this.config.meter
      ? compareMeterToUsageLogs(this.config.meter, logs, { sinceMs: startTime, untilMs: endTime })
      : logsToServerOnlyDrift(logs);

    const totalUsdDelta = drift.reduce((acc, item) => acc + (item.totalDelta / 1000) * 0.005, 0);
    const totalQuotaDelta = Math.round(totalUsdDelta * 500_000);

    const payload: BillingReconciliationPayload = {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      tokenId: opts.tokenId,
      drift,
      dryRun: opts.dryRun ?? true,
      source: opts.source ?? (this.config.meter ? "merged" : "newapi-server"),
      totalUsdDelta,
      totalQuotaDelta,
      ...(opts.notes ? { notes: opts.notes } : {}),
    };

    if (payload.dryRun || !this.config.gatewayClient) {
      return { payload, imported: false };
    }

    try {
      const importResult = await this.config.gatewayClient.importReconciliation(
        opts.tenantId,
        payload,
        {
          "x-openbuddy-source": payload.source,
          "x-openbuddy-dry-run": "false",
        },
      );
      return { payload, imported: importResult.accepted, importResult };
    } catch (err) {
      return {
        payload,
        imported: false,
        importError: (err as Error)?.message ?? String(err),
      };
    }
  }

  /**
   * 摄入一组已知 usage（不调 newapi），仅与本地 meter 对账后选择是否上报。
   */
  async ingestUsageLogs(opts: {
    tenantId: string;
    tokenId: string | number;
    startTime: number;
    endTime: number;
    usage: NewapiTokenUsageLog[];
    dryRun?: boolean;
    notes?: string;
  }): Promise<SyncReconciliationReport> {
    this.assertWindow(opts.startTime, opts.endTime);
    const drift = this.config.meter
      ? compareMeterToUsageLogs(this.config.meter, opts.usage, { sinceMs: opts.startTime, untilMs: opts.endTime })
      : logsToServerOnlyDrift(opts.usage);

    const totalUsdDelta = drift.reduce((acc, item) => acc + (item.totalDelta / 1000) * 0.005, 0);
    const totalQuotaDelta = Math.round(totalUsdDelta * 500_000);

    const payload: BillingReconciliationPayload = {
      startTime: new Date(opts.startTime).toISOString(),
      endTime: new Date(opts.endTime).toISOString(),
      tokenId: opts.tokenId,
      drift,
      dryRun: opts.dryRun ?? true,
      source: this.config.meter ? "merged" : "newapi-server",
      totalUsdDelta,
      totalQuotaDelta,
      ...(opts.notes ? { notes: opts.notes } : {}),
    };

    if (payload.dryRun || !this.config.gatewayClient) {
      return { payload, imported: false };
    }

    try {
      const importResult = await this.config.gatewayClient.importReconciliation(
        opts.tenantId,
        payload,
        {
          "x-openbuddy-source": payload.source,
          "x-openbuddy-dry-run": "false",
        },
      );
      return { payload, imported: importResult.accepted, importResult };
    } catch (err) {
      return {
        payload,
        imported: false,
        importError: (err as Error)?.message ?? String(err),
      };
    }
  }

  // 维护 --------------------------------------------------------

  private windowMs(): number {
    return this.config.defaultReconciliationWindowMs ?? 24 * 60 * 60 * 1000;
  }

  private assertWindow(start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error("对账窗口无效：endTime 必须大于 startTime");
    }
    const max = this.config.maxReconciliationWindowMs ?? 7 * 24 * 60 * 60 * 1000;
    if (end - start > max) {
      throw new Error(`对账窗口超过 ${Math.round(max / 86_400_000)} 天上限`);
    }
  }
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function resolveClient(input: BootstrapClientInput): { client: NewapiClient; error?: undefined } | { client?: undefined; error: string } {
  const baseUrl = input.baseUrl?.trim() || input.env?.OPENBUDDY_NEWAPI_BASE_URL?.trim() || "";
  if (!baseUrl) {
    return { error: "缺少 baseUrl（可通过 env OPENBUDDY_NEWAPI_BASE_URL 或显式 baseUrl 注入）" };
  }
  const apiKey = input.apiKey?.trim()
    || (typeof input.casdoorClaim?.newapi_api_key === "string" ? input.casdoorClaim.newapi_api_key.trim() : "")
    || input.env?.OPENBUDDY_NEWAPI_API_KEY?.trim()
    || "";
  const userId = input.userId?.trim()
    || (typeof input.casdoorClaim?.newapi_user_id === "string" ? input.casdoorClaim.newapi_user_id.trim() : "")
    || (typeof input.casdoorClaim?.sub === "string" ? input.casdoorClaim.sub.trim() : "")
    || input.env?.OPENBUDDY_NEWAPI_USER_ID?.trim()
    || "";
  const enabledRaw = input.env?.OPENBUDDY_NEWAPI_ENABLED?.trim().toLowerCase();
  const enabled = enabledRaw !== "false" && enabledRaw !== "0" && enabledRaw !== "no" && enabledRaw !== "off";
  const timeoutRaw = input.env?.OPENBUDDY_NEWAPI_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw && /^\d+$/.test(timeoutRaw) ? Math.max(1000, Math.min(600_000, Number(timeoutRaw))) : 60_000;

  const session = input.casdoorClaim ? newapiSessionFromCasdoorClaim(input.casdoorClaim as Parameters<typeof newapiSessionFromCasdoorClaim>[0]) : null;
  const base: NewapiConfig = {
    baseUrl,
    apiKey: apiKey || session?.apiKey,
    userId: userId || session?.userId,
    timeoutMs,
    enabled,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };
  return { client: NewapiClientClass.unauthenticated(baseUrl, base) };
}

/** 当无 meter 时，drift 用"server 端视为真值" → delta = 0。 */
function logsToServerOnlyDrift(logs: NewapiTokenUsageLog[]): UsageLogDriftEntry[] {
  const byModel: Record<string, { prompt: number; completion: number; total: number }> = {};
  for (const log of logs) {
    const model = String(log.model ?? "unknown");
    const prompt = Number(log.promptTokens) || 0;
    const completion = Number(log.completionTokens) || 0;
    const total = Number(log.totalTokens) || prompt + completion;
    if (!byModel[model]) byModel[model] = { prompt: 0, completion: 0, total: 0 };
    const bucket = byModel[model]!;
    bucket.prompt += prompt;
    bucket.completion += completion;
    bucket.total += total;
  }
  return Object.entries(byModel).map(([model, bucket]) => ({
    model,
    meterPrompt: 0,
    meterCompletion: 0,
    meterTotal: 0,
    serverPrompt: bucket.prompt,
    serverCompletion: bucket.completion,
    serverTotal: bucket.total,
    promptDelta: -bucket.prompt,
    completionDelta: -bucket.completion,
    totalDelta: -bucket.total,
  }));
}
