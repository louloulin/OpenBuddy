#!/usr/bin/env node
// scripts/docs-stats.mjs — 生成 docs/stats.json(仓内数字的唯一来源)
//
// 为什么需要：
//   仓里的文档到处写死"309 个测试文件""66 个 project""350K LOC"这类数字,
//   而实测值早就不是这样了(测试文件 1000、project 66+)。三个 README 甚至
//   写着三个不同的测试文件数(455 / 3047 / 455)。
//
//   这类数字的意义是"证明这是真项目",但它同时也是**最容易变成假话**的
//   地方 —— 每加一个测试文件,文档就开始撒谎,而且没人会发现。
//
// 所以:数字只保留一份,放在 docs/stats.json,由脚本生成;
//   文档正文不再写死数字,改为指向这份文件;
//   CI 里跑 scripts/check-doc-stats.mjs,文件过期就让门禁红。
//
// 用法：
//   node scripts/docs-stats.mjs           # 打印
//   node scripts/docs-stats.mjs --write   # 写回 docs/stats.json
//
// 退出码：0 = 成功（--write 模式总是 0）；1 = 统计失败。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const write = process.argv.includes("--write");

function gitFiles(patterns) {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--", ...patterns], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

const testFiles = gitFiles([
  "*.test.ts",
  "*.test.tsx",
  "*.test.mjs",
  "*.test.js",
  "*.spec.ts",
  "*.spec.tsx",
  "*.spec.mjs",
  "*.spec.js"
]);

const workflows = gitFiles([".github/workflows/*.yml", ".github/workflows/*.yaml"]);
const docs = gitFiles(["*.md"]);
const moonProjects = gitFiles(["**/moon.yml"]);

/** workspace package 数(pnpm-workspace.yaml 里 packages 字段能列出的)。 */
function workspacePackageCount() {
  // 仓内的 package.json 全集(排除根),再扣掉 pnpm workspace 之外的目录。
  const all = gitFiles(["package.json", "*/package.json", "*/*/package.json", "*/*/*/package.json"]);
  const outside = new Set(["crates", "experimental", "scripts", "services", "deploy", "docs"]);
  let count = 0;
  for (const rel of all) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    if (!dir) continue; // 根 package.json
    if (outside.has(dir.split("/")[0])) continue;
    if (dir.startsWith("node_modules")) continue;
    count++;
  }
  return count;
}

const stats = {
  _comment:
    "本文件由 scripts/docs-stats.mjs 生成,不要手工编辑。CI 的 scripts/check-doc-stats.mjs 会校验它是否与仓库现状一致,过期即门禁失败。",
  generatedFrom: "git ls-files (tracked files only)",
  testFiles: testFiles.length,
  moonProjects: moonProjects.length,
  workspacePackages: workspacePackageCount(),
  workflows: workflows.length,
  markdownDocs: docs.length
};

const json = `${JSON.stringify(stats, null, 2)}\n`;

if (write) {
  const outPath = join(repoRoot, "docs", "stats.json");
  writeFileSync(outPath, json);
  console.log(`已写入 ${outPath}`);
} else {
  process.stdout.write(json);
}
