import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/features/chat/state/session-store";

const S = "batch-s";
const delta = (text: string) => ({ type: "message_update", sessionId: S, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });

describe("streaming store (U0)", () => {
  afterEach(() => { vi.useRealTimers(); useSessionStore.getState().dropSessionCache(S); });

  it("applies queued events together in one store update per frame", () => {
    vi.useFakeTimers();
    const store = useSessionStore.getState();
    store.setSession(S);
    store.startStreaming(S);
    const listener = vi.fn();
    const off = useSessionStore.subscribe(listener);
    for (let i = 0; i < 50; i++) store.queueUpdate(delta("字"));
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(listener).toHaveBeenCalledTimes(1);
    const parts = useSessionStore.getState().messages.at(-1)!.parts;
    expect(parts[0]).toMatchObject({ kind: "text", text: "字".repeat(50) });
    off();
  });

  it("flushes queued events before a direct action so a late delta cannot reopen a finished turn", () => {
    vi.useFakeTimers();
    const store = useSessionStore.getState();
    store.setSession(S);
    store.startStreaming(S);
    store.queueUpdate(delta("尾巴"));
    store.stopStreaming(S);
    vi.advanceTimersByTime(60);
    const state = useSessionStore.getState();
    expect(state.streaming).toBe(false);
    expect(state.messages.at(-1)!.parts[0]).toMatchObject({ text: "尾巴" });
  });

  it("keeps untouched messages identical and ignores deltas that show nothing", () => {
    const store = useSessionStore.getState();
    store.setSession(S);
    store.pushUser("第一问", undefined, S);
    store.startStreaming(S);
    store.applyUpdate(delta("答"));
    const before = useSessionStore.getState().messages;
    store.applyUpdate({ type: "message_update", sessionId: S, assistantMessageEvent: { type: "done", contentIndex: 5 } as never });
    store.applyUpdate({ type: "turn_start", sessionId: S });
    expect(useSessionStore.getState().messages).toBe(before);
    store.applyUpdate(delta("案"));
    const after = useSessionStore.getState().messages;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
  });

  it("shows the path and argument progress from a slim toolcall_delta, and patches only the tool's message", () => {
    const store = useSessionStore.getState();
    store.setSession(S);
    store.pushUser("写个文件", undefined, S);
    store.startStreaming(S);
    store.applyUpdate({ type: "message_update", sessionId: S, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, toolCall: { type: "toolCall", id: "t1", name: "write", arguments: {} } } as never });
    store.applyUpdate({ type: "message_update", sessionId: S, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, partialArgs: { path: "docs/a.md" }, bytes: 4096 } });
    const tool = useSessionStore.getState().messages.at(-1)!.parts[0];
    expect(tool.kind === "tool_call" && tool.toolCall).toMatchObject({ rawInput: { path: "docs/a.md" }, argBytes: 4096 });
    const user = useSessionStore.getState().messages[0];
    store.applyUpdate({ type: "tool_execution_update", sessionId: S, toolCallId: "t1", toolName: "write", partialResult: { content: [{ type: "text", text: "..." }] } });
    expect(useSessionStore.getState().messages[0]).toBe(user);
  });
});
