import { describe, expect, it } from "vitest";

import { computeActiveAdapterIds } from "./compute-active-adapter-ids";
import type { AgentHostState } from "../_state-shape";

type Status = { id: string; mode: string; adapter?: string };

function makeStubState(statuses: Status[]): AgentHostState {
  return {
    piExtensionStatuses: statuses,
  } as unknown as AgentHostState;
}

describe("host-modules/bootstrap/compute-active-adapter-ids", () => {
  it("returns an empty set when state has no statuses", () => {
    const state = makeStubState([]);
    const ids = computeActiveAdapterIds({ state });
    expect(ids.size).toBe(0);
  });

  it("includes the entry id of every adapter-mode status", () => {
    const state = makeStubState([
      { id: "alpha", mode: "adapter" },
      { id: "beta", mode: "adapter" },
    ]);
    const ids = computeActiveAdapterIds({ state });
    expect([...ids].sort()).toEqual(["alpha", "beta"]);
  });

  it("ignores non-adapter statuses", () => {
    const state = makeStubState([
      { id: "alpha", mode: "adapter" },
      { id: "tool-1", mode: "tool" },
      { id: "skill-1", mode: "skill" },
    ]);
    const ids = computeActiveAdapterIds({ state });
    expect([...ids]).toEqual(["alpha"]);
  });

  it("strips the openbuddy- prefix from the adapter field", () => {
    const state = makeStubState([
      { id: "alpha", mode: "adapter", adapter: "openbuddy-foo" },
    ]);
    const ids = computeActiveAdapterIds({ state });
    expect([...ids].sort()).toEqual(["alpha", "foo"]);
  });

  it("keeps the adapter field as-is when it lacks the prefix", () => {
    const state = makeStubState([
      { id: "alpha", mode: "adapter", adapter: "bar" },
    ]);
    const ids = computeActiveAdapterIds({ state });
    expect([...ids].sort()).toEqual(["alpha", "bar"]);
  });

  it("deduplicates when id and adapter resolve to the same value", () => {
    const state = makeStubState([
      { id: "foo", mode: "adapter", adapter: "openbuddy-foo" },
    ]);
    const ids = computeActiveAdapterIds({ state });
    expect([...ids]).toEqual(["foo"]);
  });
});
