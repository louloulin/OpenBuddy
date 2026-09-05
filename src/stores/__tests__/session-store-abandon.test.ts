/**
 * session-store-abandon.test.ts — guards for the orphan-LoadingRow cleanup
 * that fixed the "半天没返回" symptom (a session stuck on "等待模型响应"
 * for 8+ hours after the backend had already finished the turn).
 *
 * Without these guards, every error / cancel path would silently leave the
 * in-flight assistant message with `complete: false, parts: []` because
 * `finishStreamingMessage` requires `streamingMessageId` to match a row
 * in the mirror — and `streamingMessageId` was cleared by the time the
 * finalize handler ran.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useSessionStore } from "../session-store";

beforeEach(() => {
  // Reset to the empty initial state between tests so streamingMessageId /
  // messages from a previous case don't leak across.
  useSessionStore.getState().reset();
  // Force-clear any leftover rAF from appendStreamingDelta in earlier tests.
  // requestAnimationFrame is auto-advanced in vitest, but to keep these
  // tests deterministic we only exercise the sync actions.
});

describe("finishStreamingMessage — robust against orphan bubbles", () => {
  it("marks the streaming message complete when streamingMessageId matches", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("hello");
    useSessionStore.getState().finishStreamingMessage();
    const msgs = useSessionStore.getState().messages;
    const target = msgs.find((m) => m.id === id);
    expect(target?.complete).toBe(true);
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });

  it("still force-finalises the trailing incomplete assistant when streamingMessageId is null", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    // Simulate the cancel / setSession / error path that nulls the id but
    // leaves the empty bubble in the mirror.
    useSessionStore.setState({ streamingMessageId: null });
    useSessionStore.getState().finishStreamingMessage();
    const msgs = useSessionStore.getState().messages;
    const target = msgs.find((m) => m.id === id);
    expect(target?.complete).toBe(true);
  });

  it("is a safe no-op when no assistant bubble exists", () => {
    useSessionStore.getState().finishStreamingMessage();
    expect(useSessionStore.getState().messages).toHaveLength(0);
  });
});

describe("abandonStreamingMessage — error-path finaliser", () => {
  it("marks the streaming bubble complete and stamps the reason when parts are empty", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().abandonStreamingMessage("agent-died");
    const msgs = useSessionStore.getState().messages;
    const target = msgs.find((m) => m.id === id);
    expect(target?.complete).toBe(true);
    expect(target?.parts).toHaveLength(1);
    expect(target?.parts[0]).toMatchObject({ kind: "text" });
    expect((target?.parts[0] as { text: string }).text).toContain("agent-died");
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });

  it("preserves any partial deltas that already streamed", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    // Synchronous flush so the append lands before abandon reads state.
    useSessionStore.setState((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? { ...m, parts: [{ kind: "text", text: "partial response…" }] }
          : m,
      ),
    }));
    useSessionStore.getState().abandonStreamingMessage("watchdog 60s");
    const msgs = useSessionStore.getState().messages;
    const target = msgs.find((m) => m.id === id);
    expect(target?.complete).toBe(true);
    // No placeholder added — the streamed content is kept verbatim.
    expect(target?.parts).toEqual([
      { kind: "text", text: "partial response…" },
    ]);
  });

  it("finalises the trailing incomplete bubble even after streamingMessageId was cleared", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    useSessionStore.setState({ streamingMessageId: null });
    useSessionStore.getState().abandonStreamingMessage("turn-error");
    const target = useSessionStore
      .getState()
      .messages.find((m) => m.id === id);
    expect(target?.complete).toBe(true);
  });

  it("is idempotent when no streaming message exists", () => {
    const before = useSessionStore.getState().messages.length;
    useSessionStore.getState().abandonStreamingMessage("noop");
    const after = useSessionStore.getState().messages.length;
    expect(after).toBe(before);
  });
});

describe("loadHistoryMessages — orphan sweep", () => {
  it("force-finalises a trailing incomplete assistant with no content from history", () => {
    useSessionStore.getState().setSession("orphan-sess");
    useSessionStore.getState().loadHistoryMessages("orphan-sess", [
      {
        id: "u1",
        role: "user",
        parts: [{ kind: "text", text: "你是谁" }],
        complete: true,
      },
      // Pi's JSONL persisted this row but the agent never sent message_end
      // for it — the bug from the "半天没返回" symptom.
      {
        id: "a1",
        role: "assistant",
        parts: [],
        complete: false,
      },
    ]);
    const msgs = useSessionStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].complete).toBe(true);
    expect(msgs[1].parts).toHaveLength(1);
    expect((msgs[1].parts[0] as { text: string }).text).toMatch(
      /未完成|中断|收尾/,
    );
  });

  it("leaves earlier turns alone — only the trailing assistant is swept", () => {
    useSessionStore.getState().setSession("orphan-sess-2");
    useSessionStore.getState().loadHistoryMessages("orphan-sess-2", [
      {
        id: "u1",
        role: "user",
        parts: [{ kind: "text", text: "第一问" }],
        complete: true,
      },
      // Earlier complete turn — must NOT be touched.
      {
        id: "a1",
        role: "assistant",
        parts: [{ kind: "text", text: "首答" }],
        complete: true,
      },
      {
        id: "u2",
        role: "user",
        parts: [{ kind: "text", text: "第二问" }],
        complete: true,
      },
      // Trailing orphan.
      {
        id: "a2",
        role: "assistant",
        parts: [],
        complete: false,
      },
    ]);
    const msgs = useSessionStore.getState().messages;
    expect(msgs[1].complete).toBe(true);
    expect(msgs[1].parts).toEqual([{ kind: "text", text: "首答" }]);
    expect(msgs[3].complete).toBe(true);
  });

  it("leaves a trailing complete assistant alone (happy path)", () => {
    useSessionStore.getState().setSession("happy-sess");
    useSessionStore.getState().loadHistoryMessages("happy-sess", [
      {
        id: "u1",
        role: "user",
        parts: [{ kind: "text", text: "hi" }],
        complete: true,
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ kind: "text", text: "hello!" }],
        complete: true,
      },
    ]);
    const msgs = useSessionStore.getState().messages;
    expect(msgs[1].parts).toEqual([{ kind: "text", text: "hello!" }]);
  });

  it("is a no-op for empty history arrays", () => {
    useSessionStore.getState().setSession("empty-sess");
    useSessionStore.getState().loadHistoryMessages("empty-sess", []);
    expect(useSessionStore.getState().messages).toHaveLength(0);
  });
});