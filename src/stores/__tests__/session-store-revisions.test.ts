/**
 * session-store-revisions.test.ts — R8.1 (revision-pager).
 *
 * Verifies the contract of `appendUserRevision` / `setActiveRevision`:
 *   - appendUserRevision creates revisions[0] = original text when the
 *     user edits a message that has never been edited before
 *   - subsequent appends extend the array and bump activeRevision
 *   - de-dup: re-appending the same text only bumps activeRevision
 *   - setActiveRevision clamps 1..total and refuses non-user / missing
 *   - non-user messages are ignored by both actions
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useSessionStore } from "../session-store";

function addUserMessage(text: string): string {
  const id = useSessionStore.getState().pushOptimisticUser(text);
  // pushOptimisticUser also sets optimisticBubble, so commit & clear it.
  useSessionStore.setState((s) => ({
    optimisticBubble: null,
    messages: s.messages.map((m) =>
      m.id === id ? { ...m, complete: true } : m,
    ),
  }));
  return id;
}

beforeEach(() => {
  useSessionStore.getState().reset();
});

describe("appendUserRevision", () => {
  it("seeds revisions[0] with the original parts text on first append", () => {
    const id = addUserMessage("hello");
    useSessionStore.getState().appendUserRevision(id, "hello v2");
    const msg = useSessionStore.getState().messages.find((m) => m.id === id);
    // revisions[0] = original prompt text; revisions[1] = new edit; active = 2
    expect(msg?.revisions).toEqual(["hello", "hello v2"]);
    expect(msg?.activeRevision).toBe(2);
  });

  it("extends revisions on subsequent appends", () => {
    const id = addUserMessage("v1");
    useSessionStore.getState().appendUserRevision(id, "v2");
    useSessionStore.getState().appendUserRevision(id, "v3");
    const msg = useSessionStore.getState().messages.find((m) => m.id === id);
    expect(msg?.revisions).toEqual(["v1", "v2", "v3"]);
    expect(msg?.activeRevision).toBe(3);
  });

  it("de-duplicates identical text and bumps activeRevision only", () => {
    const id = addUserMessage("same");
    useSessionStore.getState().appendUserRevision(id, "edit 1");
    useSessionStore.getState().appendUserRevision(id, "edit 2");
    const before = useSessionStore.getState().messages.find((m) => m.id === id);
    useSessionStore.getState().appendUserRevision(id, "edit 2");
    const after = useSessionStore.getState().messages.find((m) => m.id === id);
    expect(after?.revisions).toEqual(before?.revisions);
    // active = 3 because revisions = ["same", "edit 1", "edit 2"]
    expect(after?.activeRevision).toBe(3);
  });

  it("is a no-op on non-existent message id", () => {
    addUserMessage("real");
    useSessionStore.getState().appendUserRevision("does-not-exist", "ghost");
    expect(useSessionStore.getState().messages).toHaveLength(1);
  });

  it("is a no-op on assistant messages", () => {
    // Begin a streaming assistant and finalize it.
    const aId = useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("answer");
    useSessionStore.getState().finishStreamingMessage();
    useSessionStore.getState().appendUserRevision(aId, "bogus");
    const msg = useSessionStore.getState().messages.find((m) => m.id === aId);
    expect(msg?.revisions).toBeUndefined();
  });
});

describe("setActiveRevision", () => {
  it("clamps to [1, total] range", () => {
    const id = addUserMessage("v1");
    useSessionStore.getState().appendUserRevision(id, "v2");
    useSessionStore.getState().appendUserRevision(id, "v3");
    useSessionStore.getState().setActiveRevision(id, 99);
    expect(useSessionStore.getState().messages.find((m) => m.id === id)?.activeRevision).toBe(3);
    useSessionStore.getState().setActiveRevision(id, 0);
    expect(useSessionStore.getState().messages.find((m) => m.id === id)?.activeRevision).toBe(1);
  });

  it("ignores non-user messages", () => {
    const aId = useSessionStore.getState().beginStreamingMessage();
    useSessionStore.getState().appendStreamingDelta("answer");
    useSessionStore.getState().finishStreamingMessage();
    useSessionStore.getState().setActiveRevision(aId, 5);
    const msg = useSessionStore.getState().messages.find((m) => m.id === aId);
    expect(msg?.activeRevision).toBeUndefined();
  });

  it("no-ops when message has no revisions array", () => {
    const id = addUserMessage("plain");
    const before = useSessionStore.getState().messages.find((m) => m.id === id);
    useSessionStore.getState().setActiveRevision(id, 1);
    const after = useSessionStore.getState().messages.find((m) => m.id === id);
    expect(after).toEqual(before);
  });
});
