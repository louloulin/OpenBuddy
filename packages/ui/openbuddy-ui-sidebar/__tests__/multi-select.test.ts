/**
 * R2.2 — Multi-select toggle reducer.
 *
 * The Sidebar keeps local multi-select state in a `Set<string>`. The reducer
 * must:
 *   - When `multi=false` (plain click), REPLACE the selection with one id
 *     so the prior batch is discarded.
 *   - When `multi=true` (Shift/Cmd/Ctrl click), ADD the id; if it was already
 *     selected, REMOVE it.
 *   - Never mutate the input Set.
 */
import { describe, expect, it } from "vitest";
import { applyToggleSelected } from "../src/Sidebar";

describe("applyToggleSelected", () => {
  it("returns a single-id set when multi=false (replaces prior batch)", () => {
    const prev = new Set(["a", "b", "c"]);
    const next = applyToggleSelected(prev, "z", false);
    expect([...next]).toEqual(["z"]);
  });

  it("appends when multi=true and id not in selection", () => {
    const prev = new Set(["a", "b"]);
    const next = applyToggleSelected(prev, "c", true);
    expect([...next].sort()).toEqual(["a", "b", "c"]);
  });

  it("removes the id when multi=true and id already selected", () => {
    const prev = new Set(["a", "b", "c"]);
    const next = applyToggleSelected(prev, "b", true);
    expect([...next].sort()).toEqual(["a", "c"]);
  });

  it("never mutates the input set", () => {
    const prev = new Set(["a"]);
    applyToggleSelected(prev, "b", true);
    expect([...prev]).toEqual(["a"]);
    applyToggleSelected(prev, "c", false);
    expect([...prev]).toEqual(["a"]);
  });

  it("handles empty previous selection in both branches", () => {
    const a = applyToggleSelected(new Set<string>(), "x", true);
    expect([...a]).toEqual(["x"]);
    const b = applyToggleSelected(new Set<string>(), "y", false);
    expect([...b]).toEqual(["y"]);
  });
});