#!/usr/bin/env node
// scripts/check-doc-stats.mjs — 校验 docs/stats.json 与仓库现状一致
//
// 背景见 scripts/docs-stats.mjs:仓内文档到处写死的数字(309 个测试文件等)
// 与实测值早就对不上了,而且没人会发现。这个门禁让数字只有一份、
// 且永远是真的。
//
// 判定:重新生成 stats.json,与仓库里已提交的那份逐字节比较。
//   一致 → exit 0
//   不一致 → 打印差异 + 修复命令,exit 1
//
// 用法:node scripts/check-doc-stats.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const statsPath = join(repoRoot, "docs", "stats.json");

if (!existsSync(statsPath)) {
  console.error("docs/stats.json 不存在。生成命令:node scripts/docs-stats.mjs --write");
  process.exit(1);
}

let fresh;
try {
  fresh = execFileSync("node", [join(repoRoot, "scripts", "docs-stats.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
} catch (err) {
  console.error(`生成 stats 失败:${err.message}`);
  process.exit(1);
}

const committed = readFileSync(statsPath, "utf8");

if (committed === fresh) {
  console.log("docs/stats.json 与仓库现状一致。");
  process.exit(0);
}

const a = JSON.parse(committed);
const b = JSON.parse(fresh);
const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

console.error("docs/stats.json 已过期 —— 仓库现状变了,文档数字会开始说假话。\n");
for (const key of keys) {
  if (key === "_comment") continue;
  if (a[key] !== b[key]) {
    console.error(`  ${key}: 文档里写 ${JSON.stringify(a[key])},实际 ${JSON.stringify(b[key])}`);
  }
}
console.error("\n修复:node scripts/docs-stats.mjs --write");
process.exit(1);
