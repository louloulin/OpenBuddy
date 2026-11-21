// @vitest-environment node
/**
 * 宿主侧的 compute use 命令：余额读数的失败分类、预算的读写。
 * 只测命令层，引擎用最小替身，不起真实 Pi 会话。
 */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "@openbuddy/services/settings/settings";
import { UsageService } from "@openbuddy/services/usage/usage";
import { BudgetService } from "@openbuddy/services/usage/budgets";
import { hostModule } from "../src/modules/host.js";
import type { ProviderQuotaResponse, UsageBudget } from "@openbuddy/protocol/usage";
import type { HostContext } from "../src/module.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function context(options: {
  providers?: Array<{ id: string; providerKind: string; label?: string }>;
  secrets?: Record<string, string>;
  fetchImpl?: typeof fetch;
} = {}) {
  const root = join(tmpdir(), `openbuddy-host-cu-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  const settings = createSettings(root, {
    // 密钥需要可加密才能写入（SecretStore.check）。
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  });
  for (const [id, value] of Object.entries(options.secrets ?? {})) settings.secrets.set(id, value);
  const usage = new UsageService(settings);
  const budgets = new BudgetService(settings, usage);
  const ctx = {
    options: { fetchImpl: options.fetchImpl },
    settings,
    emit: () => {},
    engine: {
      usageStats: usage,
      budgets,
      providers: { list: () => ({ providers: options.providers ?? [], models: [] }) },
    },
    update: () => {},
    servedCommands: () => [],
  } as unknown as HostContext;
  return { module: hostModule(ctx), usage, budgets };
}

it("未知厂商 → unsupported-provider", async () => {
  const { module } = context({ providers: [{ id: "openai", providerKind: "openai" }] });
  const result = (await module.commands.usage_provider_quota!({ providerId: "openai" })) as ProviderQuotaResponse;
  expect(result).toEqual({ status: "unavailable", reason: "unsupported-provider" });
});

it("有厂商但没存 key → missing-credentials", async () => {
  const { module } = context({ providers: [{ id: "vercel", providerKind: "vercel" }] });
  const result = (await module.commands.usage_provider_quota!({ providerId: "vercel" })) as ProviderQuotaResponse;
  expect(result).toEqual({ status: "unavailable", reason: "missing-credentials" });
});

it("上游 401 → unauthorized（结构化原因，不是异常）", async () => {
  const fetchImpl = (async () =>
    ({ ok: false, status: 401, text: async () => "{}" }) as unknown as Response) as unknown as typeof fetch;
  const { module } = context({
    providers: [{ id: "vercel", providerKind: "vercel" }],
    secrets: { "provider:vercel": "k" },
    fetchImpl,
  });
  const result = (await module.commands.usage_provider_quota!({ providerId: "vercel" })) as ProviderQuotaResponse;
  expect(result).toEqual({ status: "unavailable", reason: "unauthorized" });
});

it("读取成功 → 返回余额与累计消费", async () => {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ balance: "10.00", total_used: "2.00" }),
    }) as unknown as Response) as unknown as typeof fetch;
  const { module } = context({
    providers: [{ id: "vercel", providerKind: "vercel", label: "Vercel AI Gateway" }],
    secrets: { "provider:vercel": "k" },
    fetchImpl,
  });
  const result = (await module.commands.usage_provider_quota!({ providerId: "vercel" })) as ProviderQuotaResponse;
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.reading.providerId).toBe("vercel");
  expect(result.reading.balanceUsd).toBeCloseTo(10, 10);
  expect(result.reading.spentUsd).toBeCloseTo(2, 10);
});

it("预算：写入后可读回，已花金额来自台账", async () => {
  const { module, usage } = context({ providers: [{ id: "vercel", providerKind: "vercel", label: "Vercel AI Gateway" }] });
  usage.record({
    sessionId: "s1",
    cwd: "/ws",
    at: new Date().toISOString(),
    modelKey: "vercel/anthropic/claude-sonnet-5",
    providerId: "vercel",
    tokens: { input: 10, output: 5, total: 15 },
    cost: 0.02,
    toolCalls: 0,
  });
  const saved = (await module.commands.usage_budget_save!({ providerId: "vercel", limitDailyUsd: 0.05, limitMonthlyUsd: 1 })) as UsageBudget[];
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ providerId: "vercel", name: "Vercel AI Gateway", limitDailyUsd: 0.05, limitMonthlyUsd: 1 });
  expect(saved[0].spentTodayUsd).toBeCloseTo(0.02, 10);
  expect((await module.commands.usage_budgets!({})) as UsageBudget[]).toHaveLength(1);
});
