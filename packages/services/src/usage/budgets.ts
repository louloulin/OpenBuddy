/**
 * 预算 (compute use): 每个供应商的日 / 月花费上限，以及今天 / 本月已花金额。
 *
 * 之前阈值只存在于渲染进程的 localStorage（`openbuddy.quota`），换个窗口就丢、也无法
 * 跨端共享。这里把限额移到宿主侧持久化，已花金额从用量台账（UsageService）算出来。
 *
 * 预算只是提醒：不阻止发送，也不代替上游账单（权威余额见 usage/quota.ts）。
 */
import { join } from "node:path";
import { JsonStore, type Settings } from "../settings/settings.js";
import type { UsageBudget } from "@openbuddy/protocol/usage";
import type { UsageService } from "./usage.js";

interface BudgetFile {
  /** providerId → 限额（美元）。 */
  providers: Record<string, { limitDailyUsd: number; limitMonthlyUsd: number }>;
}

/** 限额输入；0 表示不限制，负数视为非法（归 0）。 */
export interface BudgetLimits {
  limitDailyUsd?: number;
  limitMonthlyUsd?: number;
}

function limit(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1e6) / 1e6;
}

export class BudgetService {
  private store: JsonStore<BudgetFile>;
  constructor(
    settings: Settings,
    private readonly usage: UsageService,
  ) {
    this.store = new JsonStore(join(settings.dir, "budgets.json"), () => ({ providers: {} }));
  }
  get path() {
    return this.store.path;
  }
  /** 设置某个供应商的限额。 */
  set(providerId: string, limits: BudgetLimits): void {
    const id = providerId.trim();
    if (!id) throw new Error("providerId 不能为空");
    const file = this.store.read();
    const next = { limitDailyUsd: limit(limits.limitDailyUsd), limitMonthlyUsd: limit(limits.limitMonthlyUsd) };
    if (next.limitDailyUsd === 0 && next.limitMonthlyUsd === 0) delete file.providers[id];
    else file.providers[id] = next;
    this.store.write(file);
  }
  /** 读取限额（未设置时为 0 / 0）。 */
  limits(providerId: string): { limitDailyUsd: number; limitMonthlyUsd: number } {
    const entry = this.store.read().providers[providerId];
    return { limitDailyUsd: entry?.limitDailyUsd ?? 0, limitMonthlyUsd: entry?.limitMonthlyUsd ?? 0 };
  }
  /**
   * 全部预算 + 已花金额。只列出「设过限额」的供应商 —— 没有限额的供应商没有可提醒的进度条。
   */
  list(names: Record<string, string> = {}): UsageBudget[] {
    const file = this.store.read();
    return Object.entries(file.providers).map(([providerId, entry]) => {
      const spent = this.usage.providerSpend(providerId);
      return {
        providerId,
        name: names[providerId] ?? providerId,
        limitDailyUsd: entry.limitDailyUsd,
        limitMonthlyUsd: entry.limitMonthlyUsd,
        spentTodayUsd: spent.todayUsd,
        spentMonthUsd: spent.monthUsd,
      };
    });
  }
}
