#!/usr/bin/env node
// 把 UpUp 仓库复制进 vendor/upup，供 electron-builder 打成内置应用资源 (2026-11-27)。
//
//   node scripts/bundle-upup.mjs                 # 从 ~/stock/upup 复制
//   UPUP_REPO=/path/to/upup node scripts/bundle-upup.mjs
//   node scripts/bundle-upup.mjs --clean         # 先清空 vendor/upup
//
// 必须保留 node_modules（UpUp 子包之间靠 @upup/* 工作区链接解析），但要跳过
// .git / 缓存 / 构建产物，避免安装包无谓变大。符号链接原样复制（工作区链接
// 指向 ../../packages/*，复制后仍然有效）。
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const source = resolve(process.env.UPUP_REPO ?? join(homedir(), 'stock', 'upup'));
const target = resolve(root, 'vendor', 'upup');
const clean = process.argv.includes('--clean');

if (!existsSync(join(source, 'package.json'))) {
  console.error(`BUNDLE_UPUP_FAIL 找不到 UpUp 仓库: ${source}`);
  process.exit(1);
}
if (existsSync(join(source, 'node_modules', '@upup')) === false) {
  console.warn('BUNDLE_UPUP_WARN 源仓库缺少 node_modules/@upup 工作区链接，先在 UpUp 里 bun install');
}

const SKIP = new Set(['.git', '.turbo', '.pnpm-store', 'coverage', 'playwright-report', 'test-results']);
const skipNested = (path) =>
  path.includes('/node_modules/.cache/') ||
  path.includes('/node_modules/.vite/') ||
  path.endsWith('/dist') && path.includes('/packages/');

if (clean) rmSync(target, { recursive: true, force: true });

cpSync(source, target, {
  recursive: true,
  dereference: false,
  preserveTimestamps: true,
  filter: (from) => {
    if (from === source) return true;
    const relative = from.slice(source.length + 1);
    const top = relative.split('/')[0];
    if (SKIP.has(top)) return false;
    if (skipNested(from)) return false;
    return true;
  },
});

const size = (dir) => {
  let total = 0;
  const walk = (p) => {
    let entries;
    try { entries = require('node:fs').readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(p, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(child);
      else { try { total += statSync(child).size; } catch { /* 跳过不可读文件 */ } }
    }
  };
  walk(dir);
  return total;
};
console.log(`BUNDLE_UPUP_OK ${target} (${(size(target) / 1024 / 1024).toFixed(1)} MB)`);
