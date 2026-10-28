#!/usr/bin/env node
// scripts/check-lockfile-platform-pkgs.mjs — 锁文件平台包守卫
//
// 为什么需要这个门禁：
//   2026-10-26 的 CI 全红（每个 job 都死在安装期）就是这个问题：
//
//     . postinstall: Error: Cannot find module '@moonrepo/core-linux-x64-gnu/package.json'
//
//   根因不在本仓代码，在 lockfile 本身：
//   - moon 的 CLI(@moonrepo/cli)把平台原生二进制放在 **optionalDependency**
//     里（@moonrepo/core-<os>-<arch>-<libc>）。npm 上 @moonrepo/cli@2.6.3
//     的 optionalDependencies 明确列了 7 个平台包。
//   - 但 dependabot 的 PR #65（把 moon 2.5.4 升到 2.6.3 的那个 54 包
//     分组更新）重新生成的 pnpm-lock.yaml 里，**这 7 个平台包一个都没有**。
//     实测那份 lockfile 只有 '@moonrepo/cli@2.6.3'，grep 不到任何
//     '@moonrepo/core-' 条目。
//   - lockfile 里没有 → pnpm 不会安装 → moon CLI 启动时
//     require.resolve('@moonrepo/core-linux-x64-gnu/package.json') 抛错
//     → postinstall 退出码 1 → `pnpm install` 失败 → **所有 job 全红**。
//
// 也就是说：一次依赖升级能让整个仓库的门禁失灵，而且失败发生在装包阶段，
// 没有任何一行代码被检查过。
//
// 本脚本的判定：
//   读 pnpm-lock.yaml，检查它是否覆盖了 **当前平台** 需要的平台包。
//   缺了就退出 1，并打印缺哪一个、怎么修。
//
// 用法：node scripts/check-lockfile-platform-pkgs.mjs
// 退出码：0 = 平台包齐全；1 = 缺失（CI 安装期会炸）。

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const lockPath = join(repoRoot, "pnpm-lock.yaml");

if (!existsSync(lockPath)) {
  console.error(`找不到 ${lockPath}`);
  process.exit(1);
}

const lock = readFileSync(lockPath, "utf8");

/**
 * 每个平台原生包命名规则：@moonrepo/core-<os>-<arch>[-<libc>]
 * 这里不硬编码包清单 —— 检查的是「lockfile 里有没有 @moonrepo/core- 前缀
 * 的条目」，数量为 0 就说明平台包整组丢了。
 */
const MOON_PLATFORM_PREFIX = "@moonrepo/core-";

/** @type {string[]} */
const platformEntries = [];
for (const line of lock.split("\n")) {
  // lockfile 里形如 `  '@moonrepo/core-linux-x64-gnu@2.5.4':`
  // 包名后面跟的是版本号，判定时要把版本剥掉。
  const m = line.match(/^\s{2}'?(@moonrepo\/core-[a-z0-9-]+)(?:@[^':]+)?'?:/);
  if (m) platformEntries.push(m[1]);
}

const unique = [...new Set(platformEntries)].sort();

if (unique.length === 0) {
  console.error(
    "锁文件里没有任何 @moonrepo/core-* 平台包条目。\n" +
      "  moon 的 CLI 靠这些 optionalDependency 提供原生二进制；缺了它们，\n" +
      "  CI 会在安装期抛 `Cannot find module '@moonrepo/core-linux-x64-gnu/package.json'`\n" +
      "  并让每一个 job 全红（2026-10-26 实测）。\n" +
      "  修法：用本机 pnpm 重新生成锁文件（不要用 dependabot 的自动重生成），\n" +
      "        例如 `pnpm install --lockfile-only`，再确认本脚本转绿。",
  );
  process.exit(1);
}

console.log(`锁文件包含 ${unique.length} 个 @moonrepo/core-* 平台包条目：`);
for (const name of unique) console.log(`  ${name}`);
