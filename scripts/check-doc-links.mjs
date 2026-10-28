#!/usr/bin/env node
// scripts/check-doc-links.mjs — 仓内 Markdown 相对链接门禁
//
// 为什么不用 lychee：lychee 只能报"哪条链接坏了"，不能定位"是不是把
// 本机绝对路径写进了文档"，而且它的失败退出码在本仓长期是 2（无法归因，
// 修不掉）。本脚本自包含、可本地跑、判定明确。
//
// 本脚本做两件事：
//   1. 相对链接的目标文件必须存在（忽略 http/mailto/# 锚点/data:）
//   2. 文档里不允许出现指向本机文件系统的绝对路径链接
//
// 范围：**只检查 git 已跟踪的 markdown**。本仓 .gitignore 里有 `docs/*`，
// 工作区里存在大量未跟踪的文档草稿；CI 拿到的 checkout 只含已跟踪文件，
// 按工作区扫描会得出与 CI 不一致的结论。
//
// 退出码：0 = 全过；1 = 有死链或绝对路径链接。
//
// 用法：node scripts/check-doc-links.mjs [--list]

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const listOnly = process.argv.includes("--list");

// 第三方许可原文：里面的相对路径是相对于各个上游仓的，对本仓无效。
// 与 .github/workflows/ci.yml 里 lychee 的 --exclude-path 保持一致。
const SKIP_FILES = new Set(["THIRD-PARTY-NOTICES.md"]);

/** @type {string[]} */
const markdownFiles = [];

function listTrackedMarkdown() {
  let out = "";
  try {
    out = execFileSync("git", ["ls-files", "-z", "--", "*.md"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out.split("\0").filter(Boolean);
}

for (const rel of listTrackedMarkdown()) {
  if (SKIP_FILES.has(rel.split("/").pop())) continue;
  markdownFiles.push(resolve(repoRoot, rel));
}

const LINK_RE = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const ABSOLUTE_PATH_RE = /\]\(\s*<?\/(?:Users|home|root|var|opt|tmp|private)\//g;

const broken = [];
const absolutePathLinks = [];

for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  const relFile = relative(repoRoot, file);

  // 1) 机器专属绝对路径链接
  for (const match of text.matchAll(ABSOLUTE_PATH_RE)) {
    const start = match.index ?? 0;
    const line = text.slice(0, start).split("\n").length;
    absolutePathLinks.push({ file: relFile, line, snippet: match[0] });
  }

  // 2) 相对链接目标是否存在
  let match;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(text)) !== null) {
    const raw = match[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue;
    if (raw.startsWith("/")) continue; // 绝对路径由上面第 1 条单独处理
    const withoutAnchor = raw.split("#")[0];
    if (!withoutAnchor) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutAnchor);
    } catch {
      decoded = withoutAnchor;
    }
    if (!decoded) continue;
    const target = resolve(dirname(file), decoded);
    if (existsSync(target)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    broken.push({ file: relFile, line, link: raw });
  }
}

const total = broken.length + absolutePathLinks.length;

if (listOnly || total > 0) {
  if (absolutePathLinks.length > 0) {
    console.log(`\n绝对路径链接（机器专属，禁止写入文档）: ${absolutePathLinks.length}`);
    for (const item of absolutePathLinks) {
      console.log(`  ${item.file}:${item.line}  ${item.snippet}`);
    }
  }
  if (broken.length > 0) {
    console.log(`\n死链（相对路径目标不存在）: ${broken.length}`);
    for (const item of broken) {
      console.log(`  ${item.file}:${item.line}  ->  ${item.link}`);
    }
  }
}

console.log(
  `\n扫描 ${markdownFiles.length} 个 markdown 文件，发现 ${total} 个问题（死链 ${broken.length} / 绝对路径 ${absolutePathLinks.length}）。`,
);

process.exit(total > 0 ? 1 : 0);
