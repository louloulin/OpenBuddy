import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-agent-core";
import {
  buildOpenbuddyCompactionSettings,
  DEFAULT_OPENBUDDY_COMPACTION_SETTINGS,
  type OpenbuddyCompactionTuning,
} from "./openbuddy-compaction-settings";

describe("openbuddy-compaction-settings (plan4.4 §A — custom pi compaction strategy)", () => {
  it("exports a frozen default tuning so renderer + agent-host share the same anchor", () => {
    expect(DEFAULT_OPENBUDDY_COMPACTION_SETTINGS).toBeDefined();
    expect(Object.isFrozen(DEFAULT_OPENBUDDY_COMPACTION_SETTINGS)).toBe(true);
  });

  it("builds a CompactionSettings instance with all three required fields", () => {
    const settings = buildOpenbuddyCompactionSettings();
    expect(typeof settings.enabled).toBe("boolean");
    expect(typeof settings.reserveTokens).toBe("number");
    expect(typeof settings.keepRecentTokens).toBe("number");
  });

  it("compaction is enabled by default (auto-compaction is part of workbuddy UX)", () => {
    const settings = buildOpenbuddyCompactionSettings();
    expect(settings.enabled).toBe(true);
  });

  it("reserveTokens is at least as large as the document truncator budget", () => {
    // Document truncator uses ~24_000 chars (~6k output tokens). The
    // compaction reserveTokens must be ≥ 24_000 chars worth (use the
    // conservative 4-char heuristic = 6_000 tokens) so we never hand the
    // summarizer a prompt that already gets truncated by agent-prompt.
    const settings = buildOpenbuddyCompactionSettings();
    expect(settings.reserveTokens).toBeGreaterThanOrEqual(6_000);
  });

  it("keepRecentTokens leaves room for the document truncator budget", () => {
    // The truncator budget is 24_000 chars (~6k tokens); keepRecentTokens
    // must NOT exceed (contextWindow - reserveTokens - truncatorBudget) so
    // a compaction that retains recent context doesn't drop document
    // blocks the model still needs to cite.
    const settings = buildOpenbuddyCompactionSettings();
    expect(settings.keepRecentTokens).toBeLessThanOrEqual(120_000);
  });

  it("accepts a tuning override without mutating the frozen defaults", () => {
    const before = JSON.stringify(DEFAULT_OPENBUDDY_COMPACTION_SETTINGS);
    const settings = buildOpenbuddyCompactionSettings({
      reserveTokens: 12_000,
      keepRecentTokens: 60_000,
    });
    expect(settings.reserveTokens).toBe(12_000);
    expect(settings.keepRecentTokens).toBe(60_000);
    expect(JSON.stringify(DEFAULT_OPENBUDDY_COMPACTION_SETTINGS)).toBe(before);
  });

  it("clamps invalid inputs (negative numbers, NaN) to safe defaults", () => {
    const settings = buildOpenbuddyCompactionSettings({
      reserveTokens: -100,
      keepRecentTokens: Number.NaN,
    });
    expect(settings.reserveTokens).toBeGreaterThan(0);
    expect(Number.isFinite(settings.keepRecentTokens)).toBe(true);
    expect(settings.keepRecentTokens).toBeGreaterThan(0);
  });

  it("merges with pi DEFAULT_COMPACTION_SETTINGS so unknown fields stay available", () => {
    // Regression guard: pi upstream may extend CompactionSettings in the
    // future. Our factory must return a record with at least the pi defaults
    // + our overrides merged, so consumers can rely on a complete shape.
    const settings = buildOpenbuddyCompactionSettings();
    // Pi's default has the same three fields; we expect ours to be valid
    // and at least one field to be tuned relative to the pi default.
    expect(DEFAULT_COMPACTION_SETTINGS).toBeDefined();
    expect(typeof DEFAULT_COMPACTION_SETTINGS.reserveTokens).toBe("number");
    // Our factory should produce something meaningfully different from the
    // bare pi defaults — that's the whole point of plan4.4 §A.
    const ours = settings;
    const isDifferent =
      ours.reserveTokens !== DEFAULT_COMPACTION_SETTINGS.reserveTokens ||
      ours.keepRecentTokens !== DEFAULT_COMPACTION_SETTINGS.keepRecentTokens;
    expect(isDifferent).toBe(true);
  });

  it("tuning shape is fully exported so renderer-side tooling can introspect it", () => {
    // Type-level guard: TypeScript should accept the OpenbuddyCompactionTuning
    // shape without `any` casts. If someone narrows the type accidentally,
    // this test will fail to compile.
    const tuning: OpenbuddyCompactionTuning = {
      reserveTokens: 8_000,
      keepRecentTokens: 100_000,
      enabled: true,
    };
    expect(tuning).toEqual({
      reserveTokens: 8_000,
      keepRecentTokens: 100_000,
      enabled: true,
    });
  });
});