import { describe, expect, it } from "vitest";
import { createPluginReadinessSnapshot, readinessCounts } from "./readiness";

describe("plugin readiness", () => {
  it("counts disabled and failed entries without treating disabled as degraded", () => {
    expect(readinessCounts([
      { state: "loaded", health: "healthy" },
      { state: "pending" },
      { state: "disabled" },
      { state: "failed" },
      { state: "loaded", health: "degraded" },
    ])).toEqual({ loaded: 2, pending: 1, failed: 1, disabled: 1, degraded: 1 });
  });

  it("derives loading, degraded, failed, and ready phases", () => {
    const base = { phase: "ready" as const, generation: 4, main: [], pi: [] };
    expect(createPluginReadinessSnapshot({ ...base, main: [{ state: "pending" }] }).phase).toBe("loading");
    expect(createPluginReadinessSnapshot({ ...base, main: [{ state: "loaded", health: "degraded" }] }).phase).toBe("degraded");
    expect(createPluginReadinessSnapshot({ ...base, main: [{ state: "failed" }] }).phase).toBe("failed");
    expect(createPluginReadinessSnapshot(base).phase).toBe("ready");
  });
});
