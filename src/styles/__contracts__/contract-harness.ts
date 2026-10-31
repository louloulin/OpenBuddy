/**
 * contract-harness.ts — 五个视觉契约测试的共享断言（plan1030 批 1）。
 *
 * 快照语义（先立规矩，再逐文件清零）：
 *   1. 每文件违规数 ≤ baseline.json 记录值；新文件按 0 计（新 CSS 必须走 token）。
 *   2. 总违规数 ≤ 基线总量。
 * 清零动作完成后跑 generate-baseline.mjs 重压基线——只许降，不许涨。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { METRICS, scanAllStyles } from "./scanCss.mjs";
import type { MetricKey } from "./metric-key";

export type { MetricKey };

const BASELINE: {
  _totals: Record<MetricKey, number>;
  files: Record<string, Partial<Record<MetricKey, number>>>;
} = JSON.parse(readFileSync(join(import.meta.dirname, "baseline.json"), "utf8"));

/** 断言某维度「不许比快照更差」。 */
export function expectNoGrowth(metric: MetricKey) {
  if (!METRICS.includes(metric)) throw new Error(`unknown metric: ${metric}`);

  const current = scanAllStyles();
  const worse: string[] = [];
  let total = 0;

  for (const [file, counts] of Object.entries(current)) {
    const n = counts[metric] ?? 0;
    total += n;
    const allowed = BASELINE.files[file]?.[metric] ?? 0;
    if (n > allowed) worse.push(`  ${file}: ${n} > 基线 ${allowed}`);
  }

  expect(
    worse,
    [
      `视觉契约回退【${metric}】——新 CSS 必须走 token（plan1030 §6）：`,
      ...worse,
      `总量 ${total} / 基线 ${BASELINE._totals[metric]}`,
    ].join("\n"),
  ).toEqual([]);

  expect(total).toBeLessThanOrEqual(BASELINE._totals[metric]);
}
