import { describe, expect, it, vi } from "vitest";
import { cancelStaleUiRequests } from "./ui-request-generation";

describe("cancelStaleUiRequests", () => {
  it("cancels only requests from older generations and emits a diagnostic", () => {
    const oldResolve = vi.fn();
    const currentResolve = vi.fn();
    const unversionedResolve = vi.fn();
    const pendingUiRequests = new Map<string, any>([
      ["old", { sessionId: "s-old", generation: 1, resolve: oldResolve }],
      ["current", { sessionId: "s-current", generation: 2, resolve: currentResolve }],
      ["legacy", { sessionId: "s-legacy", resolve: unversionedResolve }],
    ]);
    const emit = vi.fn();

    expect(cancelStaleUiRequests({ pendingUiRequests }, 2, emit, 1, "profile-reload")).toBe(1);
    expect(oldResolve).toHaveBeenCalledWith(undefined);
    expect(currentResolve).not.toHaveBeenCalled();
    expect(unversionedResolve).not.toHaveBeenCalled();
    expect([...pendingUiRequests.keys()]).toEqual(["current", "legacy"]);
    expect(emit).toHaveBeenCalledWith("pi/ui-request-cancelled", {
      requestId: "old",
      sessionId: "s-old",
      previousGeneration: 1,
      generation: 2,
      reason: "profile-reload",
      diagnostic: "stale-generation",
    });
  });

  it("is idempotent when called repeatedly for the same generation", () => {
    const resolve = vi.fn();
    const pendingUiRequests = new Map([["old", { sessionId: "s", generation: 1, resolve }]]);
    const emit = vi.fn();
    expect(cancelStaleUiRequests({ pendingUiRequests }, 2, emit)).toBe(1);
    expect(cancelStaleUiRequests({ pendingUiRequests }, 2, emit)).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
