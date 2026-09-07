import { describe, expect, it, vi } from "vitest";

import { createJobsRegistry } from "./jobs-registry";
import type { AgentHostState } from "../_state-shape";
import type { HostJobRecord } from "../_state-shape";

/**
 * Build a minimal AgentHostState stub covering only the jobs fields.
 */
function makeStubState(): AgentHostState {
  return {
    jobsRegistry: new Map<string, HostJobRecord>(),
  } as unknown as AgentHostState;
}

function makeJob(overrides: Partial<HostJobRecord>): HostJobRecord {
  return {
    id: "j",
    startedAt: 0,
    kind: "test",
    description: "test job",
    status: "running",
    ...overrides,
  };
}

describe("host-modules/bootstrap/jobs-registry", () => {
  it("register stores the job and emits session/jobs when sessionId is set", () => {
    const state = makeStubState();
    const events: Array<{ type: string; payload: unknown }> = [];
    const jobs = createJobsRegistry({
      state,
      emitPluginEvent: (type, payload) => events.push({ type, payload }),
    });

    const unregister = jobs.register(makeJob({ id: "j-1", sessionId: "s-1" }));
    expect(state.jobsRegistry.get("j-1")).toBeDefined();
    expect(events).toEqual([{ type: "session/jobs", payload: { sessionId: "s-1" } }]);

    unregister();
    expect(state.jobsRegistry.has("j-1")).toBe(false);
    expect(events.length).toBe(2);
  });

  it("register omits session/jobs when sessionId is undefined", () => {
    const state = makeStubState();
    const events: Array<{ type: string }> = [];
    const jobs = createJobsRegistry({
      state,
      emitPluginEvent: (type) => events.push({ type }),
    });

    jobs.register(makeJob({ id: "j-2" }));
    expect(state.jobsRegistry.has("j-2")).toBe(true);
    expect(events).toEqual([]);
  });

  it("update is a no-op for unknown ids", () => {
    const state = makeStubState();
    const emit = vi.fn();
    const jobs = createJobsRegistry({ state, emitPluginEvent: emit });
    jobs.update("missing", { status: "completed" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("update applies the patch and emits session/jobs", () => {
    const state = makeStubState();
    state.jobsRegistry.set("j-3", makeJob({ id: "j-3", sessionId: "s-3", description: "before" }));
    const emit = vi.fn();
    const jobs = createJobsRegistry({ state, emitPluginEvent: emit });
    jobs.update("j-3", { description: "after" });
    expect(state.jobsRegistry.get("j-3")?.description).toBe("after");
    expect(emit).toHaveBeenCalledWith("session/jobs", { sessionId: "s-3" });
  });

  it("list filters by sessionId and strips internal fields", () => {
    const state = makeStubState();
    state.jobsRegistry.set("a", makeJob({ id: "a", sessionId: "s-1", description: "A" }));
    state.jobsRegistry.set("b", makeJob({ id: "b", sessionId: "s-2", description: "B" }));
    state.jobsRegistry.set("c", makeJob({ id: "c", sessionId: "s-1", description: "C" }));

    const jobs = createJobsRegistry({ state, emitPluginEvent: () => undefined });
    const all = jobs.list();
    expect(all.map((j) => j.id).sort()).toEqual(["a", "b", "c"]);

    const s1 = jobs.list("s-1");
    expect(s1.map((j) => j.id).sort()).toEqual(["a", "c"]);
  });

  it("get returns the job by id", () => {
    const state = makeStubState();
    state.jobsRegistry.set("j-4", makeJob({ id: "j-4", description: "test" }));
    const jobs = createJobsRegistry({ state, emitPluginEvent: () => undefined });
    expect(jobs.get("j-4")).toEqual(makeJob({ id: "j-4", description: "test" }));
    expect(jobs.get("missing")).toBeUndefined();
  });
});
