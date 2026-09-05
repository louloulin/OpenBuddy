/**
 * R3 — session-store plan-mode integration tests.
 *
 * Exercises the full plan workflow from the renderer's perspective:
 *  1. planMode + setPlanMode are independent fields — toggling one
 *     does not affect the other.
 *  2. PlanPanel, PlanModeBanner, and the App.tsx reducer all read
 *     the same fields — the test pins the contract they share.
 *  3. setPlan + setPlanMode can be interleaved without surprising
 *     state (e.g. setPlan clears mode, setPlanMode clears plan).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../session-store";
import type { Plan } from "@openbuddy/shared-types";

function resetStore(): void {
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
    messages: [],
    streamingMessageId: null,
    plan: null,
  });
}

const samplePlan: Plan = {
  entries: [
    { content: "read", priority: "high", status: "completed" },
    { content: "patch", priority: "high", status: "in_progress" },
  ],
};

describe("session-store R3 — plan-mode independence", () => {
  beforeEach(resetStore);

  it("planMode and plan are independent fields", () => {
    expect(useSessionStore.getState().planMode).toBe(false);
    expect(useSessionStore.getState().plan).toBeNull();

    useSessionStore.getState().setPlanMode(true);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toBeNull();

    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);

    useSessionStore.getState().setPlanMode(false);
    expect(useSessionStore.getState().planMode).toBe(false);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);
  });

  it("setPlanMode can be called repeatedly without state drift", () => {
    for (let i = 0; i < 5; i++) {
      useSessionStore.getState().setPlanMode(true);
      useSessionStore.getState().setPlanMode(false);
    }
    expect(useSessionStore.getState().planMode).toBe(false);
  });

  it("setPlanMode(true) followed by setPlan(null) leaves planMode true", () => {
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().planMode).toBe(true);
    useSessionStore.getState().setPlan(null);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toBeNull();
  });

  it("session-switch clears plan but keeps planMode sticky (UI toggle)", () => {
    useSessionStore.getState().setSession("s1");
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).not.toBeNull();

    useSessionStore.getState().setSession("s2");
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toBeNull();
  });

  it("empty plan (no entries) is preserved as-is by setPlan", () => {
    const empty: Plan = { entries: [] };
    useSessionStore.getState().setPlan(empty);
    expect(useSessionStore.getState().plan).toEqual(empty);
    expect(useSessionStore.getState().plan?.entries.length).toBe(0);
  });

  it("plan survives across streaming deltas (the reducer may fire in any order)", () => {
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().streaming).toBe(false);
    useSessionStore.getState().setStreaming(true);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);
    useSessionStore.getState().setStreaming(false);
    expect(useSessionStore.getState().planMode).toBe(true);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);
  });
});
