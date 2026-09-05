import { describe, it, expect } from "vitest";
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
  deltaFromTextChunk,
  deltaFromThoughtChunk,
  appendPartFromToolCall,
  updatePartFromToolCallDelta,
  type StreamingState,
  type StreamAction,
} from "../streaming-message";

/** Drive the reducer through a fixed action list — used by every describe
 *  block below, so we keep it as a tiny helper instead of repeating
 *  `.reduce((acc, a) => streamReducer(acc, a), initial)`. */
function reduce(initial: StreamingState, actions: StreamAction[]): StreamingState {
  return actions.reduce((acc, a) => streamReducer(acc, a), initial);
}

describe("streamReducer", () => {
  it("starts an empty message on 'start'", () => {
    const next = streamReducer(INITIAL_STREAMING_STATE, { type: "start", id: "m1" });
    expect(next.message?.id).toBe("m1");
    expect(next.message?.parts).toEqual([]);
    expect(next.message?.complete).toBe(false);
    expect(next.message?.revision).toBe(0);
  });

  it("merges consecutive text deltas into a single trailing part", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "hello", part: "text" },
      { type: "delta", text: " world", part: "text" },
    ]);
    expect(next.message?.parts.length).toBe(1);
    expect(next.message?.parts[0]).toEqual({ kind: "text", text: "hello world" });
  });

  it("separates text and thought deltas into two parts", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "thinking", part: "thought" },
      { type: "delta", text: "answer", part: "text" },
    ]);
    expect(next.message?.parts.length).toBe(2);
    expect(next.message?.parts[0]).toEqual({ kind: "thought", text: "thinking" });
    expect(next.message?.parts[1]).toEqual({ kind: "text", text: "answer" });
  });

  it("delta is a no-op after 'end'", () => {
    let s: StreamingState = streamReducer(INITIAL_STREAMING_STATE, { type: "start", id: "m1" });
    s = streamReducer(s, { type: "delta", text: "abc", part: "text" });
    s = streamReducer(s, { type: "end" });
    const before = s.message?.parts[0];
    s = streamReducer(s, { type: "delta", text: "xyz", part: "text" });
    expect(s.message?.parts[0]).toBe(before);
    expect(s.message?.complete).toBe(true);
  });

  it("appends a tool_call part", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "see below", part: "text" },
      {
        type: "appendPart",
        part: {
          kind: "tool_call",
          toolCallId: "t1",
          title: "read",
          toolKind: "read_file",
          status: "in_progress",
          content: [],
          partial: true,
        },
      },
    ]);
    expect(next.message?.parts.length).toBe(2);
    expect(next.message?.parts[1]).toMatchObject({
      kind: "tool_call",
      toolCallId: "t1",
      status: "in_progress",
    });
  });

  it("updates a tool_call part by id", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "see below", part: "text" },
      {
        type: "appendPart",
        part: {
          kind: "tool_call",
          toolCallId: "t1",
          title: "read",
          toolKind: "read_file",
          status: "in_progress",
          content: [],
          partial: true,
        },
      },
      {
        type: "updatePart",
        toolCallId: "t1",
        patch: { kind: "tool_call", status: "completed", partial: false },
      },
    ]);
    const lastPart = next.message?.parts[1];
    if (!lastPart || lastPart.kind !== "tool_call") throw new Error("expected tool_call part");
    expect(lastPart.status).toBe("completed");
    expect(lastPart.partial).toBe(false);
  });

  it("'updatePart' is a no-op for unknown toolCallId", () => {
    const setup = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      {
        type: "appendPart",
        part: {
          kind: "tool_call",
          toolCallId: "t1",
          title: "read",
          toolKind: "read_file",
          status: "in_progress",
          content: [],
          partial: true,
        },
      },
    ]);
    const same = streamReducer(setup, {
      type: "updatePart",
      toolCallId: "t-does-not-exist",
      patch: { kind: "tool_call", status: "completed" },
    });
    expect(same).toBe(setup);
  });

  it("'reset' clears the streaming state", () => {
    let s: StreamingState = streamReducer(INITIAL_STREAMING_STATE, { type: "start", id: "m1" });
    s = streamReducer(s, { type: "usage", usage: { promptTokens: 10, completionTokens: 5 } });
    s = streamReducer(s, { type: "reset" });
    expect(s.message).toBeNull();
    expect(s.lastUsage).toBeUndefined();
  });

  it("'end' is idempotent", () => {
    const setup = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "x", part: "text" },
    ]);
    const first = streamReducer(setup, { type: "end" });
    const second = streamReducer(first, { type: "end" });
    expect(first).toBe(second);
  });

  it("bump revision on every mutation so memo equality is cheap", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "start", id: "m1" },
      { type: "delta", text: "a", part: "text" },
      { type: "delta", text: "b", part: "text" },
      { type: "end" },
    ]);
    expect(next.message?.revision).toBe(3);
  });

  it("usage accumulates, not overwrites", () => {
    const next = reduce(INITIAL_STREAMING_STATE, [
      { type: "usage", usage: { promptTokens: 10 } },
      { type: "usage", usage: { completionTokens: 5 } },
    ]);
    expect(next.lastUsage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });
});

describe("wire adapters", () => {
  it("deltaFromTextChunk concatenates text blocks", () => {
    const a = deltaFromTextChunk({
      type: "agent_message_chunk",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ],
    });
    expect(a).toEqual({ type: "delta", text: "hello world", part: "text" });
  });

  it("deltaFromTextChunk returns null on empty content", () => {
    expect(deltaFromTextChunk({ type: "agent_message_chunk", content: [] })).toBeNull();
  });

  it("deltaFromThoughtChunk routes to thought deltas", () => {
    const a = deltaFromThoughtChunk({
      type: "agent_thought_chunk",
      content: [{ type: "thought", text: "hmm" }],
    });
    expect(a).toEqual({ type: "delta", text: "hmm", part: "thought" });
  });

  it("appendPartFromToolCall mirrors partial flag from status", () => {
    const a = appendPartFromToolCall({
      type: "tool_call",
      toolCallId: "t1",
      title: "read",
      kind: "read_file",
      status: "in_progress",
      content: [],
      rawInput: { path: "a" },
    });
    expect(a).toMatchObject({
      type: "appendPart",
      part: { kind: "tool_call", toolCallId: "t1", partial: true, rawInput: { path: "a" } },
    });
  });

  it("updatePartFromToolCallDelta forwards known patch fields and drops unknown", () => {
    const a = updatePartFromToolCallDelta({
      type: "tool_call_update",
      toolCallId: "t1",
      update: { status: "completed", partial: false, extraUnknown: 1 },
    });
    expect(a).toEqual({
      type: "updatePart",
      toolCallId: "t1",
      patch: { kind: "tool_call", status: "completed", partial: false },
    });
  });
});

describe("1000-delta stress", () => {
  it("1000 text deltas coalesce into a single trailing part", () => {
    const actions: StreamAction[] = [{ type: "start", id: "m1" }];
    for (let i = 0; i < 1000; i++) actions.push({ type: "delta", text: "x", part: "text" });
    const next = reduce(INITIAL_STREAMING_STATE, actions);
    expect(next.message?.parts.length).toBe(1);
    const head = next.message?.parts[0];
    if (!head || head.kind !== "text") throw new Error("expected text part");
    expect(head.text.length).toBe(1000);
    expect(next.message?.revision).toBe(1000);
  });
});
