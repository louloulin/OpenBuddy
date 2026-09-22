#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — 把版本号从「散落各处」收敛成「一条命令改完」。
 *
 * 背景:OpenBuddy 的版本号不只活在 `package.json`。它同时被下面这些地方消费,
 * 任何一处漏改都会在发布时变成真实的偏差 ——
 *
 *   1. 74 个 workspace 包的 `package.json#version`;
 *   2. Electron 主进程传给 Pi 扩展市场的 `hostVersion`(引擎区间校验);
 *   3. 官网的 `softwareVersion`(JSON-LD)、安装包文件名、i18n 版本 chip;
 *   4. `examples/` 下三个示例插件的 manifest;
 *   5. DMG / onboarding 真机探针里写死的当前构建版本。
 *
 * **不包含**测试 fixture(`__fixtures__/`、`tests/fixtures/`):它们是「老版本
 * 插件」的样本数据,故意停留在旧版本号,跟着 bump 会让 e2e 断言失去意义。
 *
 * 以前只能靠 `pnpm -r version` 改第 1 类,其余手改 —— 手改必漏。本脚本把
 * **单一来源**定义成这里的 `SITES` 表:改版本号只走一条路径,改完还自检。
 *
 * 用法:
 *   node scripts/bump-version.mjs 0.16.0
 *   node scripts/bump-version.mjs 0.16.0 --dry-run   # 只报告,不落盘
 *   node scripts/bump-version.mjs 0.16.0 --json      # 机器可读报告
 *   node scripts/bump-version.mjs --current          # 打印当前版本
 *
 * 退出码:
 *   0 成功(dry-run 亦然)
 *   1 参数错误 / 版本号非法 / 目标版本与当前相同
 *   2 落盘后自检失败
 */
