#!/usr/bin/env node
// scripts/clean-build-artifacts.mjs
//
// Wipes the directories that electron-vite and electron-builder produce
// without touching moon's action cache. Safe to run repeatedly.
//
// Usage: `pnpm clean:build` (or `node scripts/clean-build-artifacts.mjs`)

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

const targets = [
  { path: "out",                      why: "electron-vite output" },
  { path: "release",                  why: "electron-builder artifacts" },
  { path: "build/icon.iconset",       why: "transient sips scratch directory" },
  { path: ".moon/cache",              why: "moon action cache (force rebuild)" },
];

let removed = 0;
for (const target of targets) {
  const absolute = resolve(repoRoot, target.path);
  if (!existsSync(absolute)) continue;
  try {
    await rm(absolute, { recursive: true, force: true });
    console.log(`✓ removed ${target.path} (${target.why})`);
    removed += 1;
  } catch (error) {
    console.warn(`✗ failed to remove ${target.path}:`, error.message);
  }
}

if (removed === 0) {
  console.log("clean:build — nothing to remove");
} else {
  console.log(`clean:build — removed ${removed} target(s)`);
}
