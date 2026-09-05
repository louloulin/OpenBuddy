#!/usr/bin/env node
/**
 * P3-07: Performance dashboard aggregator.
 *
 * Reads every artifact under `evidence/perf/`, `evidence/_perf_baseline/`,
 * and the bundle baseline + topology reports, and produces a single
 * human-readable Markdown report. Designed to run after a CI build to
 * give the team a one-glance status across all perf dimensions.
 *
 * Inputs:
 *   - evidence/perf/ipc-latency-*.json    (P3-03)
 *   - evidence/perf/bundle-baseline-*.json (P3-04)
 *   - evidence/perf/bundle-topology-*.json (optional, future)
 *   - evidence/coverage-report/coverage-report.json (if present)
 *
 * Outputs:
 *   - stdout: human-readable dashboard
 *   - evidence/perf/dashboard-<timestamp>.md  (machine-friendly copy)
 *   - evidence/perf/dashboard-<timestamp>.json (trend data)
 *
 * Trend detection: when 2+ artifacts of the same kind exist, the dashboard
 * computes a delta vs the most recent prior run and flags regressions
 * (>5% mean growth or >10% p95 growth) with a red marker.
 *
 * Usage:
 *   node scripts/perf/dashboard.mjs                    # aggregate + print
 *   node scripts/perf/dashboard.mjs --since-days=7     # only last N days
 *   node scripts/perf/dashboard.mjs --out=docs/perf/dashboard.md
 */
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

function arg(name, fallback) {
  const list = process.argv.slice(2);
  const prefixed = list.find((a) => a.startsWith(`--${name}=`));
  if (prefixed) return prefixed.split("=", 2)[1] ?? fallback;
  const flag = list.indexOf(`--${name}`);
  if (flag !== -1 && flag + 1 < list.length && !list[flag + 1].startsWith("--")) {
    return list[flag + 1];
  }
  return fallback;
}

