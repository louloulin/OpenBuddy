/**
 * Branch-summary perf budget test (Round 31 / G5 PR 2, plan4.1.md §9.21).
 *
 * Measures the OpenBuddy text-fallback path against pi's bare
 * `prepareBranchEntries` call, asserts the OpenBuddy overhead is within
 * the spec budget (1.5x of pi default). Exceeding the budget signals a
 * regression in the rewind summary hot path.
 */
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";
import { prepareBranchEntries } from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
  formatBranchSummary,
} from "../../electron/main/agent/branch-summary-format";

function buildEntries(count: number) {
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

function benchMs(fn: () => void, iterations: number): number {
  for (let i = 0; i < 3; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

describe("branch-summary perf budget (G5 PR 2)", () => {
  it("exports a DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS of 8_000", () => {
    expect(DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS).toBe(8_000);
  });

  it("text-fallback overhead ≤ 1.5x of pi's prepareBranchEntries (size=50)", async () => {
    const entries = buildEntries(50);
    const iterations = 30;

    const piMs = benchMs(() => {
      prepareBranchEntries(entries, DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS);
    }, iterations);

    const openbuddyMs = await benchMs(() => {
      void formatBranchSummary(entries, {
        signal: new AbortController().signal,
        reserveTokens: DEFAULT_BRANCH_SUMMARY_RESERVE_TOKENS,
      });
    }, iterations);

    const ratio = openbuddyMs / piMs;
    // ratio is allowed a generous 1.5x slack; CI variance + promise allocation
    // pushes the OpenBuddy path slightly above the raw pi call.
    expect(ratio).toBeLessThanOrEqual(1.5);
  });
});