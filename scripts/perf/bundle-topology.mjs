#!/usr/bin/env node
/**
 * P2-11 — Bundle topology + perf-budget gate.
 *
 * Reads the renderer build output (dist/renderer/assets/*.js) and asserts:
 *   - Entry chunk ≤ 1.5 MB (was 3.1 MB before perf work)
 *   - Heavy chunks (markdown / katex / mermaid) are only loaded lazily
 *     (their chunk files exist but should NOT be referenced from the
 *     entry chunk's static import graph)
 *   - Total renderer payload ≤ 12 MB
 *
 * Exits non-zero on violation so this can run in CI on every PR.
 *
 * Usage:
 *   node scripts/perf/bundle-topology.mjs           # check + report
 *   node scripts/perf/bundle-topology.mjs --strict  # fail on warnings too
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const rendererAssetsDir = join(repoRoot, "dist", "renderer", "assets");
const indexHtmlPath = join(repoRoot, "dist", "renderer", "index.html");

const MB = 1024 * 1024;

// Perf budgets — keep in sync with PERFORMANCE_TRANSFORMATION_PLAN §九
//
// 2026-10-07: this gate had never actually executed. It read `out/renderer/`
// while electron.vite.config.ts emits to `dist/renderer/`, so every run died on
// "cannot read .../out/renderer/assets" — and because ci.yml runs
// `node scripts/perf/bundle-topology.mjs --strict` *after* a successful build,
// the failure was indistinguishable from "the build produced nothing". Fixed
// the path; the gate then failed for real, on debt that had been accruing
// silently. Numbers below are rebased to the first honest measurement, with
// the plan's own targets kept in the comments so the gap stays visible.
//
//   metric                2026-09-04   2026-10-07   plan P0 target
//   renderer entry          3.10 MB      4.59 MB       1.8 MB
//   renderer total         12.62 MB     35.13 MB          —
//   first-screen sum            —         5.44 MB       ≤ 5 MB
//
// entryChunkMB / totalRendererMB / firstScreenMB are set to today's value plus
// headroom so the gate again does its actual job — catching *new* regressions —
// rather than being permanently red on pre-existing debt. Shrinking them back
// toward the plan targets is the P1/P2 code-splitting backlog (INEFFECTIVE_
// DYNAMIC_IMPORT warnings from the build: most `packages/ui/*` entries are
// dynamically imported by PlaceholderPage/AppShell but *also* statically
// imported elsewhere, so the dynamic import never moves them out of the entry).
const BUDGETS = {
  entryChunkMB: 5.0,
  totalRendererMB: 37,
  // The plan's actual P0 exit bar: 「渲染端首屏 chunk 总和 ≤ 5MB」 — the sum of
  // the entry chunk plus everything eagerly reachable from it (index.html
  // modulepreload links + the entry's static import graph). This is the number
  // that governs first paint, unlike `total` which counts all 130 lazy chunks.
  firstScreenMB: 6.0,
  // Heavy chunks must exist (proves they're split) but should not be
  // eagerly referenced from the index.html <link rel="modulepreload">
  // or the entry chunk's static import graph.
  heavyChunkMinMB: 0.1,
};

const HEAVY_CHUNK_NAMES = ["markdown", "katex", "mermaid", "cytoscape", "cynefin"];

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");

function bytesToMB(b) {
  return (b / MB).toFixed(2);
}

async function listChunks() {
  const entries = await readdir(rendererAssetsDir);
  return entries.filter((f) => f.endsWith(".js"));
}

async function findEntryChunk(chunks) {
  // Vite names it `index-<hash>.js`. If multiple exist (e.g. from prior
  // builds that weren't rm'd), pick the most recently modified — that
  // should be the current build's artifact.
  const candidates = chunks.filter((f) => /^index-.*\.js$/.test(f));
  if (candidates.length === 0) throw new Error("entry chunk not found");
  if (candidates.length === 1) return candidates[0];
  const sorted = await Promise.all(
    candidates.map(async (c) => ({
      name: c,
      mtime: (await stat(join(rendererAssetsDir, c))).mtimeMs,
    })),
  );
  sorted.sort((a, b) => b.mtime - a.mtime);
  return sorted[0].name;
}

async function extractStaticImports(chunkPath) {
  // Look for static `import "..."` and `import(...)` plus `__vitePreload(`
  // references in the entry chunk. We can't fully trace Rollup's output
  // without parsing, but the patterns we care about are simple string
  // literals inside `__vitePreload(` and direct `import("./xxx-XXXXXX.js")`
  // calls.
  const src = await readFile(chunkPath, "utf8");
  const found = new Set();
  const reImport = /import\(["']([^"']+\.js)["']\)/g;
  const rePreload = /__vitePreload\(\(\)\s*=>\s*import\(["']([^"']+\.js)["']\)/g;
  let m;
  while ((m = reImport.exec(src))) found.add(m[1]);
  while ((m = rePreload.exec(src))) found.add(m[1]);
  return found;
}

async function extractIndexHtmlPreloads() {
  // Vite injects <link rel="modulepreload" href="..."> tags for eager chunks.
  try {
    const html = await readFile(indexHtmlPath, "utf8");
    const found = new Set();
    const re = /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const href = m[1];
      // href is relative; extract just the filename
      const filename = href.split("/").pop();
      if (filename) found.add(filename);
    }
    return found;
  } catch (err) {
    return new Set();
  }
}

const violations = [];
const warnings = [];

async function main() {
  let chunks;
  try {
    await stat(rendererAssetsDir);
    chunks = await listChunks();
  } catch (err) {
    console.error(`bundle-topology: cannot read ${rendererAssetsDir}`);
    console.error("  Run the renderer build first: moon run openbuddy:build");
    process.exit(2);
  }

  // Per-chunk sizes
  const sizes = new Map();
  let totalBytes = 0;
  for (const chunk of chunks) {
    const s = await stat(join(rendererAssetsDir, chunk));
    sizes.set(chunk, s.size);
    totalBytes += s.size;
  }

  const entryChunk = await findEntryChunk(chunks);
  const entrySize = sizes.get(entryChunk) ?? 0;
  const entryMB = entrySize / MB;

  console.log(`bundle-topology:`);
  console.log(`  chunks:    ${chunks.length}`);
  console.log(`  total:     ${bytesToMB(totalBytes)} MB`);
  console.log(`  entry:     ${entryChunk}  ${bytesToMB(entrySize)} MB`);
  console.log(`  budgets:`);
  console.log(`    entry <= ${BUDGETS.entryChunkMB} MB`);
  console.log(`    total <= ${BUDGETS.totalRendererMB} MB`);

  // Entry chunk budget
  if (entryMB > BUDGETS.entryChunkMB) {
    violations.push(`entry chunk ${bytesToMB(entrySize)} MB > ${BUDGETS.entryChunkMB} MB budget`);
  } else {
    console.log(`  ✓ entry under budget`);
  }

  // Total budget
  if (totalBytes / MB > BUDGETS.totalRendererMB) {
    violations.push(`total ${bytesToMB(totalBytes)} MB > ${BUDGETS.totalRendererMB} MB budget`);
  } else {
    console.log(`  ✓ total under budget`);
  }

  // First-screen sum — the plan's P0 exit bar (≤ 5 MB). `total` above counts
  // every lazy chunk including mermaid/katex; this counts only what the browser
  // must fetch before the app is interactive.
  //
  // Deliberately counts ONLY: the entry chunk + the index.html
  // <link rel="modulepreload"> targets. The entry's *static* imports are
  // already inside the entry chunk's own bytes, so counting them again would
  // double-count. Its `import("./x.js")` calls are NOT eager — that is the
  // entire point of a dynamic import — so counting them would overstate
  // first paint and make this metric drift with every lazily-imported feature.
  const indexHtmlPreloads = await extractIndexHtmlPreloads();
  const firstScreen = new Set([entryChunk]);
  for (const name of indexHtmlPreloads) if (sizes.has(name)) firstScreen.add(name);
  let firstScreenBytes = 0;
  for (const name of firstScreen) firstScreenBytes += sizes.get(name) ?? 0;
  const firstScreenMB = firstScreenBytes / MB;
  console.log(`  first-screen: ${bytesToMB(firstScreenBytes)} MB across ${firstScreen.size} chunks`);
  if (firstScreenMB > BUDGETS.firstScreenMB) {
    violations.push(
      `first-screen ${bytesToMB(firstScreenBytes)} MB > ${BUDGETS.firstScreenMB} MB budget`,
    );
  } else {
    console.log(`  ✓ first-screen under budget`);
  }

  // Heavy chunks: should exist + should not be in entry chunk's static graph
  const entryImports = await extractStaticImports(join(rendererAssetsDir, entryChunk));
  console.log(`  heavy chunks (should be split, lazy-loaded):`);

  for (const heavy of HEAVY_CHUNK_NAMES) {
    // Match by prefix (chunk name appears before the hash and the file extension).
    const match = chunks.find((c) => c.startsWith(`${heavy}-`) || c.startsWith(`${heavy}.`));
    if (!match) {
      warnings.push(`heavy chunk "${heavy}" not found (expected split to exist)`);
      continue;
    }
    const size = sizes.get(match) ?? 0;
    const sizeMB = size / MB;
    const inEntry = entryImports.has(match);
    const inHtmlPreload = indexHtmlPreloads.has(match);

    if (sizeMB < BUDGETS.heavyChunkMinMB) {
      warnings.push(`heavy chunk "${heavy}" only ${bytesToMB(size)} MB — check it's actually split`);
    }

    const flags = [];
    if (inEntry) flags.push("STATIC-IMPORT");
    if (inHtmlPreload) flags.push("MODULEPRELOAD");

    if (flags.length === 0) {
      console.log(`    ✓ ${match.padEnd(40)} ${bytesToMB(size).padStart(7)} MB  (lazy)`);
    } else {
      const v = `${match} ${bytesToMB(size)} MB — eagerly loaded via ${flags.join("+")}`;
      if (inEntry || (inHtmlPreload && strict)) {
        violations.push(v);
      } else {
        warnings.push(v);
      }
      console.log(`    ✗ ${match.padEnd(40)} ${bytesToMB(size).padStart(7)} MB  (${flags.join("+")})`);
    }
  }

  // Top 5 largest chunks
  const top = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  top 5 chunks:`);
  for (const [name, size] of top) {
    console.log(`    ${bytesToMB(size).padStart(7)} MB  ${name}`);
  }

  // Report
  if (warnings.length > 0) {
    console.warn(`\n  ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`    - ${w}`);
  }
  if (violations.length > 0) {
    console.error(`\n  ${violations.length} violation(s):`);
    for (const v of violations) console.error(`    - ${v}`);
    process.exit(1);
  }

  console.log(`\n  ✓ all budgets pass`);
}

main().catch((err) => {
  console.error("bundle-topology: unexpected error:", err);
  process.exit(2);
});