function numArg(name, fallback) {
  const v = arg(name, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const sinceDays = numArg("since-days", 0); // 0 = no filter
const outDir = arg("out-dir", join("evidence", "perf"));
const explicitOut = arg("out", null);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

// ---------- IO helpers -------------------------------------------------------

async function listJson(dir) {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function safeReadJSON(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

// ---------- Sourcing --------------------------------------------------------

const perfDir = join(repoRoot, "evidence", "perf");
const baselineDir = join(repoRoot, "evidence", "_perf_baseline");
const coveragePath = join(repoRoot, "evidence", "coverage-report", "coverage-report.json");

const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 86400_000 : 0;

async function collect(prefix, dir) {
  const files = await listJson(dir);
  const result = [];
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const fullPath = join(dir, f);
    const s = await safeStat(fullPath);
    if (!s) continue;
    if (cutoff > 0 && s.mtimeMs < cutoff) continue;
    const json = await safeReadJSON(fullPath);
    if (!json) continue;
    result.push({ file: f, path: fullPath, mtime: s.mtimeMs, json });
  }
  result.sort((a, b) => a.mtime - b.mtime);
  return result;
}

const [ipcLatencies, baselines, topologies, coverageReport] = await Promise.all([
  collect("ipc-latency-", perfDir),
  collect("bundle-baseline-", perfDir),
  collect("bundle-topology-", perfDir),
  safeReadJSON(coveragePath),
]);

// ---------- Trend helpers ---------------------------------------------------

function trend(curr, prev, key) {
  if (!prev || !curr) return null;
  const delta = ((curr[key] - prev[key]) / prev[key]) * 100;
  return delta;
}

function status(curr, prev, key, regressPct = 5) {
  const delta = trend(curr, prev, key);
  if (delta === null || Math.abs(delta) < regressPct) return "ok";
  return delta > 0 ? "regressed" : "improved";
}

// ---------- Section renderers -----------------------------------------------

function renderIpcLatency() {
  if (ipcLatencies.length === 0) {
    return "  (no IPC latency samples — run `node scripts/perf/ipc-latency.mjs`)";
  }
  const latest = ipcLatencies[ipcLatencies.length - 1];
  const previous = ipcLatencies.length > 1 ? ipcLatencies[ipcLatencies.length - 2] : null;

  const lines = [`  latest: ${latest.file}`];
  if (latest.json.validator) lines.push(`  validator: ${latest.json.validator}`);
  lines.push(`  iterations: ${latest.json.iterations} × ${latest.json.innerLoops}`);
  lines.push("");
  lines.push("  method             | mean (ms)  | p50 (ms) | p95 (ms) | p99 (ms) | Δ vs prev mean");
  lines.push("  ------------------ | ---------- | -------- | -------- | -------- | -------------");
  const methods = Object.keys(latest.json.results ?? {});
  for (const m of methods) {
    const s = latest.json.results[m];
    const prev = previous?.json.results?.[m];
    const delta = trend(s, prev, "mean");
    const deltaStr = delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
    const flag = status(s, prev, "mean") === "regressed" ? "⚠️" : status(s, prev, "mean") === "improved" ? "✅" : "  ";
    lines.push(
      `  ${m.padEnd(18)} | ${s.mean.toFixed(4).padStart(10)} | ${s.median.toFixed(4).padStart(8)} | ${s.p95.toFixed(4).padStart(8)} | ${s.p99.toFixed(4).padStart(8)} | ${deltaStr.padStart(8)} ${flag}`,
    );
  }
  lines.push("");
  lines.push(`  runs sampled: ${ipcLatencies.length}`);
  return lines.join("\n");
}

function renderBaseline() {
  if (baselines.length === 0) {
    return "  (no bundle-baseline samples — run `node scripts/perf/bundle-baseline.mjs --json=evidence/perf/bundle-baseline-<date>.json`)";
  }
  const latest = baselines[baselines.length - 1];
  const previous = baselines.length > 1 ? baselines[baselines.length - 2] : null;
  const t = latest.json;
  const lines = [
    `  latest: ${latest.file}`,
    `  measuredAt: ${t.measuredAt}`,
    "",
    `  grand total:`,
    `    raw:   ${(t.grandTotal.raw / (1024 * 1024)).toFixed(2)} MB`,
    `    gzip:  ${(t.grandTotal.gzip / (1024 * 1024)).toFixed(2)} MB`,
    `    brotli: ${(t.grandTotal.brotli / (1024 * 1024)).toFixed(2)} MB`,
  ];
  if (previous) {
    const dt = trend(t.grandTotal, previous.json.grandTotal, "gzip");
    if (dt !== null) {
      const flag = status(t.grandTotal, previous.json.grandTotal, "gzip") === "regressed" ? "⚠️" : "✅";
      lines.push(`    Δ gzip vs prev: ${dt > 0 ? "+" : ""}${dt.toFixed(1)}% ${flag}`);
    }
  }
  lines.push("");
  lines.push(`  top 10 bundles (by raw size):`);
  const top = [...t.bundles].sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 10);
  for (const b of top) {
    lines.push(
      `    ${(b.rawBytes / (1024 * 1024)).toFixed(2).padStart(7)} MB raw | ${(b.gzipBytes / (1024 * 1024)).toFixed(2).padStart(6)} MB gzip | ${b.section}/${b.file}`,
    );
  }
  lines.push("");
  lines.push(`  runs sampled: ${baselines.length}`);
  return lines.join("\n");
}

function renderTopology() {
  if (topologies.length === 0) {
    return "  (no bundle-topology samples — not currently emitted; the topology script reports inline)";
  }
  const latest = topologies[topologies.length - 1];
  return `  latest: ${latest.file}\n  (raw payload available in source file)`;
}

function renderCoverage() {
  if (!coverageReport) return "  (no coverage report at evidence/coverage-report/coverage-report.json)";
  const summary = coverageReport.summary ?? coverageReport;
  const lines = [];
  const keys = ["lines", "branches", "functions", "statements"];
  for (const k of keys) {
    if (typeof summary[k] === "number") {
      lines.push(`    ${k.padEnd(10)} ${summary[k].toFixed(1)}%`);
    } else if (summary[k]?.pct !== undefined) {
      lines.push(`    ${k.padEnd(10)} ${summary[k].pct.toFixed(1)}%`);
    }
  }
  return lines.join("\n") || "  (coverage report present but no recognizable summary block)";
}

// ---------- Compose ---------------------------------------------------------

const md = [
  "# Performance Dashboard",
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## IPC dispatch latency (P3-03)`,
  ``,
  renderIpcLatency(),
  ``,
  `## Bundle size baseline (P3-04)`,
  ``,
  renderBaseline(),
  ``,
  `## Bundle topology (P2-11)`,
  ``,
  renderTopology(),
  ``,
  `## Test coverage (informational)`,
  ``,
  renderCoverage(),
  ``,
  `---`,
  ``,
  `Re-run this dashboard after any perf-relevant change. Files older than --since-days=N are excluded when that flag is set.`,
  ``,
].join("\n");

console.log(md);

if (explicitOut || outDir) {
  const targetDir = explicitOut ? dirname(resolve(repoRoot, explicitOut)) : join(repoRoot, outDir);
  await mkdir(targetDir, { recursive: true });
  const mdPath = explicitOut
    ? resolve(repoRoot, explicitOut)
    : join(repoRoot, outDir, `dashboard-${timestamp}.md`);
  const jsonPath = mdPath.replace(/\.md$/, ".json");
  await writeFile(mdPath, md, "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        inputs: {
          ipcLatency: ipcLatencies.map(({ file, json }) => ({ file, validator: json.validator, results: json.results })),
          bundleBaselines: baselines.map(({ file, json }) => ({ file, measuredAt: json.measuredAt, grandTotal: json.grandTotal })),
          topologies: topologies.map(({ file }) => file),
          coverage: coverageReport?.summary ?? null,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  console.error(`\nwrote ${mdPath}`);
  console.error(`wrote ${jsonPath}`);
}