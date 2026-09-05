import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../session-store";

/**
 * Phase 4 — UI-only session store. The transcript moved to pi's
 * AgentSession, so this test file is intentionally tiny. We assert the
 * transient UI state machine: focused session, streaming flag, optimistic
 * user bubble, plan mode, error banner, reset semantics.
 */

const resetStore = () =>
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
  });

describe("session-store UI state", () => {
  beforeEach(resetStore);

  it("setSession flips focus and clears any stale error", () => {
    useSessionStore.setState({ error: "stale" });
    useSessionStore.getState().setSession("A");
    expect(useSessionStore.getState().sessionId).toBe("A");
    expect(useSessionStore.getState().error).toBeNull();
  });

  it("setStreaming toggles the streaming flag", () => {
    useSessionStore.getState().setSession("A");
    expect(useSessionStore.getState().streaming).toBe(false);
    useSessionStore.getState().setStreaming(true);
    expect(useSessionStore.getState().streaming).toBe(true);
    useSessionStore.getState().setStreaming(false);
    expect(useSessionStore.getState().streaming).toBe(false);
  });

  it("setPlanMode toggles the plan-mode flag", () => {
    useSessionStore.getState().setPlanMode(true);
    expect(useSessionStore.getState().planMode).toBe(true);
    useSessionStore.getState().setPlanMode(false);
    expect(useSessionStore.getState().planMode).toBe(false);
  });

  it("pushOptimisticUser creates a bubble; popOptimistic clears it", () => {
    useSessionStore.getState().setSession("A");
    const id = useSessionStore.getState().pushOptimisticUser("hello");
    expect(typeof id).toBe("string");
    const bubble = useSessionStore.getState().optimisticBubble;
    expect(bubble).not.toBeNull();
    expect(bubble!.id).toBe(id);
    expect(bubble!.role).toBe("user");
    expect(bubble!.complete).toBe(true);
    expect(bubble!.parts[0]).toEqual({ kind: "text", text: "hello" });
    useSessionStore.getState().popOptimistic();
    expect(useSessionStore.getState().optimisticBubble).toBeNull();
  });

  it("setError sets the banner; reset clears it", () => {
    useSessionStore.getState().setError("boom");
    expect(useSessionStore.getState().error).toBe("boom");
    useSessionStore.getState().setError(null);
    expect(useSessionStore.getState().error).toBeNull();
  });

  it("reset clears focus + every transient flag", () => {
    useSessionStore.getState().setSession("A");
    useSessionStore.getState().setStreaming(true);
    useSessionStore.getState().setPlanMode(true);
    useSessionStore.getState().pushOptimisticUser("x");
    useSessionStore.getState().setError("e");
    useSessionStore.getState().reset();
    expect(useSessionStore.getState()).toMatchObject({
      sessionId: null,
      streaming: false,
      planMode: false,
      optimisticBubble: null,
      error: null,
    });
  });


  it("migrateSession renames the focused session id and keeps state", () => {
    useSessionStore.getState().setSession("__pending_42");
    const bubbleId = useSessionStore.getState().pushOptimisticUser("hello");
    useSessionStore.getState().setStreaming(true);
    useSessionStore.getState().migrateSession("__pending_42", "real_abc");
    expect(useSessionStore.getState().sessionId).toBe("real_abc");
    expect(useSessionStore.getState().streaming).toBe(true);
    expect(useSessionStore.getState().optimisticBubble?.id).toBe(bubbleId);
    expect(useSessionStore.getState().messages.at(-1)?.id).toBe(bubbleId);
  });

  it("migrateSession is a no-op when the focused session does not match", () => {
    useSessionStore.getState().setSession("real_abc");
    useSessionStore.getState().migrateSession("__pending_42", "real_xyz");
    expect(useSessionStore.getState().sessionId).toBe("real_abc");
  });

  it("migrateSession is a no-op when oldId === newId", () => {
    useSessionStore.getState().setSession("real_abc");
    const before = useSessionStore.getState().messages.length;
    useSessionStore.getState().migrateSession("real_abc", "real_abc");
    expect(useSessionStore.getState().sessionId).toBe("real_abc");
    expect(useSessionStore.getState().messages.length).toBe(before);
  });

  // Regression guard for the "半天没返回" symptom — pre-fix the SSE replay
  // during piLoadSession could create an empty bubble via beginStreamingMessage
  // AFTER loadHistoryMessages had wiped messages[]. The leftover streamingMessageId
  // then pointed at a row that no longer existed; the next prompt's
  // appendStreamingDelta silently dropped every delta (findIndex === -1) and
  // the user saw nothing. The fix: loadHistoryMessages is the SESSION-BOUNDARY
  // event and must clear all transient streaming state alongside messages[].
  it("loadHistoryMessages clears streamingMessageId so the next prompt isn't lost", () => {
    useSessionStore.getState().setSession("sess-X");
    // Simulate the SSE-replay race: a streaming bubble was created during
    // piLoadSession but loadHistoryMessages is about to replace messages[].
    useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("partial");
    expect(useSessionStore.getState().streamingMessageId).not.toBeNull();
    // Load the projection.
    useSessionStore.getState().loadHistoryMessages("sess-X", [
      { id: "u1", role: "user", parts: [{ kind: "text", text: "你是谁" }], complete: true },
      {
        id: "a1",
        role: "assistant",
        parts: [{ kind: "text", text: "我是 Pi" }],
        complete: true,
      },
    ]);
    // streamingMessageId must be cleared — otherwise the next prompt's deltas
    // would silently disappear into a stale row pointer.
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
    expect(useSessionStore.getState().streamState.message).toBeNull();
  });

  it("loadHistoryMessages is a no-op when the focused session doesn't match", () => {
    useSessionStore.getState().setSession("focused-sess");
    useSessionStore.getState().beginStreamingMessage();
    const beforeMessages = useSessionStore.getState().messages;
    useSessionStore.getState().loadHistoryMessages("different-sess", [
      { id: "u1", role: "user", parts: [{ kind: "text", text: "x" }], complete: true },
    ]);
    // Stale fetches from rapid sidebar clicks must not clobber the focused
    // session's transcript.
    expect(useSessionStore.getState().messages).toBe(beforeMessages);
    expect(useSessionStore.getState().streamingMessageId).not.toBeNull();
  });

  // Phase R3.0 — pendingSessionIds lifecycle.
  describe("pendingSessionIds (R3.0)", () => {
    it("markPending adds an id and isPending returns true", () => {
      const { markPending, isPending } = useSessionStore.getState();
      markPending("__pending_abc");
      expect(isPending("__pending_abc")).toBe(true);
      expect(useSessionStore.getState().pendingSessionIds.has("__pending_abc")).toBe(true);
    });

    it("markPending is idempotent", () => {
      const { markPending } = useSessionStore.getState();
      markPending("__pending_abc");
      const first = useSessionStore.getState().pendingSessionIds;
      markPending("__pending_abc");
      // Same set reference on the second call → no needless re-renders.
      expect(useSessionStore.getState().pendingSessionIds).toBe(first);
    });

    it("markResolved drops the id without touching the focused session when no realId is given", () => {
      useSessionStore.getState().setSession("focused-real");
      useSessionStore.getState().markPending("__pending_x");
      useSessionStore.getState().markResolved("__pending_x");
      expect(useSessionStore.getState().isPending("__pending_x")).toBe(false);
      expect(useSessionStore.getState().sessionId).toBe("focused-real");
    });

    it("markResolved migrates the focused session when the pending id matches", () => {
      useSessionStore.getState().setSession("__pending_y");
      useSessionStore.getState().markPending("__pending_y");
      useSessionStore.getState().markResolved("__pending_y", "real_42");
      expect(useSessionStore.getState().sessionId).toBe("real_42");
      expect(useSessionStore.getState().isPending("__pending_y")).toBe(false);
    });

    it("reset clears all pending ids", () => {
      useSessionStore.getState().markPending("__pending_a");
      useSessionStore.getState().markPending("__pending_b");
      useSessionStore.getState().reset();
      expect(useSessionStore.getState().pendingSessionIds.size).toBe(0);
    });

    it("markResolved is a no-op for ids that were never pending", () => {
      const before = useSessionStore.getState().pendingSessionIds;
      useSessionStore.getState().markResolved("never-pending");
      expect(useSessionStore.getState().pendingSessionIds).toBe(before);
    });
  });
});