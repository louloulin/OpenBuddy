#!/usr/bin/env node
/**
 * installer-payload-parity.mjs — compare what an NSIS installer *contains* with
 * what it actually *laid down* on disk.
 *
 * Why this exists (LUM-1324):
 *   The 0.15.0 Windows verification chain shipped an "installed-artifact" claim
 *   that had never been tied to a file-level comparison of installer payload vs
 *   installed tree. The existing packaged smoke (`packaged-smoke.mjs`) probes the
 *   runtime (window, preload bridge, navigation, event log) but never notices a
 *   file that the payload declares and the install never wrote — those are
 *   *silent* and only show up when a package's `main` entry happens to be one of
 *   them (e.g. `@smithy/node-http-handler/dist-cjs/index.js`).
 *
 * What it does (no Electron, no install, no registry writes):
 *   1. lists the 7z stream embedded in the installer (`7za l -slt <setup.exe>`);
 *   2. walks the installed tree;
 *   3. for every payload *file* that is absent from the installed tree, reports
 *      its relative path, its full path under the install root and its length;
 *   4. flags "shadowed" cases: a file whose parent package directory exists in
 *      the installed tree but is incomplete, i.e. Node will resolve into the
 *      partial copy instead of the complete one higher up the tree.
 *
 * Usage:
 *   node scripts/electron/installer-payload-parity.mjs \
 *     --installer release/OpenBuddy-0.15.0-setup.exe \
 *     --installed-root "C:\\path\\to\\installed" \
 *     [--scope resources/app] [--json out.json] [--max-report 50]
 *
 * Exit codes: 0 = parity, 1 = files missing from the installed tree, 2 = usage/IO error.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const installer = opt("--installer");
const installedRoot = opt("--installed-root");
const scope = opt("--scope", "resources/app").replace(/\\/g, "/").replace(/\/+$/, "");
const jsonOut = opt("--json");
const maxReport = Number(opt("--max-report", "50"));

if (!installer || !installedRoot) {
  console.error("usage: node installer-payload-parity.mjs --installer <setup.exe> --installed-root <dir>");
  process.exit(2);
}
if (!existsSync(installer) || !existsSync(installedRoot)) {
  console.error(`input not found: ${existsSync(installer) ? "" : installer} ${existsSync(installedRoot) ? "" : installedRoot}`);
  process.exit(2);
}

/** Locate a 7-Zip CLI: explicit arg/env → electron-builder cache → PATH → 7-Zip install dir. */
function findSevenZip() {
  const candidates = [];
  const explicit = opt("--sevenzip", process.env.OPENBUDDY_7ZA);
  if (explicit) candidates.push(explicit);
  const cache = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "electron-builder", "Cache");
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith("7zip@")) continue;
      const bin = join(cache, entry);
      for (const inner of readdirSync(bin)) {
        for (const exe of ["7za.exe", "7za"]) candidates.push(join(bin, inner, "bin", exe));
      }
    }
  }
  candidates.push("C:\\Program Files\\7-Zip\\7z.exe", "7z", "7za");
  for (const c of candidates) {
    const probe = spawnSync(c, ["i"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return c;
  }
  return null;
}

const sevenZip = findSevenZip();
if (!sevenZip) {
  console.error("7-Zip CLI not found; pass --sevenzip <path> or set OPENBUDDY_7ZA");
  process.exit(2);
}

const listing = spawnSync(sevenZip, ["l", "-slt", resolve(installer)], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
if (listing.error || listing.status !== 0) {
  console.error(`7za failed: ${listing.error?.message ?? listing.stderr?.slice(0, 400)}`);
  process.exit(2);
}

/** Parse `7za l -slt` blocks (blank-line separated; `Attributes` starts with D for directories). */
const payloadFiles = new Map();
{
  let cur = null;
  const flush = () => {
    if (!cur || !cur.Path) return;
    const rel = cur.Path.replace(/\\/g, "/").replace(/\/+$/, "");
    // The archive's own entry is an absolute path ending in .exe with no '/'.
    if (rel.includes("/") && !(cur.Attributes ?? "").startsWith("D")) {
      payloadFiles.set(rel, Number(cur.Size ?? 0));
    }
  };
  for (const line of listing.stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      flush();
      cur = null;
      continue;
    }
    const eq = line.indexOf(" = ");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3);
    if (key === "Path") {
      flush();
      cur = { Path: value };
    } else if (cur) {
      cur[key] = value;
    }
  }
  flush();
}

const prefix = scope + "/";
const scoped = [...payloadFiles].filter(([rel]) => rel.startsWith(prefix));
if (scoped.length === 0) {
  console.error(`no payload files under '${scope}' — wrong --scope?`);
  process.exit(2);
}

const installed = new Set();
const walk = (dir, base) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(full, rel);
    else installed.add(rel);
  }
};
walk(join(installedRoot, scope), "");

const missing = [];
for (const [rel, size] of scoped) {
  const inner = rel.slice(prefix.length);
  if (installed.has(inner)) continue;
  const full = join(installedRoot, rel.replace(/\//g, "\\"));
  // "shadowed": some other file of the same package IS installed, so the package
  // directory exists and Node will resolve into the incomplete copy.
  const pkgDir = inner.includes("/") ? inner.slice(0, inner.lastIndexOf("/")) : inner;
  const shadowed = [...installed].some((p) => p.startsWith(pkgDir + "/"));
  missing.push({ path: inner, payloadBytes: size, fullPathLength: full.length, packageDir: pkgDir, shadowed });
}

const dirs = new Set();
for (const [rel] of scoped) {
  const segs = rel.slice(prefix.length).split("/");
  segs.pop();
  let acc = "";
  for (const s of segs) {
    acc = acc ? `${acc}/${s}` : s;
    dirs.add(acc);
  }
}

const report = {
  schema: "openbuddy.installer-payload-parity.v1",
  generatedAt: new Date().toISOString(),
  installer: resolve(installer),
  installerBytes: statSync(installer).size,
  installedRoot: resolve(installedRoot),
  scope,
  sevenZip,
  payloadScopedFiles: scoped.length,
  payloadScopedDirs: dirs.size,
  installedScopedFiles: installed.size,
  missingCount: missing.length,
  missing,
  verdict: missing.length === 0 ? "parity" : "installed-tree-incomplete",
};

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1), "utf8");

console.log(`[payload-parity] payload ${scope}: ${scoped.length} files / ${dirs.size} dirs`);
console.log(`[payload-parity] installed ${scope}: ${installed.size} files`);
console.log(`[payload-parity] missing from installed tree: ${missing.length}`);
for (const m of missing.slice(0, maxReport)) {
  console.log(`  - len=${String(m.fullPathLength).padStart(4)} shadowed=${m.shadowed ? "yes" : "no "} ${m.path}`);
}
if (missing.length > maxReport) console.log(`  … ${missing.length - maxReport} more`);
if (missing.length) {
  const shadowedPackages = [...new Set(missing.filter((m) => m.shadowed).map((m) => m.packageDir))];
  console.log(`[payload-parity] incomplete package dirs that shadow a complete copy higher up: ${shadowedPackages.length}`);
  for (const p of shadowedPackages.slice(0, maxReport)) console.log(`  ! ${p}`);
  console.log(`[payload-parity] verdict: installed-tree-incomplete`);
  process.exit(1);
}
console.log("[payload-parity] verdict: parity");
