#!/usr/bin/env node
/**
 * P3-02 — Cold-start benchmark gate.
 *
 * Reads the JSONL files written by `electron/main/observability/perf-trace.ts`
 * (one per Electron session, written under `<userData>/perf-trace/`) and
 * computes cold-start metrics that the perf dashboard and CI can gate on.
 *
 * Why a separate analyzer instead of doing this inside the renderer:
 *   - Cold-start spans "process spawn → window first paint". The renderer
 *     cannot observe the spawn half, so a Node-side analyzer is required
 *     to compare against a hard budget.
 *   - The JSONL format is stable (see `perf-trace.ts` PerfTraceMark type)
 *     and is already emitted on every production startup, so the analyzer
 *     can be re-run against historical traces after a regression to
 *     identify which phase regressed.
 *
 * Markers consumed (see electron/main/observability/perf-trace.ts callers):
 *   - "app-whenReady"            — main process Electron `ready` event
 *   - "agent-host-loaded"        — agent-host ESM chunk finished evaluating
 *   - "harness-server-spawn"     — harness sidecar started
 *   - "connectors-register-end"  — all connector plugins registered
 *   - "first-paint"              — renderer's first paint after load
 *   - "window-ready"             — `ready-to-show` fired (P0-01)
 *   - "window-resources-ready"   — `did-finish-load` fired (legacy fallback)
 *
 * Metrics produced:
 *   - readyMs       : process spawn → window-ready (primary cold-start)
 *   - paintMs       : process spawn → first-paint (perceived)
 *   - harnessMs     : app-whenReady → harness-server-spawn
 *   - agentHostMs   : app-whenReady → agent-host-loaded
 *   - connectorsMs  : connectors-register-start → connectors-register-end
 *   - counts        : number of marks seen in the file
 *
 * Usage:
 *   # Default: analyze the most recent JSONL under the default userData dir
 *   node scripts/perf/cold-start.mjs
 *
 *   # Analyze a specific JSONL file
 *   node scripts/perf/cold-start.mjs --input=path/to/perf-trace-xxx.jsonl
 *
 *   # Compare against a budget; non-zero exit on violation
 *   node scripts/perf/cold-start.mjs --budget-ready-ms=2500 --budget-paint-ms=2200
 *
 *   # Emit a JSON artifact the dashboard aggregator can pick up
 *   node scripts/perf/cold-start.mjs --json=evidence/perf/cold-start-2026-01-01.json
 *
 *   # Use a custom userData root (matches `OPENBUDDY_TEST_USER_DATA` style)
 *   node scripts/perf/cold-start.mjs --user-data=./tmp/openbuddy-cold-start
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, computeMetrics, evaluateBudgets, buildJsonArtifact } from "./_cold-start-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- CLI --------------------------------------------------------------------

function argValue(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function argFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}
function argNumber(name, fallback) {
  const raw = argValue(name, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const inputPath = argValue("input", "");
const userData = argValue("user-data", "");
const jsonOut = argValue("json", "");
const budgetReadyMs = argNumber("budget-ready-ms", NaN);
const budgetPaintMs = argNumber("budget-paint-ms", NaN);
const quiet = argFlag("quiet");

// --- Trace file discovery --------------------------------------------------

async function findLatestJsonl(root) {
  const dir = join(root, "perf-trace");
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter((f) => f.startsWith("perf-trace-") && f.endsWith(".jsonl"));
  if (candidates.length === 0) return null;
  const sorted = await Promise.all(
    candidates.map(async (name) => {
      const full = join(dir, name);
      const s = await stat(full);
      return { name, full, mtime: s.mtimeMs };
    }),
  );
  sorted.sort((a, b) => b.mtime - a.mtime);
  return sorted[0].full;
}

function defaultUserData() {
  // Match Electron's default per-platform layout so a user can run this
  // against their own real install without flags. macOS path mirrors
  // `app.getPath('userData')`; Linux/Windows use the same XDG-style location.
  if (process.platform === "darwin") {
    return join(process.env.HOME ?? "", "Library", "Application Support", "openbuddy");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(process.env.HOME ?? "", "AppData", "Roaming"), "openbuddy");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "openbuddy");
}

// --- Reporting --------------------------------------------------------------

function pad(label, value, unit = "ms") {
  return `${label.padEnd(28)} ${String(value).padStart(10)} ${unit}`;
}

function formatReport(metrics, source) {
  const lines = [
    `cold-start (source: ${source})`,
    `  marks seen:           ${metrics.counts.total} (${metrics.counts.uniqueNames} unique)`,
    `  ${pad("ready (ready-to-show)", metrics.readyMs ?? "n/a")}`,
    `  ${pad("paint (first-paint)", metrics.paintMs ?? "n/a")}`,
    `  ${pad("harness spawn", metrics.harnessMs ?? "n/a")}`,
    `  ${pad("agent-host load", metrics.agentHostMs ?? "n/a")}`,
    `  ${pad("connectors register", metrics.connectorsMs ?? "n/a")}`,
  ];
  return lines.join("\n");
}

// --- Entry ------------------------------------------------------------------

async function main() {
  let resolvedInput = inputPath;
  if (!resolvedInput) {
    const root = userData || defaultUserData();
    resolvedInput = (await findLatestJsonl(root)) ?? "";
  }
  if (!resolvedInput) {
    console.error("[cold-start] no perf-trace JSONL found");
    console.error("  hint: launch the Electron app once to generate a trace, or pass --input=<path>");
    process.exit(2);
  }

  const marks = await readJsonl(resolvedInput);
  if (marks.length === 0) {
    console.error(`[cold-start] ${resolvedInput} is empty`);
    process.exit(2);
  }

  const metrics = computeMetrics(marks);
  const source = resolvedInput;

  if (!quiet) {
    console.log(formatReport(metrics, source));
  }

  if (jsonOut) {
    const artifact = buildJsonArtifact(
      metrics,
      source,
      { readyMs: budgetReadyMs, paintMs: budgetPaintMs },
      new Date().toISOString(),
    );
    const outPath = resolve(repoRoot, jsonOut);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
    if (!quiet) console.log(`[cold-start] wrote ${outPath}`);
  }

  const violations = evaluateBudgets(metrics, { readyMs: budgetReadyMs, paintMs: budgetPaintMs });
  if (violations.length > 0) {
    console.error("[cold-start] BUDGET VIOLATIONS:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[cold-start] failed:", error?.stack ?? error);
  process.exit(2);
});
