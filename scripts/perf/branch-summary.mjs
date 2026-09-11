#!/usr/bin/env node
/**
 * Branch-summary generation perf bench (Round 31 / G5 PR 2, plan4.1.md §9.21).
 *
 * Measures three timings for representative SessionEntry lists and writes a
 * JSON report to stdout:
 *   - pi-prepare: pi's `prepareBranchEntries(entries, reserveTokens)` alone
 *   - openbuddy-text: OpenBuddy `formatBranchSummary` text-fallback path
 *     (router + pi prepare + `formatBranchSummaryText`)
 *   - ratio: openbuddy-text / pi-prepare  (must be ≤ 1.5 per spec §3 PR 2)
 *
 * Usage:
 *   node scripts/perf/branch-summary.mjs                # default sizes
 *   node scripts/perf/branch-summary.mjs --sizes 50    # custom sizes
 *
 * Exits non-zero when any ratio breaches 1.5x.
 */
import { performance } from "node:perf_hooks";

import {
  formatBranchSummary,
  DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
} from "../../electron/main/agent/branch-summary-format.ts";
import { prepareBranchEntries } from "@earendil-works/pi-coding-agent";

/** Build a chronological `SessionEntry[]` of `count` synthetic messages. */
function buildEntries(count) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    entries.push({
      type: "message",
      id: `m${i}`,
      parentId: i === 0 ? null : `m${i - 1}`,
      timestamp: i,
      message: {
        role,
        content: role === "user" ? `find bug #${i}` : `inspecting line ${i} in src/foo.ts`,
        timestamp: i,
      },
    });
  }
  return entries;
}

/** Run `fn` `iterations` times and return mean ms. */
function benchMs(fn, iterations) {
  // warm-up
  for (let i = 0; i < 3; i++) fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

async function main() {
  const argSizes = process.argv.find((a) => a.startsWith("--sizes="));
  const sizes = argSizes
    ? argSizes.slice("--sizes=".length).split(",").map((s) => Number(s.trim()))
    : [10, 50, 200];
  const iterations = 20;
  const reserveTokens = DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS;

  const results = [];
  for (const size of sizes) {
    const entries = buildEntries(size);

    const piMs = benchMs(
      () => {
        const prepared = prepareBranchEntries(entries, reserveTokens);
        // Touch the result so the JIT cannot elide the call.
        if (prepared.messages.length === -1) throw new Error("unreachable");
      },
      iterations,
    );

    const openbuddyMs = await benchMs(
      () => {
        formatBranchSummary(entries, {
          signal: new AbortController().signal,
          reserveTokens,
        }).then((r) => {
          if (typeof r === "object" && r !== null && "mark" in r) {
            throw new Error("unreachable");
          }
        });
      },
      iterations,
    );

    const ratio = openbuddyMs / piMs;
    results.push({
      entries: size,
      piPrepareMs: Number(piMs.toFixed(3)),
      openbuddyTextMs: Number(openbuddyMs.toFixed(3)),
      ratio: Number(ratio.toFixed(2)),
      pass: ratio <= 1.5,
    });
  }

  const report = {
    bench: "branch-summary",
    iterations,
    reserveTokens,
    sizes,
    results,
    overallPass: results.every((r) => r.pass),
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (!report.overallPass) {
    process.stderr.write(
      `\nFAIL: openbuddy text-fallback exceeds 1.5x of pi default for at least one size.\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`bench failed: ${err.message}\n`);
  process.exit(2);
});