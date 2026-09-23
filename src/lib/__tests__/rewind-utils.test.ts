/**
 * rewind-utils.test.ts — Plan5 B.10
 *
 * 纯函数,不 import 任何 IPC —— 与 `useChatViewRewind` 的副作用层解耦。
 */
import { describe, expect, it } from "vitest";
import { buildPromptIndexMap, userTextForPromptIndex } from "../ui/rewind-utils";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";

function user(id: string, text = id): ChatMessage {
  return { id, role: "user", parts: [{ kind: "text", text }], complete: true };
}
function assistant(id: string): ChatMessage {
  return { id, role: "assistant", parts: [{ kind: "text", text: id }], complete: true };
}

describe("buildPromptIndexMap", () => {
  it("maps each assistant message to the ordinal of its preceding user prompt", () => {
    const messages = [user("u0"), assistant("a0"), user("u1"), assistant("a1")];
    const map = buildPromptIndexMap(messages, new Set([0, 1]));
    expect(map.get("a0")).toBe(0);
    expect(map.get("a1")).toBe(1);
    expect(map.has("u0")).toBe(false);
  });

  it("counts optimistic user bubbles that are not yet persisted", () => {
    const messages = [user("optimistic-1"), assistant("a0")];
    const map = buildPromptIndexMap(messages, new Set([0]));
    expect(map.get("a0")).toBe(0);
  });

  it("omits assistant messages whose ordinal is not a known rewind point", () => {
    const messages = [user("u0"), assistant("a0"), user("u1"), assistant("a1")];
    const map = buildPromptIndexMap(messages, new Set([0]));
    expect(map.get("a0")).toBe(0);
    expect(map.has("a1")).toBe(false);
  });

  it("skips an assistant message that appears before any user message", () => {
    const messages = [assistant("a0"), user("u0"), assistant("a1")];
    const map = buildPromptIndexMap(messages, new Set([0]));
    expect(map.has("a0")).toBe(false);
    expect(map.get("a1")).toBe(0);
  });

  it("returns an empty map when no rewind points are valid", () => {
    const messages = [user("u0"), assistant("a0")];
    expect(buildPromptIndexMap(messages, new Set()).size).toBe(0);
  });
});

describe("userTextForPromptIndex", () => {
  it("returns the text of the nth user prompt", () => {
    const messages = [user("u0", "first"), assistant("a0"), user("u1", "second"), assistant("a1")];
    expect(userTextForPromptIndex(messages, 0)).toBe("first");
    expect(userTextForPromptIndex(messages, 1)).toBe("second");
  });

  it("joins multiple text parts with a newline", () => {
    const multi: ChatMessage = {
      id: "u0",
      role: "user",
      parts: [
        { kind: "text", text: "line one" },
        { kind: "text", text: "line two" },
      ],
      complete: true,
    };
    expect(userTextForPromptIndex([multi], 0)).toBe("line one\nline two");
  });

  it("returns an empty string for an out-of-range index", () => {
    expect(userTextForPromptIndex([user("u0")], 5)).toBe("");
  });
});
