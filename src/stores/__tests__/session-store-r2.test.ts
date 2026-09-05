/**
 * R2 — unit tests for the Plan mirror action (`setPlan`).
 *
 * Phase 4 deleted `plan` / `setPlan` from the store; R2 re-introduced them
 * so ChatView, PlanPanel, and PlanModeBanner can render the latest execution
 * plan without each having to subscribe to the agent's event stream.
 * These tests guard against accidental removal (as happened in Phase 4) and
 * ensure the clear-on-session-switch behaviour is preserved.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../session-store";
import type { ChatMessage } from "../session-store";
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
    { content: "step 1: read file", priority: "high", status: "completed" },
    { content: "step 2: apply patch", priority: "high", status: "in_progress" },
    { content: "step 3: verify", priority: "medium", status: "pending" },
  ],
};

describe("session-store R2 — plan mirror", () => {
  beforeEach(resetStore);

  it("initial state has plan = null", () => {
    expect(useSessionStore.getState().plan).toBeNull();
  });

  it("setPlan replaces the plan with a new one", () => {
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);
  });

  it("setPlan(null) clears the plan", () => {
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().plan).not.toBeNull();
    useSessionStore.getState().setPlan(null);
    expect(useSessionStore.getState().plan).toBeNull();
  });

  it("setPlan overwrites the previous plan (ACP replace semantics)", () => {
    const first: Plan = { entries: [{ content: "old", priority: "low", status: "pending" }] };
    useSessionStore.getState().setPlan(first);
    useSessionStore.getState().setPlan(samplePlan);
    expect(useSessionStore.getState().plan).toEqual(samplePlan);
    expect(useSessionStore.getState().plan?.entries[0].content).toBe("step 1: read file");
  });

  it("setSession clears the plan (replay boundary)", () => {
    useSessionStore.getState().setPlan(samplePlan);
    useSessionStore.getState().setSession("s1");
    expect(useSessionStore.getState().plan).toBeNull();
  });

  it("reset() clears the plan along with all other transient state", () => {
    useSessionStore.getState().setSession("s1");
    useSessionStore.getState().setPlan(samplePlan);
    useSessionStore.setState({ messages: [{ id: "m1", role: "user", parts: [{ kind: "text", text: "hi" }], complete: true } as ChatMessage] });
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().plan).toBeNull();
    expect(useSessionStore.getState().sessionId).toBeNull();
    expect(useSessionStore.getState().messages).toEqual([]);
  });

  it("setPlan defensively snapshots via structuredClone (caller mutation safety)", () => {
    const original: Plan = { entries: [{ content: "a", priority: "low", status: "pending" }] };
    const snapshot = JSON.parse(JSON.stringify(original));
    useSessionStore.getState().setPlan(original);
    // Mutate the input after storing — store should hold the original shape.
    original.entries[0].content = "MUTATED";
    expect(useSessionStore.getState().plan?.entries[0].content).toBe(snapshot.entries[0].content);
  });
});
