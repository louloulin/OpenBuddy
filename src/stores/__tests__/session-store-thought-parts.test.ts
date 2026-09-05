/**
 * Reasoning deltas must land in a `thought` part, never in the answer body.
 *
 * `appendStreamingDelta` used to take only a delta string and always merged it
 * into the assistant message's `text` part. But reasoning and answer text
 * arrive on two different renderer channels — `agent_thought_chunk` and
 * `agent_message_chunk` — and `useAgentSession.ts` fed both into that single
 * kind-blind call. The consequence for any reasoning model was that the chain
 * of thought was concatenated straight into the visible answer.
 *
 * The rendering side was already correct and waiting: `session-store.ts` models
 * a `{ kind: "thought"; text: string }` part, and `MessageItem.tsx:169-175`
 * renders it as a collapsible `<details class="msg__thought">深度思考</details>`.
 * Only the streaming path never produced the part.
 *
 * These tests pin three properties:
 *   1. a thought delta creates a `thought` part, not a `text` part;
 *   2. same-kind deltas merge, so a block stays one part;
 *   3. a kind switch opens a new part and preserves arrival order — which is
 *      what makes "reason, answer, reason again" render as three blocks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../session-store";

/** Deltas coalesce per animation frame — wait one before asserting. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resetStore(): void {
  useSessionStore.setState({
    sessionId: "s-thought",
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
    messages: [],
    streamingMessageId: null,
  });
}

/** Parts of the message currently being streamed, as `[kind, text]` pairs. */
function streamingParts(): Array<[string, string]> {
  const state = useSessionStore.getState();
  const message = state.messages.find((m) => m.id === state.streamingMessageId);
  return (message?.parts ?? []).map((p) => [
    p.kind,
    (p as { text?: string }).text ?? "",
  ]);
}

describe("session-store — reasoning is a separate part", () => {
  beforeEach(resetStore);

  it("routes a thought delta into a thought part instead of the answer body", async () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("weighing the options", "thought");
    await nextFrame();

    expect(streamingParts()).toEqual([["thought", "weighing the options"]]);
  });

  it("defaults to the text part when no kind is passed (answer body)", async () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("the answer");
    await nextFrame();

    expect(streamingParts()).toEqual([["text", "the answer"]]);
  });

  it("merges consecutive same-kind deltas into one part", async () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("first ", "thought");
    store.appendStreamingDelta("second", "thought");
    await nextFrame();

    expect(streamingParts()).toEqual([["thought", "first second"]]);
  });

  /**
   * The ordering property. A kind switch flushes the buffered run before
   * starting the next part; without that flush the two kinds would be
   * concatenated into whichever part happened to be open.
   */
  it("opens a new part on a kind switch and keeps arrival order", async () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("thinking hard", "thought");
    store.appendStreamingDelta("here is the answer", "text");
    store.appendStreamingDelta(" — reconsidering", "thought");
    await nextFrame();

    expect(streamingParts()).toEqual([
      ["thought", "thinking hard"],
      ["text", "here is the answer"],
      ["thought", " — reconsidering"],
    ]);
  });

  it("finishStreamingMessage flushes a pending thought without losing it", () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("unflushed reasoning", "thought");
    // No frame wait: finish must flush synchronously.
    store.finishStreamingMessage();

    const message = useSessionStore.getState().messages.at(-1);
    expect(message?.complete).toBe(true);
    expect((message?.parts ?? []).map((p) => [p.kind, (p as { text?: string }).text])).toEqual([
      ["thought", "unflushed reasoning"],
    ]);
  });

  it("resets to text kind across turns so a new turn cannot open as a thought", async () => {
    const store = useSessionStore.getState();
    store.beginStreamingMessage();
    store.appendStreamingDelta("reasoning", "thought");
    store.finishStreamingMessage();

    // Second turn, answer-only.
    useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("plain answer");
    await nextFrame();

    expect(streamingParts()).toEqual([["text", "plain answer"]]);
  });
});
