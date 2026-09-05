/**
 * Phase 6 e2e — UI session-store behavior, separate from the original
 * session-store.test.ts so we can assert the optimistic-bubble shape that
 * downstream components rely on.
 *
 * Replaces the legacy transcript/replay coverage that lived in the deleted
 * `electron/main/__tests__/session-store*.test.ts`. The Phase 4 store no
 * longer owns the transcript — pi's `AgentSession` does — so this file
 * verifies only the UI state machine: focused session, streaming flag,
 * optimistic user bubble, plan-mode toggle, error banner, reset.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { useSessionStore } from "../session-store";

const resetStore = () =>
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
  });

describe("session-store UI state (Phase 6 e2e)", () => {
  beforeEach(resetStore);

  test("pushOptimisticUser returns an id and stores a text-shaped bubble", () => {
    const id = useSessionStore.getState().pushOptimisticUser("hello");
    const state = useSessionStore.getState();

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const bubble = state.optimisticBubble;
    expect(bubble).not.toBeNull();
    expect(bubble!.id).toBe(id);
    expect(bubble!.role).toBe("user");
    expect(bubble!.complete).toBe(true);
    // MessagePart shape: { kind: "text", text: "hello" }
    expect(bubble!.parts[0]).toMatchObject({ kind: "text", text: "hello" });
  });

  test("popOptimistic clears the optimistic bubble", () => {
    useSessionStore.getState().pushOptimisticUser("hello");
    expect(useSessionStore.getState().optimisticBubble).not.toBeNull();

    useSessionStore.getState().popOptimistic();
    expect(useSessionStore.getState().optimisticBubble).toBeNull();
  });

  test("setStreaming toggles the streaming flag in both directions", () => {
    useSessionStore.getState().setStreaming(true);
    expect(useSessionStore.getState().streaming).toBe(true);

    useSessionStore.getState().setStreaming(false);
    expect(useSessionStore.getState().streaming).toBe(false);
  });

  test("setSession sets the focused session and clears any stale error", () => {
    useSessionStore.getState().setError("stale-error");
    useSessionStore.getState().setSession("sess-42");
    const s = useSessionStore.getState();
    expect(s.sessionId).toBe("sess-42");
    expect(s.error).toBeNull();
  });

  test("setSession(null) clears the focused session", () => {
    useSessionStore.getState().setSession("sess-1");
    useSessionStore.getState().setSession(null);
    expect(useSessionStore.getState().sessionId).toBeNull();
  });

  test("setPlanMode toggles plan mode", () => {
    useSessionStore.getState().setPlanMode(true);
    expect(useSessionStore.getState().planMode).toBe(true);
    useSessionStore.getState().setPlanMode(false);
    expect(useSessionStore.getState().planMode).toBe(false);
  });

  test("setError sets and clears the error banner", () => {
    useSessionStore.getState().setError("boom");
    expect(useSessionStore.getState().error).toBe("boom");
    useSessionStore.getState().setError(null);
    expect(useSessionStore.getState().error).toBeNull();
  });

  test("reset clears focus + every transient flag", () => {
    useSessionStore.getState().setSession("sess-X");
    useSessionStore.getState().setStreaming(true);
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().pushOptimisticUser("x");
    useSessionStore.getState().setError("e");

    useSessionStore.getState().reset();
    const s = useSessionStore.getState();
    expect(s).toMatchObject({
      sessionId: null,
      streaming: false,
      planMode: false,
      optimisticBubble: null,
      error: null,
    });
  });

  test("pushOptimisticUser emits distinct ids across back-to-back calls", () => {
    const a = useSessionStore.getState().pushOptimisticUser("first");
    useSessionStore.getState().popOptimistic();
    const b = useSessionStore.getState().pushOptimisticUser("second");
    expect(a).not.toBe(b);
  });

  test("pushOptimisticUser replaces a prior bubble without leaking", () => {
    const first = useSessionStore.getState().pushOptimisticUser("first");
    const second = useSessionStore.getState().pushOptimisticUser("second");
    const bubble = useSessionStore.getState().optimisticBubble;
    expect(bubble!.id).toBe(second);
    expect(bubble!.id).not.toBe(first);
    expect((bubble!.parts[0] as { text: string }).text).toBe("second");
  });
});
