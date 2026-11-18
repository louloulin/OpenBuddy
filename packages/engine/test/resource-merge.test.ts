// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeByName } from "../src/session-pool";

describe("资源合并 (S16)", () => {
  it("keeps app resources first and appends Pi-discovered ones", () => {
    const app = [{ name: "review", origin: "app" }];
    const pi = [{ name: "review", origin: "package" }, { name: "pdf", origin: "package" }];
    expect(mergeByName(app, pi)).toEqual([
      { name: "review", origin: "app" },
      { name: "pdf", origin: "package" },
    ]);
  });

  it("honours per-skill switches from OpenBuddy settings", () => {
    const app = [{ name: "kept" }];
    const pi = [{ name: "kept" }, { name: "disabled" }];
    expect(mergeByName(app, pi, new Set(["disabled"]))).toEqual([{ name: "kept" }]);
  });

  it("ignores nameless entries", () => {
    expect(mergeByName([], [{ name: "" }, { name: "ok" }])).toEqual([{ name: "ok" }]);
  });
});
