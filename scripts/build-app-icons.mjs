#!/usr/bin/env node
/**
 * build-app-icons.mjs — 从 build/icon.png 生成 electron-builder 需要的
 * `build/icon.icns`(mac)与 `build/icon.ico`(win)。
 *
 * A7(2026-10-19 生产评审):两者此前被 .gitignore 忽略,CI 检出后不存在,
 * 打包打不出图标。生成后入库(产物是二进制,重跑脚本可复现)。
 *
 * - icns:macOS 原生链路(sips 缩放 → iconutil 打包 iconset),仅 darwin 可跑;
 * - ico:Vista+ 支持 PNG 直嵌的 ICO 容器(无需调色板),本脚本内置打包器,
 *   免装 ImageMagick。electron-builder / Windows 资源编译器均接受。
 *
 * Usage: node scripts/build-app-icons.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

const root = new URL("..", import.meta.url).pathname;
const sourcePng = join(root, "build", "icon.png");
if (!existsSync(sourcePng)) {
  console.error(`[icons] source missing: ${sourcePng}`);
  process.exit(1);
}

/** PNG 尺寸解析(取 IHDR 宽高)。 */
function pngSize(buffer) {
  if (buffer.readUInt32BE(12) !== 0x49484452) throw new Error("not a PNG IHDR");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** ICO 容器打包:每项是一张 PNG(Windows Vista+ 支持 PNG 压缩项)。 */
function packIco(entries) {
  // ICONDIR: reserved(2) type(2)=1 count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directorySize = 16 * entries.length;
  let offset = header.length + directorySize;
  const directoryChunks = [];
  const payloadChunks = [];
  for (const entry of entries) {
    const { size, png } = entry;
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // width(0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2); // palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8); // data size
    dir.writeUInt32LE(offset, 12); // data offset
    offset += png.length;
    directoryChunks.push(dir);
    payloadChunks.push(png);
  }
  return Buffer.concat([header, ...directoryChunks, ...payloadChunks]);
}

async function main() {
  const source = readFileSync(sourcePng);
  const { width } = pngSize(source);
  if (width < 1024) {
    console.warn(`[icons] source is ${width}px — expect >= 1024 for best quality`);
  }

  // ---------- ICO(win):PNG 直嵌 256/128/64/48/32/16 ----------
  const work = mkdtempSync(join(tmpdir(), "ob-icons-"));
  try {
    const icoSizes = [256, 128, 64, 48, 32, 16];
    const entries = [];
    for (const size of icoSizes) {
      const resized = join(work, `icon-${size}.png`);
      execFileSync("sips", ["-z", String(size), String(size), sourcePng, "--out", resized], { stdio: "pipe" });
      entries.push({ size, png: readFileSync(resized) });
    }
    writeFileSync(join(root, "build", "icon.ico"), packIco(entries));
    console.log("[icons] wrote build/icon.ico");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // ---------- ICNS(mac):iconset + iconutil ----------
  if (process.platform !== "darwin") {
    console.log("[icons] skip icon.icns (not darwin) — CI mac job generates it");
    return;
  }
  const iconset = join(work, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  const icnsSpecs = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of icnsSpecs) {
    const out = join(iconset, name);
    execFileSync("sips", ["-z", String(size), String(size), sourcePng, "--out", out], { stdio: "pipe" });
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(root, "build", "icon.icns")], { stdio: "pipe" });
  console.log("[icons] wrote build/icon.icns");
}

main().catch((error) => {
  console.error("[icons] failed:", error);
  process.exit(1);
});
