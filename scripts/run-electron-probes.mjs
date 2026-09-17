#!/usr/bin/env node
/**
 * scripts/run-electron-probes.mjs — 串行跑所有 Electron 真机探针。
 *
 * 为什么需要单独一个 runner:
 *   每个 `_probe-*.test.mjs` / `_shot-*.test.mjs` wrapper 都会 `spawnSync` 一个
 *   真实 Electron 进程(独立 temp user-data 目录,~2.5s 渲染器预热 + 完整 app
 *   启动)。用 `vitest run` 全量跑时,多个文件被分到不同 worker 并发执行,机器
 *   被同时启动的 4-6 个 Electron 拖垮,最慢的几个在 wrapper 的 120s 预算上超时
 *   —— 这是并发竞争,不是断言失败(R43 / R50 单独跑都是全绿)。
 *
 * 用法:
 *   node scripts/run-electron-probes.mjs              # 串行跑全部
 *   node scripts/run-electron-probes.mjs r65 r43      # 只跑名字匹配的
 *
 * 每个文件用 `vitest run <file>` 单独起一个进程(不与别的探针共享 worker),
 * 串行执行,单个失败不阻断后续,最后汇总退出码。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "scripts", "electron");

const filters = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => (filters.length ? filters.some((needle) => f.includes(needle)) : true))
  .sort();

if (files.length === 0) {
  console.error("no probe files matched", filters);
  process.exit(1);
}

console.log(`▶ 串行跑 ${files.length} 个 Electron 探针\n`);

const results = [];
for (const file of files) {
  const started = Date.now();
  process.stdout.write(`  ${file} ... `);
  const r = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", join("scripts", "electron", file), "--reporter=basic"],
    { cwd: root, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const ms = Date.now() - started;
  const ok = r.status === 0;
  const tail = (r.stdout || "").split("\n").filter((l) => /Tests?\s+\d/.test(l)).join(" | ");
  console.log(ok ? `✓ ${(ms / 1000).toFixed(1)}s` : `✗ ${(ms / 1000).toFixed(1)}s`);
  if (!ok) console.log(`     ${tail || (r.stderr || "").slice(-300)}`);
  results.push({ file, ok, ms });
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "✓ 全绿" : "✗ 有失败"}: ${results.length - failed.length}/${results.length} 通过`,
);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.file}`);
}
process.exit(failed.length === 0 ? 0 : 1);
