/**
 * 供应商余额 / 权威支出读取（compute use）。
 *
 * 仿 lumos `src/services/quota/`：一个 QuotaProvider 把「已保存的供应商凭据」变成
 * 「该供应商自己的账单接口读数」。读数刻意宽松 —— 各家报表形状不同，结构化字段是
 * best-effort，拿不到就返回 null，绝不用本地估算冒充上游账单。
 *
 * 目前只有 Vercel AI Gateway 有可用的账单接口（`GET /v1/credits`）：它返回团队剩余
 * 额度与累计消费，正好对应「compute use」里的权威支出口径。
 */
import type { ProviderQuotaReading, QuotaUnavailableReason } from "@openbuddy/protocol/usage";

/** 读取余额所需的凭据；只有 API Key 一种形态（OAuth 没有账单接口）。 */
export interface QuotaCredentials {
  kind: "api_key";
  apiKey: string;
}

export interface QuotaProviderOptions {
  /** 注入的 HTTP 实现（桌面端用 Electron `net.fetch` 以走系统代理；测试用假 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
}

/** 余额读取失败的原因；`unauthorized` 表示凭据被拒而非上游故障。 */
export class QuotaUnavailableError extends Error {
  constructor(readonly reason: QuotaUnavailableReason) {
    super(`Provider quota unavailable: ${reason}`);
    this.name = "QuotaUnavailableError";
  }
}

/** 一个能把凭据换成余额读数的供应商适配器。 */
export interface QuotaProvider {
  readonly id: string;
  fetchQuota(credentials: QuotaCredentials, options?: QuotaProviderOptions): Promise<ProviderQuotaReading>;
}

/** 上游可能返回的数字字段（字符串或数字都接受）。 */
function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 正文上限：余额接口只有几十字节，超过就是异常响应而不是账单。 */
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export const VERCEL_AI_GATEWAY_QUOTA_PROVIDER_ID = "vercel-ai-gateway";
const VERCEL_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

/**
 * Vercel AI Gateway：读团队余额与累计消费。
 *
 * `GET /v1/credits` → `{ balance, total_used, token_pass?: { remaining, resets_at } }`。
 * 金额是字符串，必须解析；解析不出来就是 null（不猜）。
 */
export class VercelAiGatewayQuotaProvider implements QuotaProvider {
  readonly id = VERCEL_AI_GATEWAY_QUOTA_PROVIDER_ID;

  async fetchQuota(credentials: QuotaCredentials, options: QuotaProviderOptions = {}): Promise<ProviderQuotaReading> {
    const apiKey = credentials?.apiKey?.trim();
    if (!apiKey) throw new QuotaUnavailableError("missing-credentials");

    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(VERCEL_CREDITS_URL, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      });
    } catch (error) {
      throw new QuotaUnavailableError("network");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) throw new QuotaUnavailableError("unauthorized");
    if (!response.ok) throw new QuotaUnavailableError("http-error");

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new QuotaUnavailableError("network");
    }
    if (text.length > MAX_BODY_BYTES) throw new QuotaUnavailableError("protocol");

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new QuotaUnavailableError("protocol");
    }

    const balance = numeric(payload.balance);
    const spent = numeric(payload.total_used);
    const pass = (payload.token_pass ?? {}) as Record<string, unknown>;
    const passRemaining = numeric(pass.remaining);
    const resetsAt = typeof pass.resets_at === "string" ? pass.resets_at : null;
    const extra: Record<string, string | number | null> = {};
    if (passRemaining !== null) extra.tokenPassRemaining = passRemaining;
    if (resetsAt) extra.tokenPassResetsAt = resetsAt;

    return {
      providerId: "",
      quotaProviderId: this.id,
      balanceUsd: balance,
      balance: balance === null ? null : { currency: "USD", total: balance },
      spentUsd: spent,
      extra: Object.keys(extra).length ? extra : null,
      capturedAt: new Date().toISOString(),
    };
  }
}

/**
 * 适配器注册表：按供应商种类（或 id）找到一个能读账单接口的适配器。
 * 没有账单接口的厂商返回 null（调用方据此报 `unsupported-provider`）。
 */
export function getQuotaProviderForProvider(providerKind: string, providerId: string): QuotaProvider | null {
  if (providerKind === "vercel" || providerId === "vercel" || providerId.startsWith("vercel-"))
    return new VercelAiGatewayQuotaProvider();
  return null;
}
