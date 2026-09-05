import { describe, expect, it } from "vitest";
import { createPluginReadinessSnapshot } from "./readiness";
import { createPluginSnapshot } from "./plugin-snapshot";

describe("plugin snapshot", () => {
  it("reports missing faces instead of treating package discovery as loading", () => {
    const readiness = createPluginReadinessSnapshot({ generation: 3, phase: "ready", main: [], pi: [] });
    const snapshot = createPluginSnapshot({
      generation: 7,
      readiness,
      recovery: { pending: 1, uncertain: 2, byMethod: { "capability.email": 2, "session.prompt": 1 } },
      commit: {
        generation: 9,
        transactionId: "plugin-commit-9",
        kind: "profile-reload",
        target: "profile",
        committedAt: "2026-08-27T07:00:00.000Z",
        receipts: { pi: { surface: "pi", preparedAt: "2026-08-27T07:00:00.000Z" } },
      },
      packages: [
        { name: "@fixture/full", expected: ["bundle", "pi", "renderer", "remote", "typert"], loaded: ["bundle", "pi", "renderer", "remote", "typert"] },
        { name: "@fixture/partial", expected: ["renderer", "remote"], loaded: ["renderer"] },
      ],
    });
    expect(snapshot.consistency).toEqual({ complete: false, issues: ["@fixture/partial: remote surface is not loaded"] });
    expect(snapshot.surfaces.remote).toEqual({ expected: 2, loaded: 1, missing: 1 });
    expect(snapshot.packages[1]).toMatchObject({ name: "@fixture/partial", missing: ["remote"], complete: false });
    expect(snapshot.recovery).toEqual({ pending: 1, uncertain: 2, byMethod: { "capability.email": 2, "session.prompt": 1 } });
    expect(snapshot.commit).toMatchObject({
      generation: 9,
      transactionId: "plugin-commit-9",
      receipts: { pi: { surface: "pi" } },
    });
  });

  it("keeps a failed readiness phase visible even with no package gap", () => {
    const readiness = createPluginReadinessSnapshot({ generation: 3, phase: "failed", main: [], pi: [] });
    const snapshot = createPluginSnapshot({ generation: 4, readiness, packages: [] });
    expect(snapshot.consistency).toEqual({ complete: false, issues: ["plugin readiness is failed"] });
  });
});
