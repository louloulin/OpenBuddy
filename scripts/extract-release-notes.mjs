#!/usr/bin/env node
/**
 * scripts/extract-release-notes.mjs — 从 `CHANGELOG.md` 抽出某个版本的段落。
 *
 * 为什么需要它:`softprops/action-gh-release` 的正文此前由一段内联 `awk`
 * 生成,而那段 awk 写的是 `^## v`(H2)。但 `CHANGELOG.md` 的版本标题实际是
 * **`### v0.15.0 …`(H3)** —— 于是每次发布都匹配不到,正文永远退化成
 * 「CHANGELOG.md 未包含该段落,以下为自动生成的提交列表」。
 *
 * 本脚本按**真实标题层级**匹配(H2–H4 都认),并做两件内联 awk 做不到的事:
 *   1. 按标题级别判断段落边界(同级或更高级的下一个版本标题 = 段落结束),
 *      而不是靠 `---` 分隔线;
 *   2. 显式跳过「Milestone / 里程碑」这类嵌在版本段落里的历史小节,以及
 *      `### Earlier releases` / `## 早期版本` 之后的全部历史内容。
 *
 * 用法:
 *   node scripts/extract-release-notes.mjs v0.16.0        # 打印段落
 *   node scripts/extract-release-notes.mjs 0.16.0         # v 前缀可省
 *   node scripts/extract-release-notes.mjs v0.16.0 --json # {"found":true,...}
 *
 * 退出码:
 *   0 命中(或 --json 模式)
 *   1 参数错误
 *   2 没找到该版本段落(调用方据此回退到提交列表)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const raw = args.find((arg) => !arg.startsWith("--"));

const version = raw?.trim().replace(/^v/, "");
if (!version) {
  console.error("usage: node scripts/extract-release-notes.mjs <version> [--json]");
  process.exit(1);
}

const changelogPath = join(repoRoot, "CHANGELOG.md");
if (!existsSync(changelogPath)) {
  if (asJson) console.log(JSON.stringify({ found: false, version, reason: "CHANGELOG.md missing" }));
  process.exit(2);
}
const lines = readFileSync(changelogPath, "utf8").split(/\r?\n/);

/** `### v0.16.0 (2026-09-22) — headline` → { level:3, version:"0.16.0" } */
const versionHeading = (line) => {
  const match = line.match(/^(#{2,4})\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  return match ? { level: match[1].length, version: match[2] } : null;
};

/** 版本段落到此为止的历史分界标题。 */
const HISTORY_BOUNDARY = /^(#{2,4})\s+(Earlier releases|早期版本)\s*$/i;
/** 版本段落内部的「里程碑」小节:属于历史,不进 release 正文。 */
const MILESTONE_HEADING = /^(#{3,5})\s+(Milestone\b|里程碑)/i;

let start = -1;
let level = 0;
for (let index = 0; index < lines.length; index += 1) {
  const heading = versionHeading(lines[index]);
  if (heading?.version === version) {
    start = index;
    level = heading.level;
    break;
  }
}

if (start < 0) {
  if (asJson) console.log(JSON.stringify({ found: false, version, reason: "section not found" }));
  else console.error(`no section for v${version} in CHANGELOG.md`);
  process.exit(2);
}

const body = [];
for (let index = start + 1; index < lines.length; index += 1) {
  const line = lines[index];
  if (HISTORY_BOUNDARY.test(line)) break;
  const heading = versionHeading(line);
  if (heading && heading.level <= level) break; // 下一个版本段落
  if (MILESTONE_HEADING.test(line)) break;      // 历史里程碑之后全是历史
  body.push(line);
}

// 去掉首尾空行 + 末尾的 `---` 分隔线(调用方自己决定怎么排版)。
while (body.length && body[0].trim() === "") body.shift();
while (body.length && (body[body.length - 1].trim() === "" || body[body.length - 1].trim() === "---")) body.pop();

const notes = body.join("\n");
if (asJson) {
  console.log(JSON.stringify({ found: true, version, level, lineCount: body.length, notes }, null, 2));
} else {
  console.log(notes);
}
process.exit(0);
