import { describe, it, expect, beforeEach } from "vitest";
import {
  todayKey,
  monthKey,
  estimateCost,
  recordUsage,
  summarizeUsage,
  checkQuota,
  loadQuotaConfig,
  saveQuotaConfig,
  clearUsage,
  type UsageRecord,
  type QuotaConfig,
} from "../billing/usage-quota";

const rates = { "gpt-4": { prompt: 0.03, completion: 0.06 } };
const config: QuotaConfig = { period: "daily", tokenLimit: 10000, rates };

describe("estimateCost", () => {
  it("按费率表计算", () => {
    expect(estimateCost("gpt-4", 1000, 500, rates)).toBeCloseTo(0.03 + 0.03, 5);
  });
  it("无费率 → undefined", () => {
    expect(estimateCost("unknown", 100, 50, rates)).toBeUndefined();
    expect(estimateCost("gpt-4", 100, 50)).toBeUndefined();
  });
});

describe("recordUsage", () => {
  beforeEach(() => {
    window.localStorage.removeItem("openbuddy.usage");
    window.localStorage.removeItem("openbuddy.quota");
  });

  it("追加记录并持久化", () => {
    const records = recordUsage([], { modelId: "gpt-4", promptTokens: 100, completionTokens: 50 }, config);
    expect(records).toHaveLength(1);
    expect(records[0].modelId).toBe("gpt-4");
    expect(records[0].promptTokens).toBe(100);
    expect(records[0].cost).toBeDefined();
    // localStorage 持久化。
    const raw = window.localStorage.getItem("openbuddy.usage");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  it("无 config → cost 为 undefined", () => {
    const records = recordUsage([], { modelId: "x", promptTokens: 10, completionTokens: 5 });
    expect(records[0].cost).toBeUndefined();
  });
});

describe("summarizeUsage", () => {
  const records: UsageRecord[] = [
    { date: "2026-07-30", modelId: "gpt-4", promptTokens: 100, completionTokens: 50, cost: 0.06, ts: 1 },
    { date: "2026-07-30", modelId: "gpt-4", promptTokens: 200, completionTokens: 100, cost: 0.12, ts: 2 },
    { date: "2026-07-29", modelId: "claude", promptTokens: 50, completionTokens: 30, ts: 3 },
  ];

  it("全量汇总", () => {
    const s = summarizeUsage(records);
    expect(s.totalTokens).toBe(530); // 150+300+80
    expect(s.totalPrompt).toBe(350);
    expect(s.totalCompletion).toBe(180);
    expect(s.totalCost).toBeCloseTo(0.18, 5);
    expect(s.count).toBe(3);
    expect(s.byModel["gpt-4"].tokens).toBe(450);
    expect(s.byModel["gpt-4"].count).toBe(2);
    expect(s.byDate["2026-07-30"].tokens).toBe(450);
  });

  it("按日期范围过滤", () => {
    const s = summarizeUsage(records, { from: "2026-07-30", to: "2026-07-30" });
    expect(s.count).toBe(2);
    expect(s.totalTokens).toBe(450);
  });
});

describe("checkQuota", () => {
  it("未超限", () => {
    const records: UsageRecord[] = [
      { date: todayKey(), modelId: "x", promptTokens: 1000, completionTokens: 500, ts: 1 },
    ];
    const q = checkQuota(records, { period: "daily", tokenLimit: 10000 });
    expect(q.used).toBe(1500);
    expect(q.pct).toBe(15);
    expect(q.exceeded).toBe(false);
    expect(q.nearLimit).toBe(false);
  });
  it("接近上限(≥80%)", () => {
    const records: UsageRecord[] = [
      { date: todayKey(), modelId: "x", promptTokens: 4000, completionTokens: 4000, ts: 1 },
    ];
    const q = checkQuota(records, { period: "daily", tokenLimit: 10000 });
    expect(q.pct).toBe(80);
    expect(q.nearLimit).toBe(true);
  });
  it("超限", () => {
    const records: UsageRecord[] = [
      { date: todayKey(), modelId: "x", promptTokens: 6000, completionTokens: 5000, ts: 1 },
    ];
    const q = checkQuota(records, { period: "daily", tokenLimit: 10000 });
    expect(q.exceeded).toBe(true);
  });
  it("monthly 周期", () => {
    const records: UsageRecord[] = [
      { date: monthKey() + "-01", modelId: "x", promptTokens: 100, completionTokens: 50, ts: 1 },
      { date: monthKey() + "-15", modelId: "x", promptTokens: 200, completionTokens: 100, ts: 2 },
    ];
    const q = checkQuota(records, { period: "monthly", tokenLimit: 1000 });
    expect(q.used).toBe(450);
  });
});

describe("quota config 持久化", () => {
  beforeEach(() => {
    window.localStorage.removeItem("openbuddy.quota");
  });

  it("save/load", () => {
    saveQuotaConfig(config);
    const loaded = loadQuotaConfig();
    expect(loaded?.period).toBe("daily");
    expect(loaded?.tokenLimit).toBe(10000);
  });
  it("未配置 → null", () => {
    expect(loadQuotaConfig()).toBeNull();
  });
});

describe("clearUsage", () => {
  it("清空", () => {
    recordUsage([], { modelId: "x", promptTokens: 1, completionTokens: 1 });
    clearUsage();
    const raw = window.localStorage.getItem("openbuddy.usage");
    expect(JSON.parse(raw!)).toEqual([]);
  });
});
