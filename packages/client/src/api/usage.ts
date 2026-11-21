// 用量统计 (pii W5.6): the host aggregates per-session tokens / cost by day, model and expert.
// compute use: 权威余额（上游网关）与预算（宿主侧限额）也走同一条 invoke 通道。
import type { ProviderQuotaResponse, UsageBudget, UsageSnapshot } from "@openbuddy/protocol/usage";
import { invoke } from "../ipc";

export type { UsageSnapshot, ProviderQuotaResponse, UsageBudget };

export async function usageSnapshot(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("usage_snapshot");
}

/** 读某个供应商的权威余额 / 累计消费（只有带账单接口的厂商才有）。 */
export async function usageProviderQuota(providerId: string): Promise<ProviderQuotaResponse> {
  return invoke<ProviderQuotaResponse>("usage_provider_quota", { providerId });
}

/** 全部预算（限额 + 已花金额）。 */
export async function usageBudgets(): Promise<UsageBudget[]> {
  return invoke<UsageBudget[]>("usage_budgets");
}

/** 设置某个供应商的日 / 月限额（美元，0 = 不限制）。 */
export async function usageBudgetSave(
  providerId: string,
  limits: { limitDailyUsd: number; limitMonthlyUsd: number },
): Promise<UsageBudget[]> {
  return invoke<UsageBudget[]>("usage_budget_save", { providerId, ...limits });
}
