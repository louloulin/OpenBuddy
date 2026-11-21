#!/usr/bin/env node
// A5: reproducible-build check — hash dist/ + dist-electron/, rebuild, compare.
//
// Usage: node tools/check-repro.mjs [--no-build]
// `--no-build` only reports the current tree hash (useful in CI before/after caching).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const ROOTS = ["dist", "dist-electron"];

function hashTree() {
  const hashes = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else hashes.set(path.slice(ROOT.length + 1), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  for (const root of ROOTS) walk(join(ROOT, root));
  return hashes;
}

const before = hashTree();
if (process.argv.includes("--no-build")) {
  const digest = createHash("sha256").update([...before.entries()].map(([name, hash]) => `${name} ${hash}`).join("\n")).digest("hex");
  console.log(JSON.stringify({ files: before.size, digest }));
  console.log("REPRO_SNAPSHOT");
  process.exit(0);
}

const build = spawnSync("pnpm", ["build:electron"], { cwd: ROOT, stdio: "inherit", env: process.env });
if (build.status !== 0) {
  console.error("REPRO_FAIL build failed");
  process.exit(build.status ?? 1);
}
const after = hashTree();
const diffs = [];
for (const [name, hash] of before) {
  if (!after.has(name)) diffs.push(`missing: ${name}`);
  else if (after.get(name) !== hash) diffs.push(`changed: ${name}`);
}
for (const name of after.keys()) if (!before.has(name)) diffs.push(`added: ${name}`);

const digest = (map) => createHash("sha256").update([...map.entries()].sort().map(([name, hash]) => `${name} ${hash}`).join("\n")).digest("hex");
console.log(JSON.stringify({ files: after.size, before: digest(before), after: digest(after), diffs: diffs.slice(0, 20) }));
if (diffs.length) {
  console.error(`REPRO_FAIL (${diffs.length} differences)`);
  process.exit(1);
}
console.log("REPRO_OK");
