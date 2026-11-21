import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readBranchHistory, readBranchState, writeBranchState } from "../src/builtin/session-state";

describe("built-in session state (pii W0.5)", () => {
  it("reads the latest value on the current branch and follows branch switches", () => {
    const sm = SessionManager.inMemory("/tmp");
    expect(readBranchState(sm, "openbuddy.mode")).toBeUndefined();
    const first = sm.appendCustomEntry("openbuddy.mode", { mode: "craft" });
    sm.appendCustomEntry("openbuddy.mode", { mode: "ask" });
    expect(readBranchState(sm, "openbuddy.mode")).toEqual({ mode: "ask" });
    expect(readBranchHistory(sm, "openbuddy.mode")).toEqual([{ mode: "craft" }, { mode: "ask" }]);
    // Move the leaf back to the first entry: the other branch's value is no longer visible.
    sm.branch(first);
    expect(readBranchState(sm, "openbuddy.mode")).toEqual({ mode: "craft" });
  });

  it("skips writing a value equal to the branch's current one", () => {
    const sm = SessionManager.inMemory("/tmp");
    expect(writeBranchState(sm, "openbuddy.mode", { mode: "plan" })).toBeTypeOf("string");
    expect(writeBranchState(sm, "openbuddy.mode", { mode: "plan" })).toBeUndefined();
    expect(readBranchHistory(sm, "openbuddy.mode")).toHaveLength(1);
  });
});
