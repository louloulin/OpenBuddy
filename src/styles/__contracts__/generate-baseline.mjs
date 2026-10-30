/**
 * generate-baseline.mjs — 重新生成 baseline.json（plan1030 批 1 快照）。
 *
 * 用法：node src/styles/__contracts__/generate-baseline.mjs
 *
 * 快照语义：baseline.json 记录**当前**各文件各维度的违规数；
 * 契约测试断言「不许变差」（新文件基线视为 0）。后续批次逐文件
 * 清零后重跑本脚本，把基线往下压——只许降，不许涨。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { METRICS, STYLES_DIR, scanAllStyles } from "./scanCss.mjs";

const perFile = scanAllStyles();
const totals = Object.fromEntries(METRICS.map((m) => [m, 0]));
for (const counts of Object.values(perFile)) {
  for (const m of METRICS) totals[m] += counts[m] ?? 0;
}

const baseline = {
  _comment:
    "plan1030 批 1 快照基线。由 generate-baseline.mjs 生成；测试断言各文件各维度不得超过此值（新文件按 0 计）。清零动作完成后用脚本重压基线，只许降。",
  _totals: totals,
  files: perFile,
};

const out = join(STYLES_DIR, "__contracts__", "baseline.json");
writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n");
console.log("written:", out);
console.log("totals:", totals);
