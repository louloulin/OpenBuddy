// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyPackageFilters, packageFilterState, withPackageFilters } from "../src/features/extensions";

describe("Pi 包资源开关 (S17)", () => {
  it("reports only explicitly filtered resource types", () => {
    expect(packageFilterState(undefined)).toBeUndefined();
    expect(packageFilterState("npm:a")).toBeUndefined();
    expect(packageFilterState({ source: "npm:a" })).toBeUndefined();
    expect(packageFilterState({ source: "npm:a", skills: [] })).toEqual({ skills: false });
    expect(packageFilterState({ source: "npm:a", skills: ["x"], themes: [] })).toEqual({ skills: true, themes: false });
  });

  it("writes [] when a type is off and drops the key when it is on", () => {
    expect(applyPackageFilters("npm:a", { skills: false })).toEqual({ source: "npm:a", skills: [] });
    expect(applyPackageFilters({ source: "npm:a", autoload: false, prompts: [] }, { prompts: true })).toEqual({ source: "npm:a", autoload: false });
    // Nothing left beyond the source: collapse back to Pi's string form.
    expect(applyPackageFilters({ source: "npm:a", skills: [] }, { skills: true })).toBe("npm:a");
  });

  it("attaches filters to the list the panel renders", () => {
    const packages = [{ source: "npm:a" }, { source: "git:https://x/y" }];
    expect(withPackageFilters(packages, ["npm:a", { source: "git:https://x/y", extensions: [] }])).toEqual([
      { source: "npm:a" },
      { source: "git:https://x/y", filters: { extensions: false } },
    ]);
  });
});
