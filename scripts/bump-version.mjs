#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — 把版本号从「散落各处」收敛成「一条命令改完」。
 *
 * 背景:OpenBuddy 的版本号首先活在仓库根 `package.json`(其它 74 个 workspace
 * 包 + 1 个 services 包跟随)。它同时被以下两类「版本消费点」引用:
 *
 *   - 「跟随 bump 改写」类 —— 字面量版本,必须跟着新版本走:
 *       * 所有 `package.json`(`pnpm-workspace.yaml` 的 `packages:` 块派生);
 *       * `examples/*` 三个示例插件的 manifest / defineExtension。
 *
 *   - 「从配置读源」类 —— 这些文件已经从硬编码改成 `app.getVersion()` /
 *     `SITE_VERSION` / `APP_VERSION` / 读自己的 `package.json`,但 bummp
 *     时还得确认它们**没有遗漏的字面量版本**。脚本会扫这些文件,若发现
 *     硬编码就报错(退出码 2)。
 *
 * 测试 fixture(`__fixtures__/`、`tests/fixtures/`)故意保留旧版本号:它们是
 * 「老版本插件」的样本数据,跟着 bump 会让 e2e 断言失去意义。
 *
 * 用法:
 *   node scripts/bump-version.mjs <X.Y.Z>
 *   node scripts/bump-version.mjs <X.Y.Z> --dry-run   # 只报告,不落盘
 *   node scripts/bump-version.mjs <X.Y.Z> --json      # 机器可读报告
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
// 2. SITES 表 —— 两类「版本消费点」的合并注册表
//
//   `rewrite: (text) => text`  —— 「跟随 bump 改写」:用形态锚点替换字面量。
//                                  用锚点(前缀/字段名)而不是裸版本字符串,
//                                  避免误伤 CHANGELOG 里同版本号的历史段落。
//
//   `expectNoLiteral: RegExp`  —— 「守卫」:文件应该从配置读源,本脚本只验证
//                                  没有遗漏的字面量。命中就报错(退出码 2)。
// ---------------------------------------------------------------------------
const SITES = [
  // 仍然是「单一来源硬编码」的位置 —— 跟着 bump 走。
  ...[
    "examples/openbuddy-plugin-hello",
    "examples/openbuddy-plugin-toolbar",
    "examples/openbuddy-plugin-slash",
  ].flatMap((dir) => [
    {
      path: `${dir}/manifest.json`,
      why: "示例插件 manifest 版本(每个插件独立声明自己的版本)",
      rewrite: (t) => t.replace(/("version":\s*")[0-9][^"]*(")/, `$1${nextVersion}$2`),
    },
    {
      path: `${dir}/index.tsx`,
      why: "示例插件 defineExtension 版本(同上)",
      rewrite: (t) => t.replace(/(version:\s*")[0-9][^"]*(")/, `$1${nextVersion}$2`),
    },
  ]),

  // 「已经从硬编码改成读源」的位置 —— 不再需要 bump 时改写,但要确认它们
  // 真的没有遗留字面量(否则下次 release 会再次漂移)。
  {
    path: "electron/main/ipc/index.ts",
    why: "Pi 扩展市场 hostVersion 应该读 `app.getVersion()`,不能有字面量",
    expectNoLiteral: /(hostVersion:\s*")[0-9][^"]*(")/,
  },
  {
    path: "apps/openbuddy-website/src/app/layout.tsx",
    why: "官网 JSON-LD softwareVersion 应该读 `SITE_VERSION`,不能有字面量",
    expectNoLiteral: /(softwareVersion:\s*')[0-9][^']*(')/,
  },
  {
    path: "apps/openbuddy-website/src/components/DownloadView.tsx",
    why: "官网安装包文件名应该拼 `${SITE_VERSION}`,不能有字面量",
    expectNoLiteral: /(OpenBuddy-)[0-9]+\.[0-9]+\.[0-9]+|(openbuddy_)[0-9]+\.[0-9]+\.[0-9]+/,
  },
  {
    path: "apps/openbuddy-website/src/lib/i18n.ts",
    why: "官网 i18n chip / installLabel 应该拼 `${SITE_VERSION_TAG}`,不能有字面量",
    expectNoLiteral: /(chip:\s*`v)[0-9]+\.[0-9]+\.[0-9]+|(installLabel:\s*'[^']*?v)[0-9]+\.[0-9]+\.[0-9]+/,
  },
  {
    path: "scripts/electron/_probe-r23-onboarding-surface.mjs",
    why: "R23 真机探针应该读 `APP_VERSION`,不能有字面量",
    expectNoLiteral: /lastSeen === "[0-9]\.[0-9]+\.[0-9]+"/,
  },
  {
    path: "scripts/electron/_probe-r23-onboarding-surface.test.mjs",
    why: "R23 探针 CI 包装应该读 `APP_VERSION`,不能有字面量",
    expectNoLiteral: /toContain\("[0-9]+\.[0-9]+\.[0-9]+"\)/,
  },
  {
    path: "scripts/electron/probe-dmg.mjs",
    why: "DMG 探针应该读 `APP_VERSION`,不能有字面量",
    expectNoLiteral: /\/Volumes\/OpenBuddy [0-9]+\.[0-9]+\.[0-9]+/,
  },
  {
    path: "scripts/electron/probe-dmg2.mjs",
    why: "DMG 探针 v2 应该读 `APP_VERSION`,不能有字面量",
    expectNoLiteral: /\/Volumes\/OpenBuddy [0-9]+\.[0-9]+\.[0-9]+/,
  },
  {
    path: "packages/capability/openbuddy-mcp-client/src/index.ts",
    why: "MCP 客户端 SDK 标识应该读自己的 package.json,不能有字面量",
    expectNoLiteral: /\{\s*name:\s*"openbuddy",\s*version:\s*"[0-9][^"]*"\s*\}/,
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
  if (site.expectNoLiteral) {
    // 这类文件已经从「硬编码」改成「读源」—— 验证没有遗留字面量。
    if (site.expectNoLiteral.test(before)) {
      problems.push(`${site.path}: hard-coded version detected; should read from ${site.why}`);
    } else {
      changes.push({ path: site.path, kind: "guard", why: site.why });
    }
    continue;
  }
  const after = site.rewrite(before);
  if (after === before) continue;
  changes.push({ path: site.path, kind: "site", why: site.why });
  if (!dryRun) writeFileSync(absolute, after, "utf8");
}

// 4. 落盘后自检 —— 静默失败比报错更贵。
if (!dryRun) {
  for (const change of changes) {
    if (change.kind === "guard") continue; // 验证在 apply 阶段就完成了
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
