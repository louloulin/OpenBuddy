/**
 * R1.4 — unit tests for the restored transcript mirror actions.
 *
 * Phase 4 deleted `messages` / `streamingMessageId` and the streaming reducer;
 * this is the bare minimum test coverage for the restored actions so future
 * refactors don't silently re-break ChatView.
 *
 * Phase 8.2.6 removed the dead `setMessages` / `appendMessage` actions, so
 * their tests are gone. The fields (`messages`, `streamingMessageId`) and
 * streaming reducers (`beginStreamingMessage`, `appendStreamingDelta`,
 * `finishStreamingMessage`) are still covered here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../session-store";

/** C2 合帧:appendStreamingDelta 按 rAF 批量落账,测试等一帧再断言。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resetStore(): void {
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
    messages: [],
    streamingMessageId: null,
  });
}

describe("session-store R1.4 — transcript actions", () => {
  beforeEach(resetStore);

  it("initial state has empty messages array (so timeline.length === 0 renders empty-state)", () => {
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });

  it("setSession clears messages (replay boundary)", () => {
    useSessionStore.setState({ messages: [{ id: "x", role: "user", parts: [], complete: true }] });
    useSessionStore.getState().setSession("s1");
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(useSessionStore.getState().sessionId).toBe("s1");
  });

  it("beginStreamingMessage creates an empty assistant message and tracks its id", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    expect(id).toMatch(/^m\d+_/);
    expect(useSessionStore.getState().streamingMessageId).toBe(id);
    const last = useSessionStore.getState().messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.complete).toBe(false);
    expect(last?.parts).toEqual([]);
  });

  it("appendStreamingDelta merges into the last text part when one exists", async () => {
    useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("hello ");
    useSessionStore.getState().appendStreamingDelta("world");
    await nextFrame();
    const last = useSessionStore.getState().messages.at(-1);
    expect(last?.parts).toEqual([{ kind: "text", text: "hello world" }]);
  });

  it("deltas coalesce into one store update per frame (C2)", async () => {
    useSessionStore.getState().beginStreamingMessage();
    for (const chunk of ["a", "b", "c", "d", "e"]) {
      useSessionStore.getState().appendStreamingDelta(chunk);
    }
    // 帧回调前状态不动——这就是"按帧合并"的契约。
    expect(useSessionStore.getState().messages.at(-1)?.parts).toEqual([]);
    await nextFrame();
    expect(useSessionStore.getState().messages.at(-1)?.parts).toEqual([
      { kind: "text", text: "abcde" },
    ]);
  });

  it("appendStreamingDelta creates a new part when the last part is not text", async () => {
    useSessionStore.getState().beginStreamingMessage();
    // Manually inject a tool_call as the last part.
    useSessionStore.setState((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId
          ? { ...m, parts: [...m.parts, { kind: "tool_call", toolCall: { toolCallId: "tc-1", title: "bash", kind: "bash", status: "in_progress", content: [] } }] }
          : m,
      ),
    }));
    useSessionStore.getState().appendStreamingDelta("continuing text");
    await nextFrame();
    const last = useSessionStore.getState().messages.at(-1);
    expect(last?.parts).toHaveLength(2);
    expect(last?.parts[1]).toEqual({ kind: "text", text: "continuing text" });
  });

  it("appendStreamingDelta is a no-op when no streaming message is active", () => {
    useSessionStore.getState().appendStreamingDelta("hello");
    expect(useSessionStore.getState().messages).toEqual([]);
  });

  it("finishStreamingMessage flushes buffered deltas before completing (no text loss)", () => {
    useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("hi");
    // 不等帧,直接 finish —— 同步 flush 必须先落账再标记完成。
    useSessionStore.getState().finishStreamingMessage();
    const last = useSessionStore.getState().messages.at(-1);
    expect(last?.complete).toBe(true);
    expect(last?.parts).toEqual([{ kind: "text", text: "hi" }]);
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });

  it("finishStreamingMessage is a safe no-op when no streaming message is active", () => {
    useSessionStore.getState().finishStreamingMessage();
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });

  it("reset clears messages too", () => {
    useSessionStore.getState().setSession("s1");
    useSessionStore.setState({ messages: [{ id: "m", role: "user", parts: [], complete: true }] });
    useSessionStore.getState().reset();
    expect(useSessionStore.getState().messages).toEqual([]);
    expect(useSessionStore.getState().streamingMessageId).toBeNull();
  });
});
