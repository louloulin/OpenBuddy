// @vitest-environment node
/**
 * 用量台账（compute use）：增量事件流、归日口径、按厂商花费与老文件兼容。
 */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "../src/settings/settings.js";
import { UsageService } from "../src/usage/usage.js";
import { BudgetService } from "../src/usage/budgets.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function service() {
  const root = join(tmpdir(), `openbuddy-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  const settings = createSettings(root, {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  });
  return { usage: new UsageService(settings), budgets: new BudgetService(settings, new UsageService(settings)) };
}

const entry = (over: Partial<Parameters<UsageService["record"]>[0]> = {}) => ({
  sessionId: "s1",
  cwd: "/ws",
  at: "2026-11-21T10:00:00.000Z",
  modelKey: "vercel/anthropic/claude-sonnet-5",
  providerId: "vercel",
  tokens: { input: 100, output: 50, total: 150 },
  cost: 0.01,
  toolCalls: 1,
  ...over,
});

it("每回合追加一条增量事件，累计值只存最新快照", () => {
  const { usage } = service();
  usage.record(entry());
  usage.record(entry({ at: "2026-11-21T11:00:00.000Z", tokens: { input: 200, output: 80, total: 280 }, cost: 0.02 }));
  const snapshot = usage.snapshot();
  // 第二个回合只记增量（280-150 / 0.02-0.01），累计不重复计。
  expect(snapshot.totals.tokens).toBe(280);
  expect(snapshot.totals.cost).toBeCloseTo(0.02, 10);
  expect(snapshot.byDate["2026-11-21"].tokens).toBe(280);
  expect(snapshot.byProvider.vercel.tokens).toBe(280);
  expect(snapshot.byProvider.vercel.sessions).toBe(1);
  expect(snapshot.cost.estimated).toBeCloseTo(0.02, 10);
  expect(snapshot.cost.authoritative).toBe(0);
});

it("同一会话的累计值被覆盖时只补差额", () => {
  const { usage } = service();
  usage.record(entry({ cost: 0.01 }));
  usage.record(entry({ at: "2026-11-21T12:00:00.000Z", cost: 0.03 }));
  const snapshot = usage.snapshot();
  expect(snapshot.totals.cost).toBeCloseTo(0.03, 10);
  expect(snapshot.byDate["2026-11-21"].cost).toBeCloseTo(0.03, 10);
});

it("跨天会话按真实回合归日，而不是按会话最后一天", () => {
  const { usage } = service();
  usage.record(entry({ at: "2026-11-20T23:00:00.000Z", tokens: { input: 100, output: 50, total: 150 }, cost: 0.01 }));
  usage.record(entry({ at: "2026-11-21T01:00:00.000Z", tokens: { input: 200, output: 80, total: 280 }, cost: 0.02 }));
  const snapshot = usage.snapshot();
  expect(snapshot.byDate["2026-11-20"].tokens).toBe(150);
  expect(snapshot.byDate["2026-11-21"].tokens).toBe(130);
  expect(snapshot.totals.tokens).toBe(280);
});

it("权威费用与估算费用分列，不混算", () => {
  const { usage } = service();
  usage.record(entry({ cost: 0.01 }));
  usage.record(entry({ at: "2026-11-21T12:00:00.000Z", cost: 0.03, costSource: "gateway" }));
  const snapshot = usage.snapshot();
  expect(snapshot.cost.estimated).toBeCloseTo(0.01, 10);
  expect(snapshot.cost.authoritative).toBeCloseTo(0.02, 10);
  expect(snapshot.totals.cost).toBeCloseTo(0.03, 10);
});

it("老文件（只有 sessions 没有 events）仍按 session 聚合", async () => {
  const { usage } = service();
  usage.record(entry());
  // 抹掉事件流，模拟旧版本写下的 usage.json。
  const file = JSON.parse(await readFile(usage.path, "utf8")) as Record<string, unknown>;
  delete file.events;
  await writeFile(usage.path, JSON.stringify(file));
  const snapshot = usage.snapshot();
  expect(snapshot.totals.tokens).toBe(150);
  expect(snapshot.byDate["2026-11-21"].tokens).toBe(150);
  expect(snapshot.byProvider.vercel.tokens).toBe(150);
});

it("providerSpend 只统计该厂商今天 / 本月的花费", () => {
  const { usage } = service();
  const now = new Date("2026-11-21T12:00:00.000Z");
  usage.record(entry({ at: "2026-11-21T10:00:00.000Z", cost: 0.01 }));
  usage.record(entry({ sessionId: "s2", at: "2026-11-20T10:00:00.000Z", cost: 0.5 }));
  usage.record(entry({ sessionId: "s3", providerId: "openai", modelKey: "openai/gpt-4.1", at: "2026-11-21T11:00:00.000Z", cost: 0.2 }));
  const spend = usage.providerSpend("vercel", now);
  expect(spend.todayUsd).toBeCloseTo(0.01, 10);
  expect(spend.monthUsd).toBeCloseTo(0.51, 10);
});

it("预算：只列设过限额的供应商，已花金额来自台账", () => {
  const { usage, budgets } = service();
  usage.record(entry({ at: new Date().toISOString(), cost: 0.03 }));
  budgets.set("vercel", { limitDailyUsd: 0.05, limitMonthlyUsd: 1 });
  const list = budgets.list({ vercel: "Vercel AI Gateway" });
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ providerId: "vercel", name: "Vercel AI Gateway", limitDailyUsd: 0.05, limitMonthlyUsd: 1 });
  expect(list[0].spentTodayUsd).toBeCloseTo(0.03, 10);
  // 两个实例共享同一个 settings 目录时也应读得到限额。
  expect(budgets.limits("vercel")).toEqual({ limitDailyUsd: 0.05, limitMonthlyUsd: 1 });
});

it("预算：限额设为 0 视为取消", () => {
  const { budgets } = service();
  budgets.set("vercel", { limitDailyUsd: 5, limitMonthlyUsd: 10 });
  budgets.set("vercel", { limitDailyUsd: 0, limitMonthlyUsd: 0 });
  expect(budgets.list()).toHaveLength(0);
});
