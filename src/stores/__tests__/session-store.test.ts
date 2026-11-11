import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../session-store";

const emit = (event: Record<string, unknown>, sessionId = "A") =>
  useSessionStore.getState().applyUpdate({ ...event, type: String(event.type), sessionId });
const text = () => useSessionStore.getState().messages.flatMap(m => m.parts).filter(p => p.kind === "text").map(p => p.kind === "text" ? p.text : "").join("");

beforeEach(() => {
  useSessionStore.setState({ sessionId: null, transcripts: {}, messages: [], streaming: false, streamingMessageId: null, usage: {}, plan: null, error: null });
  useSessionStore.getState().setSession("A");
});

describe("Pi transcript events", () => {
  it("merges deltas by contentIndex and replaces final content without duplication", () => {
    useSessionStore.getState().startStreaming();
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "second" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "first" } });
    expect(text()).toBe("firstsecond");
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final" }] } });
    expect(text()).toBe("final");
    expect(useSessionStore.getState().streaming).toBe(true);
    emit({ type: "agent_end" });
    expect(useSessionStore.getState().streaming).toBe(true);
    emit({ type: "agent_settled" });
    expect(useSessionStore.getState().streaming).toBe(false);
  });

  it("does not route late events into the newly selected session", () => {
    useSessionStore.getState().setSession("B");
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "old" }] } }, "A");
    expect(text()).toBe("");
  });

  it("replays distinct user and assistant messages and suppresses cached replay", () => {
    emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "question" }] } });
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } });
    emit({ type: "agent_settled" });
    expect(useSessionStore.getState().messages.map(m => m.role)).toEqual(["user", "assistant"]);
    useSessionStore.getState().setSession("B");
    useSessionStore.getState().setSession("A");
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } });
    expect(useSessionStore.getState().messages).toHaveLength(2);
  });

  it("overwrites thinking and toolcall end snapshots at their content indices", () => {
    useSessionStore.getState().startStreaming();
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "draft" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "final reasoning" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: { type: "toolCall", id: "tc", name: "read", arguments: { path: "a.ts" } } } });
    const parts = useSessionStore.getState().messages[0].parts;
    expect(parts[0]).toMatchObject({ kind: "thought", text: "final reasoning" });
    expect(parts[1]).toMatchObject({ kind: "tool_call", toolCall: { toolCallId: "tc", rawInput: { path: "a.ts" } } });
  });

  it("clears busy on cancellation and errors without dropping streamed content", () => {
    useSessionStore.getState().startStreaming();
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "kept" } });
    useSessionStore.getState().stopStreaming();
    expect(useSessionStore.getState().streaming).toBe(false);
    expect(text()).toBe("kept");
    useSessionStore.getState().startStreaming();
    useSessionStore.getState().setError("network error");
    expect(useSessionStore.getState().streaming).toBe(false);
    expect(useSessionStore.getState().messages).toHaveLength(1);
  });

  it("does not accept an event without a session identity", () => {
    useSessionStore.getState().applyUpdate({ type: "message_end", message: { role: "assistant", content: "unattributed" } });
    expect(text()).toBe("");
  });

  it("updates a tool card with the complete execution result", () => {
    useSessionStore.getState().startStreaming();
    emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "pwd" } });
    emit({ type: "tool_execution_update", toolCallId: "t1", toolName: "bash", partialResult: { content: [{ type: "text", text: "part" }] } });
    emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "/workspace" }] }, isError: false });
    const card = useSessionStore.getState().messages.flatMap(m => m.parts).find(p => p.kind === "tool_call");
    expect(card?.kind === "tool_call" && card.toolCall).toMatchObject({ status: "completed", content: [{ type: "text", text: "/workspace" }] });
  });
});
