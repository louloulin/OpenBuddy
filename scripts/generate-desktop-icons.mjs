#!/usr/bin/env node
/**
 * Generate desktop app icons from the canonical OpenBuddy logo.
 *
 * Source of truth: apps/web/src/assets/openbuddy-logo.png
 * Outputs (electron-builder buildResources):
 *   build/icon.icns  macOS  (16/32/128/256/512 pt, with @2x retina variants)
 *   build/icon.ico   Windows (16/24/32/48/64/128/256 px, PNG-compressed entries)
 *   build/icon.png   Linux / electron-builder fallback (full-resolution logo)
 *
 * Requires macOS `sips` (downscaling) and `iconutil` (ICNS assembly).
 * Run with: pnpm icons:generate
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const DEFAULT_SOURCE = join(ROOT, 'apps/web/src/assets/openbuddy-logo.png');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Apple iconset filenames and the pixel size of each rendered PNG. */
export const ICONSET_ENTRIES = Object.freeze([
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
]);

/** Windows ICO entries. 256 is encoded as 0 in the directory (spec quirk). */
export const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);

/** Read PNG dimensions from the IHDR chunk without decoding pixels. */
export function decodePngSize(png) {
  if (!Buffer.isBuffer(png) || png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG: missing signature');
  }
  if (png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Invalid PNG: missing IHDR chunk');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height) throw new Error('Invalid PNG: zero dimension');
  return { width, height };
}

/**
 * Assemble a multi-resolution ICO file from already-encoded PNG buffers.
 * Modern Windows reads PNG-compressed ICO entries directly, so no BMP
 * conversion (or image-library dependency) is needed.
 */
export function buildIcoBuffer(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ICO requires at least one entry');
  }
  if (entries.length > 0xffff) throw new Error('Too many ICO entries');

  const seen = new Set();
  const prepared = entries.map(({ size, png }) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) {
      throw new Error(`Invalid ICO size: ${String(size)}`);
    }
    if (seen.has(size)) throw new Error(`Duplicate ICO size: ${size}`);
    seen.add(size);
    const { width, height } = decodePngSize(png);
    if (width !== size || height !== size) {
      throw new Error(`ICO entry ${size}px has ${width}x${height} PNG data`);
    }
    return { size, png };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(prepared.length, 4);

  let offset = header.length + prepared.length * 16;
  const directories = [];
  const payloads = [];
  for (const { size, png } of prepared) {
    const dir = Buffer.alloc(16);
    const encodedSize = size === 256 ? 0 : size;
    dir.writeUInt8(encodedSize, 0); // width (0 = 256)
    dir.writeUInt8(encodedSize, 1); // height (0 = 256)
    dir.writeUInt8(0, 2); // palette colors
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    directories.push(dir);
    payloads.push(png);
  }

  return Buffer.concat([header, ...directories, ...payloads]);
}

/** Render all required pixel sizes once and assemble the platform icons. */
export function generateDesktopIcons({ root = ROOT, source = DEFAULT_SOURCE, logger = console.log } = {}) {
  const sourcePath = resolve(source);
  const sourcePng = readFileSync(sourcePath);
  const sourceSize = decodePngSize(sourcePng);
  if (sourceSize.width !== sourceSize.height || sourceSize.width < 1024) {
    throw new Error(`Logo must be square and at least 1024x1024, got ${sourceSize.width}x${sourceSize.height}`);
  }

  const sizes = [...new Set([...ICONSET_ENTRIES.map(entry => entry.size), ...ICO_SIZES])]
    .sort((a, b) => a - b);
  const tempDir = mkdtempSync(join(tmpdir(), 'openbuddy-icons-'));
  try {
    const rendered = new Map();
    for (const size of sizes) {
      const out = join(tempDir, `${size}.png`);
      execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourcePath, '--out', out], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const png = readFileSync(out);
      const actual = decodePngSize(png);
      if (actual.width !== size || actual.height !== size) {
        throw new Error(`sips produced ${actual.width}x${actual.height} instead of ${size}x${size}`);
      }
      rendered.set(size, png);
    }

    const iconset = join(tempDir, 'openbuddy.iconset');
    mkdirSync(iconset);
    for (const entry of ICONSET_ENTRIES) {
      writeFileSync(join(iconset, entry.name), rendered.get(entry.size));
    }

    const buildDir = join(root, 'build');
    mkdirSync(buildDir, { recursive: true });

    const icnsPath = join(buildDir, 'icon.icns');
    execFileSync('iconutil', ['-c', 'icns', '-o', icnsPath, iconset], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const icoPath = join(buildDir, 'icon.ico');
    writeFileSync(icoPath, buildIcoBuffer(ICO_SIZES.map(size => ({ size, png: rendered.get(size) }))));

    const pngPath = join(buildDir, 'icon.png');
    writeFileSync(pngPath, sourcePng);

    // Fail loudly instead of shipping an empty or corrupt icon.
    const icnsMagic = readFileSync(icnsPath).subarray(0, 4).toString('ascii');
    if (icnsMagic !== 'icns') throw new Error(`Invalid ICNS output: ${icnsMagic}`);
    const ico = readFileSync(icoPath);
    if (ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) !== ICO_SIZES.length) {
      throw new Error('Invalid ICO output header');
    }
    const pngSize = decodePngSize(readFileSync(pngPath));
    if (pngSize.width !== sourceSize.width || pngSize.height !== sourceSize.height) {
      throw new Error('icon.png does not match the source logo');
    }

    logger(`[icons] source: ${sourcePath} (${sourceSize.width}x${sourceSize.height})`);
    logger(`[icons] sizes: ${sizes.map(size => `${size}px`).join(', ')}`);
    logger(`[icons] wrote: ${icnsPath}, ${icoPath}, ${pngPath}`);
    return { sourcePath, icnsPath, icoPath, pngPath, sizes };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/generate-desktop-icons.mjs [--source <logo.png>]');
  } else {
    const sourceIndex = args.indexOf('--source');
    if (sourceIndex !== -1 && !args[sourceIndex + 1]) {
      console.error('[icons] --source requires a PNG path');
      process.exitCode = 1;
    } else {
      try {
        generateDesktopIcons({ source: sourceIndex === -1 ? DEFAULT_SOURCE : args[sourceIndex + 1] });
      } catch (error) {
        console.error(`[icons] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  }
}
