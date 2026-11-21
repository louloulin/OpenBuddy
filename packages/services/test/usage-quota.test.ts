// @vitest-environment node
/**
 * 余额读数（compute use）：Vercel AI Gateway 的 `GET /v1/credits` 解析与错误分类。
 * 契约仿 lumos `src/services/quota/deepseekQuota.test.ts`：假 fetch 注入，断言绝不触网。
 */
import { expect, it } from "vitest";
import { QuotaUnavailableError, VercelAiGatewayQuotaProvider, getQuotaProviderForProvider } from "../src/usage/quota.js";

const provider = new VercelAiGatewayQuotaProvider();

/** 构造一个假 fetch：记录调用，返回给定的响应。 */
function fakeFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

it("解析余额、累计消费与 Token Pass（金额是字符串）", async () => {
  const { impl, calls } = fakeFetch(200, {
    balance: "95.50",
    total_used: "4.50",
    token_pass: { remaining: "12.34", resets_at: "2026-12-01T00:00:00.000Z" },
  });
  const reading = await provider.fetchQuota({ kind: "api_key", apiKey: "test-key" }, { fetchImpl: impl });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://ai-gateway.vercel.sh/v1/credits");
  expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
  expect(reading.balanceUsd).toBeCloseTo(95.5, 10);
  expect(reading.spentUsd).toBeCloseTo(4.5, 10);
  expect(reading.balance).toEqual({ currency: "USD", total: 95.5 });
  expect(reading.extra).toMatchObject({ tokenPassRemaining: 12.34, tokenPassResetsAt: "2026-12-01T00:00:00.000Z" });
});

it("解析不出金额时返回 null，不用本地估算冒充", async () => {
  const { impl } = fakeFetch(200, { balance: "not-a-number" });
  const reading = await provider.fetchQuota({ kind: "api_key", apiKey: "test-key" }, { fetchImpl: impl });
  expect(reading.balanceUsd).toBeNull();
  expect(reading.balance).toBeNull();
});

it("空 key → missing-credentials，且不发请求", async () => {
  const { impl, calls } = fakeFetch(200, {});
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "  " }, { fetchImpl: impl })).rejects.toMatchObject({
    reason: "missing-credentials",
  });
  expect(calls).toHaveLength(0);
});

it("401 / 403 → unauthorized", async () => {
  const { impl } = fakeFetch(401, { error: { message: "bad key" } });
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: impl })).rejects.toBeInstanceOf(QuotaUnavailableError);
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: impl })).rejects.toMatchObject({ reason: "unauthorized" });
});

it("其它非 2xx → http-error", async () => {
  const { impl } = fakeFetch(500, {});
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: impl })).rejects.toMatchObject({ reason: "http-error" });
});

it("网络异常 → network", async () => {
  const impl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: impl })).rejects.toMatchObject({ reason: "network" });
});

it("坏 JSON / 超大正文 → protocol", async () => {
  const bad = fakeFetch(200, "{not json");
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: bad.impl })).rejects.toMatchObject({ reason: "protocol" });
  const huge = fakeFetch(200, "x".repeat(70 * 1024));
  await expect(provider.fetchQuota({ kind: "api_key", apiKey: "k" }, { fetchImpl: huge.impl })).rejects.toMatchObject({ reason: "protocol" });
});

it("注册表只给有账单接口的厂商返回适配器", () => {
  expect(getQuotaProviderForProvider("vercel", "vercel")?.id).toBe("vercel-ai-gateway");
  expect(getQuotaProviderForProvider("custom", "custom-2")).toBeNull();
});
