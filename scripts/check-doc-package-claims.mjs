#!/usr/bin/env node
// scripts/check-doc-package-claims.mjs — 文档/官网提到的 @openbuddy/* 包必须真实存在
//
// 为什么需要：
//   这个仓库反复出现同一类问题 —— 文档和官网宣传的包名在仓库里根本不存在。
//   2026-10 的真实案例：README 与官网列了
//     @openbuddy/capability-{plan,task,automation,web-search,inspiration,notification,memory}
//     @openbuddy/team-subagent / @openbuddy/runtime-{cordis,storage}
//     @openbuddy/extension-{mcp,skills} / @openbuddy/provider-*
//   一个都不存在。plan/task/automation/web-search 实际是
//   electron/main/agent/pi-extensions.ts 里的 Pi 扩展，不是包。
//   docs/EXAMPLES.md 的代码示例还 import 了不存在的 @openbuddy/agent。
//
//   这类"说假话"不会被 typecheck 抓到（文档不参与编译），只能靠门禁。
//
// 判定：
//   扫描面向用户的文档与官网源码里出现的 @openbuddy/<name>；
//   若该名字既不是真实 package.json 的 name，也不属于"已归档且已声明"白名单，
//   也不带通配符（如 @openbuddy/ui-*），就报错。
//
// 用法：node scripts/check-doc-package-claims.mjs
// 退出码：0 = 通过；1 = 发现不存在的包名。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const git = (args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// ---- 1. 真实存在的 @openbuddy/* 包 ----
const real = new Set();
for (const rel of git(["ls-files", "packages/**/package.json"]).split("\n").filter(Boolean)) {
  try {
    const name = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")).name;
    if (typeof name === "string" && name.startsWith("@openbuddy/")) real.add(name);
  } catch {
    // 坏 manifest 由 typecheck 负责；这里只做声明核对。
  }
}
// apps 下的包（官网自身）也算真实存在的名字。
for (const rel of git(["ls-files", "apps/**/package.json"]).split("\n").filter(Boolean)) {
  try {
    const name = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")).name;
    if (typeof name === "string" && name.startsWith("@openbuddy/")) real.add(name);
  } catch {}
}

// ---- 2. 已归档、允许在"有归档声明"的文件里出现 ----
const ARCHIVED = new Set([
  "@openbuddy/payment",
  "@openbuddy/saml",
  "@openbuddy/scim",
  "@openbuddy/webhook-outbox",
  "@openbuddy/bundle-desktop",
]);
const ARCHIVE_NOTE = /(归档|archived|git 历史|git history|2438a2ab|不在仓库树|not in the tree|never existed|从未存在|does not exist|Neither exists|There is no|no such package|不存在)/i;

/**
 * 显式豁免：教程/占位内容会引用"读者即将创建"的包名，那是合法的。
 * 在文件任意位置写一行
 *   <!-- doc-pkg-claims: allow @openbuddy/foo, @openbuddy/bar -->
 * 该文件里的这些名字就不再报错。要求显式声明，是为了让"放过什么"可审计，
 * 而不是靠正则猜"这看起来像教程"。
 */
const ALLOW_RE = /<!--\s*doc-pkg-claims:\s*allow\s+([^>]+?)\s*-->/g;
function allowedIn(text) {
  const set = new Set();
  for (const m of text.matchAll(ALLOW_RE)) {
    for (const name of m[1].split(/[,\s]+/)) {
      if (name.startsWith("@openbuddy/")) set.add(name);
    }
  }
  return set;
}

// ---- 3. 扫描范围：面向用户的文档 + 官网源码 ----
//      历史计划 / CHANGELOG / 分析快照不在范围内（它们描述的是当时的状态，
//      已在各自顶部标注过期说明）。
const SCAN = [
  ...git([
    "ls-files",
    "README.md",
    "README.en.md",
    "README.zh-CN.md",
    "SECURITY.md",
    "SECURITY.zh-CN.md",
    "POSITIONING.md",
    "CONTRIBUTING.md",
  ])
    .split("\n")
    .filter(Boolean),
  ...git([
    "ls-files",
    "docs/ARCHITECTURE.md",
    "docs/ARCHITECTURE.zh-CN.md",
    "docs/EXAMPLES.md",
    "docs/FAQ.md",
    "docs/FAQ.zh-CN.md",
    "docs/GETTING_STARTED.md",
    "docs/GETTING_STARTED.zh-CN.md",
    "docs/PLUGIN_DEVELOPMENT.md",
    "docs/OPERATIONS.md",
    "docs/COMPARISON.md",
    "docs/RELEASING.md",
  ])
    .split("\n")
    .filter(Boolean),
  ...git(["ls-files", "apps/openbuddy-website/src"])
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f)),
];

// 完整包名：后面不能再接字母数字或连字符（排除 `@openbuddy/ui-*` 这类前缀写法）
const PKG_RE = /@openbuddy\/[a-z0-9][a-z0-9-]*(?![a-z0-9-])/g;

const problems = [];
let scannedFiles = 0;
for (const rel of SCAN) {
  let text;
  try {
    text = readFileSync(join(repoRoot, rel), "utf8");
  } catch {
    continue;
  }
  scannedFiles += 1;
  if (rel.includes("THIRD-PARTY-NOTICES")) continue;

  const allowed = allowedIn(text);
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    for (const m of line.matchAll(PKG_RE)) {
      const pkg = m[0];
      if (real.has(pkg)) continue;
      if (allowed.has(pkg)) continue;
      // 通配/花括号写法（`@openbuddy/ui-*`、`@openbuddy/capability-{plan,task}`）
      // 描述的是一个模式，不是具体包名。
      if (line.includes(`${pkg}*`) || line.includes(`${pkg}{`)) continue;
      // 已归档包：该行或该文件有归档声明即可。
      if (ARCHIVED.has(pkg) && (ARCHIVE_NOTE.test(line) || ARCHIVE_NOTE.test(text))) continue;
      // "不存在 X" / "never existed" 这类更正说明本身允许提到旧名字。
      if (ARCHIVE_NOTE.test(line)) continue;
      problems.push({ file: rel, line: i + 1, pkg, text: line.trim().slice(0, 160) });
    }
  }
}

if (problems.length === 0) {
  console.log(
    `文档包名门禁通过：扫描 ${scannedFiles} 个面向用户的文件，提到的 @openbuddy/* 均真实存在（真实包 ${real.size} 个）。`,
  );
  process.exit(0);
}

console.error(`文档包名门禁失败：${problems.length} 处引用了不存在的 @openbuddy/* 包。\n`);
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}  ${p.pkg}`);
  console.error(`      ${p.text}`);
}
console.error(
  "\n修复：把包名改成真实存在的包（见 docs/stats.json / ls packages），" +
    "或如果它其实是 Pi 扩展/其它机制，改成如实描述。\n" +
    "历史文档若必须保留旧名，请在文件顶部加过期/归档声明。",
);
process.exit(1);
