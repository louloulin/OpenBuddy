import { describe, expect, it, vi } from "vitest";
import { startProfileWatchers, stopProfileWatchers } from "./watchers";
import { createDefaultAgentHostState } from "../_default-state";
import type { AgentHostState } from "../_state-shape";

describe("stopProfileWatchers (extracted pure)", () => {
  it("clears the reload timer and closes all watchers", () => {
    const state = createDefaultAgentHostState();
    const timer = setTimeout(() => {}, 0);
    state.profileReloadTimer = timer as unknown as ReturnType<typeof setTimeout>;
    const closed: string[] = [];
    const watcherA = { close: () => closed.push("a") };
    const watcherB = { close: () => closed.push("b") };
    state.profileWatchers = [watcherA as never, watcherB as never];
    stopProfileWatchers(state);
    expect(state.profileReloadTimer).toBeNull();
    expect(closed).toEqual(["a", "b"]);
    expect(state.profileWatchers).toEqual([]);
    clearTimeout(timer);
  });
});

describe("startProfileWatchers (extracted pure)", () => {
  it("registers watchers for targets that exist and reports misses as warnings", async () => {
    // Use a target that does not exist so stat() rejects and nothing is watched,
    // while a real temp file target is watched.
    const state = createDefaultAgentHostState();
    const targets = () => ["/definitely/not/a/real/path/xyz"];
    const reload = vi.fn();
    await startProfileWatchers(state, reload, targets);
    expect(state.profileWatchers.length).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });
});
