#!/usr/bin/env node
// scripts/generate-checksums.mjs — 为 release 资产生成 SHA256SUMS.txt
//
// 为什么需要：
//   官网下载页要展示每个安装包的 SHA-256(P1-2 的验收标准之一)。
//   GitHub Releases API **不提供** release 资产的校验和,所以必须由
//   发布流水线自己算,再把 SHA256SUMS.txt 一起挂到 release 上。
//   官网再从 release 资产里把它取回来解析。
//
// 输出格式与 `sha256sum` 一致:`<64 位小写 hex>  <文件名>`,
// 文件名是**发布资产名**(basename),不是构建时的相对路径 ——
// 官网是按资产名匹配的。
//
// 用法：
//   node scripts/generate-checksums.mjs <artifacts 目录> [-o 输出文件]
//
// 例：
//   node scripts/generate-checksums.mjs artifacts -o artifacts/SHA256SUMS.txt
//
// 退出码：0 = 成功；1 = 目录不存在或没有可校验的产物。

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--") && a !== "-o");
const outIndex = args.indexOf("-o");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

if (!dirArg) {
  console.error("用法: node scripts/generate-checksums.mjs <artifacts 目录> [-o 输出文件]");
  process.exit(1);
}

const root = resolve(dirArg);
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`目录不存在: ${root}`);
  process.exit(1);
}

/** 只校验真正需要用户下载的产物;blockmap / latest.yml 是 electron-builder 的内部文件。 */
const INCLUDE_EXT = new Set([".dmg", ".exe", ".appimage", ".zip", ".deb", ".rpm", ".msi", ".pkg"]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (INCLUDE_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

async function sha256(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

const files = collect(root).sort();
if (files.length === 0) {
  console.error(`${root} 下没有可校验的产物(扩展名: ${[...INCLUDE_EXT].join(", ")})`);
  process.exit(1);
}

const lines = [];
for (const file of files) {
  const digest = await sha256(file);
  lines.push(`${digest}  ${basename(file)}`);
  console.log(`${digest}  ${basename(file)}`);
}

const content = `${lines.join("\n")}\n`;
if (outPath) {
  writeFileSync(resolve(outPath), content);
  console.log(`\n已写入 ${resolve(outPath)}`);
} else {
  process.stdout.write(content);
}
