import { describe, expect, it } from "vitest";
import { messagesEqual } from "./ChatView";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";

function msg(id: string, text: string): ChatMessage {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text }],
    complete: true,
    createdAt: 0,
  } as unknown as ChatMessage;
}

describe("messagesEqual", () => {
  it("short-circuits on reference identity", () => {
    const a = [msg("a", "x")];
    expect(messagesEqual(a, a)).toBe(true);
  });

  it("treats an equal-content rebuild as changed (identity is the contract)", () => {
    // MessageItem memoizes on `prev.message === next.message`, so a rebuilt
    // object with identical content must count as a change.
    expect(messagesEqual([msg("a", "x")], [msg("a", "x")])).toBe(false);
  });

  it("detects a length change", () => {
    expect(messagesEqual([msg("a", "x")], [msg("a", "x"), msg("b", "y")])).toBe(false);
  });

  it("treats two empty lists as equal", () => {
    expect(messagesEqual([], [])).toBe(true);
  });

  // This is the regression the tail-only comparator could not catch: the
  // revision pager rewrites a USER message in the middle of the transcript.
  // Length is unchanged and the tail (the assistant reply) is the same
  // object, so the old comparator answered "unchanged" and the edit never
  // reached the screen.
  it("detects an edit to a message in the middle of the list", () => {
    const user = msg("u1", "original");
    const tail = msg("a1", "reply");
    const before = [user, tail];
    const after = [{ ...user, revisions: ["original", "edited"] } as unknown as ChatMessage, tail];
    expect(messagesEqual(before, after)).toBe(false);
  });

  it("detects a streaming delta on the last message", () => {
    // Guards the failure the ORIGINAL (id-based) comparator had: same id,
    // new content. Without this the transcript would freeze mid-stream.
    const before = [msg("a1", "hel")];
    const after = [msg("a1", "hello")];
    expect(messagesEqual(before, after)).toBe(false);
  });

  it("returns true when every element is reference-identical in a new array", () => {
    const a = msg("a", "x");
    const b = msg("b", "y");
    expect(messagesEqual([a, b], [a, b])).toBe(true);
  });
});