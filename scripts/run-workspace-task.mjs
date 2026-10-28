#!/usr/bin/env node
// scripts/run-workspace-task.mjs — 纯 Node 的 moon 任务执行器（CI 兜底）
//
// 为什么需要它：
//   CI 的 typecheck / test 依赖 `moon` 的**原生二进制**（@moonrepo/cli 的
//   平台可选依赖）。2026-10-26 的 CI 全红就是这里炸的：安装阶段报
//   `Cannot find module '@moonrepo/core-linux-x64-gnu/package.json'`，
//   pnpm 退出码 1 → 所有 job 连装都装不完 → 门禁全线失效。
//
//   moon 的原生二进制是 optionalDependency，pnpm 是否装上它取决于平台的
//   os/cpu/libc 匹配；一旦不匹配，整个仓库的构建/测试/类型检查全部瘫痪。
//   门禁不该建立在一个可选的原生二进制上。
//
//   本脚本用纯 Node 复刻 CI 真正需要的那部分 moon 能力：
//   读每个项目的 moon.yml，取出某个 task 的 command/script，在项目目录里
//   跑掉，汇总成败。moon.yml 是唯一来源，本脚本不硬编码任何任务内容。
//
// 语义对齐（见各包的 moon.yml）：
//   - `command: "tsc --noEmit"`      → 在项目目录执行 `pnpm exec tsc --noEmit`
//   - `script: "..."`                 → 在项目目录执行 `sh -c "..."`
//   - moon 的 `command` 用的是 moon toolchain 的 PATH（等价于项目 +
//     仓库根的 node_modules/.bin）；`pnpm exec` 的解析范围与之吻合。
//
// 不做什么：
//   - 不解析 task 的 deps/inherits DAG。CI 需要的 typecheck / test 在每个
//     项目里都是自包含的（没有跨项目 task 依赖），逐项目跑即可。
//   - 不跑 build/dev/preview 这类需要产物顺序的任务 —— 那些仍然走 moon。
//
// 用法：
//   node scripts/run-workspace-task.mjs typecheck
//   node scripts/run-workspace-task.mjs test --concurrency 4
//   node scripts/run-workspace-task.mjs typecheck --include-root
//
// 退出码：0 = 全部通过；1 = 有任务失败；2 = 用法错误。

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import os from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const args = process.argv.slice(2);
const taskName = args.find((a) => !a.startsWith("--"));
if (!taskName) {
  console.error("用法: node scripts/run-workspace-task.mjs <task> [--concurrency N] [--include-root]");
  process.exit(2);
}

const concurrencyArg = args.indexOf("--concurrency");
const concurrency = concurrencyArg >= 0 ? Number(args[concurrencyArg + 1]) : Math.max(1, Math.min(4, (os.cpus?.().length ?? 4) - 1));
const includeRoot = args.includes("--include-root");

// 这些目录不属于 CI 的门禁范围：experimental/ 已被刻意排除在 pnpm
// workspace 之外（见 pnpm-workspace.yaml 注释），scripts/_archive 是归档。
const SCAN_ROOTS = ["packages", "apps", "electron"];
const SKIP_SEGMENTS = new Set(["node_modules", "scripts", "experimental", "_archive", "dist", "build"]);

/** @type {{dir: string, rel: string, task: {command?: string, script?: string}}[]} */
const jobs = [];

function collectProjects(dir) {
  const moonYml = join(dir, "moon.yml");
  if (existsSync(moonYml)) {
    const parsed = parseYaml(readFileSync(moonYml, "utf8")) ?? {};
    const task = parsed?.tasks?.[taskName];
    if (task && (typeof task.command === "string" || typeof task.script === "string")) {
      jobs.push({
        dir,
        rel: relative(repoRoot, dir) || ".",
        task: { command: task.command, script: task.script },
      });
    }
  }
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_SEGMENTS.has(entry.name)) continue;
    collectProjects(join(dir, entry.name));
  }
}

if (includeRoot) collectProjects(repoRoot);
for (const root of SCAN_ROOTS) {
  const abs = join(repoRoot, root);
  if (existsSync(abs)) collectProjects(abs);
}

// 根项目的 task 名字通常是 `openbuddy:<task>`（见根 moon.yml），这里同时
// 接受裸名，避免调用方为每个 task 记两套名字。
if (!includeRoot) {
  const rootMoonYml = join(repoRoot, "moon.yml");
  if (existsSync(rootMoonYml)) {
    const parsed = parseYaml(readFileSync(rootMoonYml, "utf8")) ?? {};
    const task = parsed?.tasks?.[taskName];
    if (task && (typeof task.command === "string" || typeof task.script === "string")) {
      jobs.unshift({
        dir: repoRoot,
        rel: ".",
        task: { command: task.command, script: task.script },
      });
    }
  }
}

if (jobs.length === 0) {
  console.error(`没有任何项目定义了 task "${taskName}"。`);
  process.exit(2);
}

console.log(`执行 moon task "${taskName}"：${jobs.length} 个项目，并发 ${concurrency}\n`);

function runJob(job) {
  return new Promise((resolveJob) => {
    const isScript = typeof job.task.script === "string";
    const cmd = isScript ? "sh" : "pnpm";
    const argv = isScript ? ["-c", job.task.script] : ["exec", ...job.task.command.split(/\s+/)];

    const child = spawn(cmd, argv, {
      cwd: job.dir,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      out += d.toString();
    });

    const started = Date.now();
    child.on("close", (code) => {
      resolveJob({ job, code, out, ms: Date.now() - started });
    });
  });
}

const results = [];
let cursor = 0;

async function worker() {
  while (cursor < jobs.length) {
    const index = cursor++;
    const result = await runJob(jobs[index]);
    results[index] = result;
    const status = result.code === 0 ? "PASS" : "FAIL";
    const seconds = (result.ms / 1000).toFixed(1);
    console.log(`${status}  ${result.job.rel}  (${seconds}s)`);
    if (result.code !== 0) {
      const tail = result.out.split("\n").slice(-40).join("\n");
      console.log(`----- ${result.job.rel} 输出尾部 -----\n${tail}\n`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

const failed = results.filter((r) => r && r.code !== 0);
const total = results.filter(Boolean).length;
console.log(`\n${taskName}: ${total - failed.length}/${total} 通过，${failed.length} 失败。`);
if (failed.length > 0) {
  console.log(`失败项目: ${failed.map((r) => r.job.rel).join(", ")}`);
  process.exit(1);
}