import { readFileSync, writeFileSync, existsSync, globSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positionals = args.filter((arg) => !arg.startsWith("--"));
const dryRun = flags.has("--dry-run");
const asJson = flags.has("--json");

const readJson = (relative) => JSON.parse(readFileSync(join(repoRoot, relative), "utf8"));

const currentVersion = readJson("package.json").version;

if (flags.has("--current")) {
  console.log(currentVersion);
  process.exit(0);
}

const nextVersion = positionals[0]?.trim().replace(/^v/, "");
if (!nextVersion) {
  console.error("usage: node scripts/bump-version.mjs <version> [--dry-run] [--json]");
  process.exit(1);
}
if (!SEMVER_RE.test(nextVersion)) {
  console.error(`invalid semver: ${nextVersion}`);
  process.exit(1);
}
if (nextVersion === currentVersion) {
  console.error(`target version equals current version (${currentVersion}); nothing to do`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. 需要改 version 字段的 package.json
//
// 来源是 `pnpm-workspace.yaml` 的 `packages:` 块 —— 新增一个分组目录时脚本
// 自动跟上,不需要回来改这个文件。`services/` 不是 pnpm workspace 成员
// (独立部署单元),但它跟应用同版本,单独列出。
// ---------------------------------------------------------------------------
function workspaceGlobs() {
  const globs = [];
  let inPackages = false;
  for (const line of readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/)) {
    if (/^packages:/.test(line)) { inPackages = true; continue; }
    if (!inPackages) continue;
    const entry = line.match(/^\s+-\s+'([^']+)'\s*$/);
    if (entry) { globs.push(entry[1]); continue; }
    if (/^\S/.test(line)) break;
  }
  return globs;
}

const manifestPaths = new Set(["package.json"]);
for (const glob of workspaceGlobs()) {
  if (glob === ".") continue;
  const pattern = `${glob}/package.json`;
  for (const hit of globSync(pattern, { cwd: repoRoot, exclude: (name) => name === "node_modules" })) {
    manifestPaths.add(hit);
  }
}
for (const service of ["services/casdoor-resource-gateway/package.json"]) {
  if (existsSync(join(repoRoot, service))) manifestPaths.add(service);
}

// 测试 fixture(`__fixtures__/`、`tests/fixtures/`)故意保留旧版本号:它们是
// 「老版本插件」的样本数据,跟着 bump 会让 e2e 断言失去意义。
const isFixture = (relative) => relative.includes("__fixtures__/") || relative.includes("tests/fixtures/");

// ---------------------------------------------------------------------------
// 2. 非 package.json 的版本站点
//
// 每个站点是一条精确重写规则。全部用「形态锚点」(前缀/字段名)而不是裸版本
// 字符串替换,避免误伤 CHANGELOG 里同版本号的历史段落。
// ---------------------------------------------------------------------------
const SITES = [
  {
    path: "electron/main/ipc/index.ts",
    why: "Pi 扩展市场 hostVersion(引擎区间校验)",
    rewrite: (t) => t.replace(/(hostVersion:\s*")[0-9][^"]*(")/g, `$1${nextVersion}$2`),
  },
  {
    path: "apps/openbuddy-website/src/app/layout.tsx",
    why: "官网 JSON-LD softwareVersion",
    rewrite: (t) => t.replace(/(softwareVersion:\s*')[^']*(')/g, `$1${nextVersion}$2`),
  },
  {
    path: "apps/openbuddy-website/src/components/DownloadView.tsx",
    why: "官网下载区安装包文件名",
    rewrite: (t) => t
      .replace(/(OpenBuddy-)[0-9]+\.[0-9]+\.[0-9]+/g, `$1${nextVersion}`)
      .replace(/(openbuddy_)[0-9]+\.[0-9]+\.[0-9]+/g, `$1${nextVersion}`),
  },
  {
    path: "apps/openbuddy-website/src/lib/i18n.ts",
    why: "官网 i18n 版本 chip / 安装标签",
    rewrite: (t) => t
      .replace(/(chip:\s*`v)[0-9]+\.[0-9]+\.[0-9]+/g, `$1${nextVersion}`)
      .replace(/(installLabel:\s*'[^']*?v)[0-9]+\.[0-9]+\.[0-9]+/g, `$1${nextVersion}`),
  },
  ...[
    "examples/openbuddy-plugin-hello",
    "examples/openbuddy-plugin-toolbar",
    "examples/openbuddy-plugin-slash",
  ].flatMap((dir) => [
    {
      path: `${dir}/manifest.json`,
      why: "示例插件 manifest 版本",
      rewrite: (t) => t.replace(/("version":\s*")[0-9][^"]*(")/, `$1${nextVersion}$2`),
    },
    {
      path: `${dir}/index.tsx`,
      why: "示例插件 defineExtension 版本",
      rewrite: (t) => t.replace(/(version:\s*")[0-9][^"]*(")/, `$1${nextVersion}$2`),
    },
  ]),
  {
    path: "scripts/electron/_probe-r23-onboarding-surface.mjs",
    why: "R23 真机探针:WhatsNew lastSeen 落盘的是当前应用版本",
    rewrite: (t) => t.replace(
      /(lastSeen === ")[0-9]+\.[0-9]+\.[0-9]+(")/,
      `$1${nextVersion}$2`,
    ),
  },
  {
    path: "scripts/electron/_probe-r23-onboarding-surface.test.mjs",
    why: "R23 探针 CI 包装:断言摘要卡版本号 = 当前应用版本",
    rewrite: (t) => t.replace(
      /(probe\.whatsNew\.version\)\.toContain\(")[0-9]+\.[0-9]+\.[0-9]+("\))/,
      `$1${nextVersion}$2`,
    ),
  },
  {
    path: "scripts/electron/probe-dmg.mjs",
    why: "DMG 真机探针:挂载卷名含构建版本",
    rewrite: (t) => t.replace(
      /(\/Volumes\/OpenBuddy )[0-9]+\.[0-9]+\.[0-9]+/,
      `$1${nextVersion}`,
    ),
  },
  {
    path: "scripts/electron/probe-dmg2.mjs",
    why: "DMG 真机探针 v2:挂载卷名含构建版本",
    rewrite: (t) => t.replace(
      /(\/Volumes\/OpenBuddy )[0-9]+\.[0-9]+\.[0-9]+/,
      `$1${nextVersion}`,
    ),
  },
];

// ---------------------------------------------------------------------------
// 3. 执行
// ---------------------------------------------------------------------------
const changes = [];
const problems = [];

for (const relative of [...manifestPaths].sort()) {
  if (isFixture(relative)) continue;
  const absolute = join(repoRoot, relative);
  if (!existsSync(absolute)) continue;
  const raw = readFileSync(absolute, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    problems.push(`${relative}: not valid JSON (${error.message})`);
    continue;
  }
  // 只改「跟仓库根同版本」的包:落后或超前的包有自己的节奏,不能盲改。
  if (manifest.version !== currentVersion) continue;
  const indent = raw.match(/^\{\r?\n(\s+)"/)?.[1] ?? "  ";
  const written = JSON.stringify({ ...manifest, version: nextVersion }, null, indent) + (raw.endsWith("\n") ? "\n" : "");
  changes.push({ path: relative, kind: "manifest", why: "package.json version" });
  if (!dryRun) writeFileSync(absolute, written, "utf8");
}

for (const site of SITES) {
  const absolute = join(repoRoot, site.path);
  if (!existsSync(absolute)) {
    problems.push(`${site.path}: missing (${site.why})`);
    continue;
  }
  const before = readFileSync(absolute, "utf8");
  const after = site.rewrite(before);
  if (after === before) continue;
  changes.push({ path: site.path, kind: "site", why: site.why });
  if (!dryRun) writeFileSync(absolute, after, "utf8");
}

// 4. 落盘后自检 —— 静默失败比报错更贵。
if (!dryRun) {
  for (const change of changes) {
    const text = readFileSync(join(repoRoot, change.path), "utf8");
    if (change.kind === "manifest") {
      try {
        if (JSON.parse(text).version !== nextVersion) problems.push(`${change.path}: version did not stick`);
      } catch {
        problems.push(`${change.path}: became invalid JSON after write`);
      }
    } else if (!text.includes(nextVersion)) {
      problems.push(`${change.path}: ${nextVersion} not present after rewrite`);
    }
  }
}

const report = {
  schema: "openbuddy.version-bump.v1",
  from: currentVersion,
  to: nextVersion,
  dryRun,
  changeCount: changes.length,
  changes,
  problems,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${dryRun ? "[dry-run] would bump" : "bumped"} ${currentVersion} → ${nextVersion} across ${changes.length} file(s):`);
  for (const change of changes) console.log(`  • ${change.path} — ${change.why}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
  }
}
process.exit(problems.length ? 2 : 0);
