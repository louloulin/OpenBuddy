/**
 * session-store-edit-assistant.test.ts — R78 (assistant inline edit)
 *
 * Verifies the contract of `editAssistantMessage`:
 *   - replaces all text parts with a single new markdown blob
 *   - preserves non-text parts (tool_call, thought, file)
 *   - no-op on missing id
 *   - no-op on user messages (which go through appendUserRevision)
 *   - works on assistant messages mid-streaming too
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useSessionStore } from "../session-store";

function seedAssistantWithMixedParts(): string {
  const id = useSessionStore.getState().beginStreamingMessage();
  // appendStreamingDelta(delta, kind) 是 string-based,tool_call 通过 setState 手动入。
  useSessionStore.setState((s) => ({
    messages: s.messages.map((m) =>
      m.id === id
        ? {
            ...m,
            parts: [
              { kind: "tool_call", toolCallId: "t1", title: "ls", toolKind: "shell", status: "ok" } as never,
            ],
          }
        : m,
    ),
  }));
  useSessionStore.getState().appendStreamingDelta("first text\n", "text");
  useSessionStore.getState().appendStreamingDelta("thinking...", "thought");
  useSessionStore.getState().appendStreamingDelta("second text", "text");
  useSessionStore.getState().finishStreamingMessage();
  return id;
}

beforeEach(() => {
  useSessionStore.getState().reset();
});

describe("R78 — editAssistantMessage", () => {
  it("replaces all text parts with a single new markdown blob", () => {
    const id = seedAssistantWithMixedParts();
    useSessionStore.getState().editAssistantMessage(id, "merged answer");
    const m = useSessionStore.getState().messages.find((x) => x.id === id);
    expect(m).toBeDefined();
    const texts = (m!.parts as Array<{ kind: string; text?: string }>).filter((p) => p.kind === "text");
    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe("merged answer");
  });

  it("preserves non-text parts (tool_call, thought, file)", () => {
    const id = seedAssistantWithMixedParts();
    useSessionStore.getState().editAssistantMessage(id, "merged answer");
    const m = useSessionStore.getState().messages.find((x) => x.id === id);
    const kinds = (m!.parts as Array<{ kind: string }>).map((p) => p.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("thought");
    // 多 text 已被合并
    expect(kinds.filter((k) => k === "text").length).toBe(1);
  });

  it("no-op on missing id", () => {
    seedAssistantWithMixedParts();
    const before = useSessionStore.getState().messages.length;
    useSessionStore.getState().editAssistantMessage("does-not-exist", "ghost");
    expect(useSessionStore.getState().messages.length).toBe(before);
  });

  it("no-op on user messages (those go through appendUserRevision)", () => {
    const userId = useSessionStore.getState().pushOptimisticUser("hi");
    useSessionStore.setState((s) => ({
      optimisticBubble: null,
      messages: s.messages.map((m) => (m.id === userId ? { ...m, complete: true } : m)),
    }));
    const before = useSessionStore.getState().messages.find((m) => m.id === userId)!.parts;
    useSessionStore.getState().editAssistantMessage(userId, "should be ignored");
    const after = useSessionStore.getState().messages.find((m) => m.id === userId)!.parts;
    expect(after).toEqual(before);
  });

  it("works while assistant is still streaming (no complete flag required)", () => {
    const id = useSessionStore.getState().beginStreamingMessage();
    // 注意签名:appendStreamingDelta(delta: string, kind?: "text" | "thought")。
    // R78 写这行时传了 `{ kind, text }` 对象 —— 类型是错的(vitest 不做类型
    // 检查所以一直没暴露),运行时对象被拼成 "[object Object]" 混进正文。
    useSessionStore.getState().appendStreamingDelta("drafting", "text");
    // 不 finishStreamingMessage —— message.complete 仍是 false
    useSessionStore.getState().editAssistantMessage(id, "rewritten mid-stream");
    const m = useSessionStore.getState().messages.find((x) => x.id === id);
    const texts = (m!.parts as Array<{ kind: string; text?: string }>).filter((p) => p.kind === "text");
    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe("rewritten mid-stream");
  });
});
