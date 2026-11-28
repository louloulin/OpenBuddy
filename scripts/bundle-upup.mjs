#!/usr/bin/env node
/**
 * 内置 UpUp (20261127-upup §1.15)：把 UpUp 的一个**已提交版本**打进 `vendor/upup`，随安装包分发，
 * 用户机器上不再需要 git / npm / gitcode 凭据。
 *
 *   node scripts/bundle-upup.mjs                       # ~/stock/upup 的 HEAD
 *   UPUP_REPO=/path/to/upup UPUP_REF=v2026.10.11 node scripts/bundle-upup.mjs
 *
 * 1. `git archive <ref>`：只取提交内容，本地未提交的改动、.git、node_modules 都不会进来；
 * 2. `npm install --omit=dev --legacy-peer-deps`：与 Pi 安装 Git 包时用的参数相同（实测可加载全部工具）；
 * 3. 写 `.openbuddy-bundle.json`（版本 / commit / 时间），宿主据此显示「内置 · 版本」。
 *
 * 构建机需要 git、npm 和访问 UpUp 仓库的权限；产物在 `vendor/upup`（已 gitignore）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(process.env.UPUP_REPO ?? join(homedir(), 'stock', 'upup'));
const ref = process.env.UPUP_REF ?? 'HEAD';
const target = join(root, 'vendor', 'upup');
const staging = `${target}.staging`;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

if (!existsSync(join(repo, '.git'))) {
  console.error(`BUNDLE_UPUP_FAIL 不是 git 仓库：${repo}`);
  process.exit(1);
}
const commit = run('git', ['-C', repo, 'rev-parse', `${ref}^{commit}`]).trim();
const marker = join(target, '.openbuddy-bundle.json');
if (existsSync(marker) && JSON.parse(readFileSync(marker, 'utf8')).commit === commit && existsSync(join(target, 'node_modules'))) {
  console.log(`BUNDLE_UPUP_OK ${target} (已是 ${commit.slice(0, 8)}，跳过)`);
  process.exit(0);
}

const started = Date.now();
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
execFileSync('sh', ['-c', `git -C "$REPO" archive --format=tar "$COMMIT" | tar -x -C "$OUT"`], {
  stdio: 'inherit',
  env: { ...process.env, REPO: repo, COMMIT: commit, OUT: staging },
});
run('npm', ['install', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund', '--ignore-scripts=false'], { cwd: staging, stdio: 'inherit' });
const pkg = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'));
writeFileSync(join(staging, '.openbuddy-bundle.json'), JSON.stringify({ name: pkg.name, version: pkg.version, commit, bundledAt: new Date().toISOString() }, null, 2));
rmSync(target, { recursive: true, force: true });
renameSync(staging, target);
const mb = Number(run('du', ['-sk', target]).split(/\s+/)[0]) / 1024;
console.log(`BUNDLE_UPUP_OK ${target} ${pkg.name}@${pkg.version} ${commit.slice(0, 8)} ${mb.toFixed(0)} MB ${((Date.now() - started) / 1000).toFixed(1)} s`);
