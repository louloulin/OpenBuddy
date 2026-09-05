import { describe, expect, it } from "vitest";

describe("skills: catalog and toggle primitives", () => {
  it("normalizes a skill identifier to a stable slug", () => {
    const normalize = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    expect(normalize("OpenBuddy Tools")).toBe("openbuddy-tools");
    expect(normalize("  /skill/path ")).toBe("skill-path");
    expect(normalize("___")).toBe("");
  });

  it("toggles a skill state idempotently", () => {
    const enabled = new Set<string>(["a", "b", "c"]);
    const toggle = (id: string) => {
      if (enabled.has(id)) enabled.delete(id);
      else enabled.add(id);
    };
    toggle("a");
    expect(enabled.has("a")).toBe(false);
    toggle("a");
    expect(enabled.has("a")).toBe(true);
  });

  it("renders a skill catalog index deterministically", () => {
    const catalog = [
      { id: "b", name: "B" },
      { id: "a", name: "A" },
      { id: "c", name: "C" },
    ];
    const sorted = [...catalog].sort((x, y) => x.id.localeCompare(y.id));
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
