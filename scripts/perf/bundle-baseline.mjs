#!/usr/bin/env node
/**
 * P3-04: Bundle size baseline.
 *
 * Reports the gzipped + brotli sizes of every output bundle so the team
 * has a single source of truth for "did our changes bloat the app?"
 *
 * Unlike bundle-topology.mjs (which checks budget thresholds and exits
 * non-zero on violation), this script is a passive reporter — it never
 * fails, it just prints numbers. Pipe to a CI artifact for trend tracking.
 *
 * Output columns:
 *   - chunk filename
 *   - raw bytes
 *   - gzip bytes
 *   - brotli bytes (best compression for static delivery)
 *   - raw MB
 *
 *   Usage:
 *     node scripts/perf/bundle-baseline.mjs                          # renderer only
 *     node scripts/perf/bundle-baseline.mjs --include-main           # + main + preload
 *     node scripts/perf/bundle-baseline.mjs --json out/baseline.json # machine-readable
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const args = new Set(process.argv.slice(2));
const includeMain = args.has("--include-main");
const jsonOut = [...args].find((arg) => arg.startsWith("--json="))?.split("=", 2)[1]
  ?? (args.has("--json") ? "out/bundle-baseline.json" : null);

const targets = [
  { dir: join(repoRoot, "out", "renderer", "assets"), label: "renderer" },
];
if (includeMain) {
  targets.push(
    { dir: join(repoRoot, "out", "main"), label: "main" },
    { dir: join(repoRoot, "out", "preload"), label: "preload" },
  );
}

const MB = 1024 * 1024;

function bytesToMB(b) {
  return (b / MB).toFixed(3);
}

async function listBundles(dir) {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => /\.(js|cjs|mjs|css)$/.test(f));
  } catch {
    return [];
  }
}

async function measure(file, dir) {
  const path = join(dir, file);
  const raw = await readFile(path);
  const rawBytes = raw.length;
  const gzipBytes = gzipSync(raw, { level: 9 }).length;
  const brotliBytes = brotliCompressSync(raw).length;
  return { file, rawBytes, gzipBytes, brotliBytes };
}

async function main() {
  const rows = [];
  let grandTotal = { raw: 0, gzip: 0, brotli: 0 };
  for (const { dir, label } of targets) {
    try {
      await stat(dir);
    } catch {
      console.error(`bundle-baseline: skip missing ${dir}`);
      continue;
    }
    const bundles = await listBundles(dir);
    const measurements = [];
    for (const file of bundles) {
      const m = await measure(file, dir);
      measurements.push(m);
    }
    measurements.sort((a, b) => b.rawBytes - a.rawBytes);
    const sectionTotal = measurements.reduce(
      (acc, m) => ({
        raw: acc.raw + m.rawBytes,
        gzip: acc.gzip + m.gzipBytes,
        brotli: acc.brotli + m.brotliBytes,
      }),
      { raw: 0, gzip: 0, brotli: 0 },
    );
    grandTotal = {
      raw: grandTotal.raw + sectionTotal.raw,
      gzip: grandTotal.gzip + sectionTotal.gzip,
      brotli: grandTotal.brotli + sectionTotal.brotli,
    };
    console.log(`\n${label} (${measurements.length} files, ${bytesToMB(sectionTotal.raw)} MB raw, ${bytesToMB(sectionTotal.gzip)} MB gzip, ${bytesToMB(sectionTotal.brotli)} MB brotli):`);
    const header = "  raw   gzip  brtl  file";
    console.log(header);
    console.log("  ----  ----  ----  ----");
    for (const m of measurements.slice(0, 25)) {
      console.log(
        `  ${String(bytesToMB(m.rawBytes)).padStart(5)} ${String(bytesToMB(m.gzipBytes)).padStart(5)} ${String(bytesToMB(m.brotliBytes)).padStart(5)}  ${m.file}`,
      );
    }
    if (measurements.length > 25) console.log(`  ... and ${measurements.length - 25} more`);
    for (const m of measurements) rows.push({ section: label, ...m });
  }

  console.log(
    `\nGRAND TOTAL: ${bytesToMB(grandTotal.raw)} MB raw | ${bytesToMB(grandTotal.gzip)} MB gzip | ${bytesToMB(grandTotal.brotli)} MB brotli`,
  );

  if (jsonOut) {
    const payload = {
      measuredAt: new Date().toISOString(),
      grandTotal,
      bundles: rows,
    };
    await writeFile(jsonOut, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error("bundle-baseline: unexpected error:", err);
  process.exit(2);
});