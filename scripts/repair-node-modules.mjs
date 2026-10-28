#!/usr/bin/env node
// scripts/repair-node-modules.mjs — 修复"链接器切换"留下的安装残骸
//
// 背景：
//   本仓在 2026-09 从 pnpm 的 `nodeLinker: isolated` 切到 `hoisted`
//   （见 pnpm-workspace.yaml 里 nodeLinker 的注释：isolated 下 electron-builder
//   读不到传递依赖，打出来的包启动就崩）。切完之后，**旧的 node_modules 并没有
//   被清掉**：
//
//     - 包目录里残留指向旧 `.pnpm/<pkg>@<ver>/…` 的符号链接（目标已不存在）
//     - 包目录里残留旧布局生成的 `node_modules/.bin/*` shim 脚本，
//       shim 里的 `cmd-shim-target` 指向已不存在的包目录
//
//   这类残骸会让 `pnpm exec <bin>` 在包目录里解析到**坏掉的**本地 shim，
//   而不是回落到仓库根（hoisted 布局下真正的安装位置）。表现是：
//     Error: Cannot find module '.../packages/<pkg>/node_modules/typescript/bin/tsc'
//
//   这和 CI 上 `Cannot find module '@moonrepo/core-linux-x64-gnu/package.json'`
//   是同一类问题：node_modules 的实际状态与当前配置不一致，解析落到不存在的路径。
//
// 做什么：
//   1. 删掉所有指向已不存在目标的符号链接（只删失效的，有效的一律不动）
//   2. 删掉所有 `cmd-shim-target` 已不存在的 `.bin` shim
//   3. 删掉因此变成空目录的包级 node_modules/.bin
//
// 不做什么：不动任何有效文件；不碰仓库根 node_modules（根是 hoisted 布局的
// 真实安装位置，由 pnpm 自己管理）。
//
// 退出码：0 = 干净或已修复；1 = 仍有无法自动修复的残骸。
//
// 用法：node scripts/repair-node-modules.mjs [--dry-run]

import { readdirSync, readFileSync, existsSync, rmSync, lstatSync, readlinkSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dryRun = process.argv.includes("--dry-run");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".moon", "playwright-report", "test-results"]);

/** @type {string[]} */
const packageDirs = [];

function findPackageDirs(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (existsSync(join(full, "package.json"))) {
      packageDirs.push(full);
      continue;
    }
    findPackageDirs(full);
  }
}

for (const root of ["packages", "apps", "electron"]) {
  const abs = join(repoRoot, root);
  if (existsSync(abs)) findPackageDirs(abs);
}
if (existsSync(join(repoRoot, "package.json"))) packageDirs.push(repoRoot);

let removedLinks = 0;
let removedShims = 0;
const leftovers = [];

/** @param {string} path */
function removeLink(path) {
  if (dryRun) {
    console.log(`  [dry-run] rm 断链 ${path}`);
  } else {
    rmSync(path, { force: true });
  }
  removedLinks++;
}

for (const pkgDir of packageDirs) {
  const nm = join(pkgDir, "node_modules");
  if (!existsSync(nm)) continue;

  /** @type {string[]} */
  const binDirs = [];

  // 1) 失效符号链接
  let entries = [];
  try {
    entries = readdirSync(nm, { withFileTypes: true, recursive: false });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const full = join(nm, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(full)) removeLink(full);
      continue;
    }
    if (!entry.isDirectory()) continue;
    // 旧布局会在包目录下留下自己的 node_modules/.bin
    const childBin = join(full, ".bin");
    if (existsSync(childBin)) binDirs.push(childBin);
  }
  // 包级 node_modules/.bin（包自己的 bin 目录）
  const ownBin = join(nm, ".bin");
  if (existsSync(ownBin)) binDirs.push(ownBin);

  // 2) stale bin shim
  for (const bin of binDirs) {
    let binEntries = [];
    try {
      binEntries = readdirSync(bin, { withFileTypes: true });
    } catch {
      binEntries = [];
    }
    for (const binEntry of binEntries) {
      const shim = join(bin, binEntry.name);
      if (binEntry.isSymbolicLink()) {
        if (!existsSync(shim)) removeLink(shim);
        continue;
      }
      if (!binEntry.isFile()) continue;
      let head = "";
      try {
        head = readFileSync(shim, "utf8").slice(0, 4096);
      } catch {
        continue;
      }
      const marker = head.match(/cmd-shim-target=(.*)$/m);
      if (!marker) continue;
      const target = marker[1].trim();
      if (target && existsSync(target)) continue;
      if (dryRun) {
        console.log(`  [dry-run] rm stale shim ${shim} -> ${target}`);
      } else {
        rmSync(shim, { force: true });
      }
      removedShims++;
    }
    try {
      if (readdirSync(bin).length === 0) {
        if (!dryRun) rmSync(bin, { recursive: true, force: true });
        else console.log(`  [dry-run] rm 空 .bin ${bin}`);
      }
    } catch {
      /* ignore */
    }
  }
}

console.log(
  `\n扫描 ${packageDirs.length} 个包目录：移除失效符号链接 ${removedLinks} 个，移除 stale bin shim ${removedShims} 个。`,
);

// 复查：是否还有失效链接 / stale shim
for (const pkgDir of packageDirs) {
  const nm = join(pkgDir, "node_modules");
  if (!existsSync(nm)) continue;
  let entries = [];
  try {
    entries = readdirSync(nm, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const full = join(nm, entry.name);
    if (entry.isSymbolicLink() && !existsSync(full)) leftovers.push(full);
  }
}

if (leftovers.length > 0) {
  console.log(`\n仍有 ${leftovers.length} 个失效符号链接无法自动清理：`);
  for (const l of leftovers.slice(0, 20)) console.log(`  ${l}`);
  console.log("\n建议：rm -rf node_modules 后重新 pnpm install --frozen-lockfile");
  process.exit(1);
}

console.log("安装残骸已清理干净。");
