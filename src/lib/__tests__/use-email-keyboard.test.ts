import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailThread, EmailThreadPreview } from "@/lib/agent/pi-client";
import {
  type EmailConfirmRequest,
  type EmailKeyboardIntent,
  useEmailKeyboard,
} from "@/lib/email/use-email-keyboard";

function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: "thread-1",
    accountId: "acc-1",
    subject: "Test subject",
    from: { address: "alice@example.com", name: "Alice" },
    to: [{ address: "me@example.com", name: "Me" }],
    cc: [],
    bcc: [],
    replyTo: [],
    labels: [],
    tags: [],
    unread: true,
    starred: false,
    important: false,
    hasAttachment: false,
    snippet: "snippet",
    date: "2026-08-31T10:00:00.000Z",
    messages: [
      {
        id: "msg-1",
        accountId: "acc-1",
        threadId: "thread-1",
        from: { address: "alice@example.com", name: "Alice" },
        to: [{ address: "me@example.com", name: "Me" }],
        cc: [],
        bcc: [],
        replyTo: [],
        date: "2026-08-31T10:00:00.000Z",
        text: "hi",
        html: "<p>hi</p>",
        attachments: [],
        unread: true,
      },
    ],
    folder: "inbox",
    ...overrides,
  } as EmailThread;
}

function makePreview(id: string, subject: string): EmailThreadPreview {
  return {
    id,
    accountId: "acc-1",
    subject,
    from: { address: "alice@example.com", name: "Alice" },
    snippet: "",
    date: "2026-08-31T10:00:00.000Z",
    messageCount: 1,
    unread: true,
    labels: [],
  };
}

interface IntentCallLog {
  clearSelection: unknown[][];
  setFocusedIndex: unknown[][];
  setMessageIndex: unknown[][];
  showKeyboardHelp: unknown[][];
  closeComposer: unknown[][];
  clearQuery: unknown[][];
  setSearchFiltersOpen: unknown[][];
  setRegistryAddOpen: unknown[][];
  setFolder: unknown[][];
  startCompose: unknown[][];
  openThread: unknown[][];
  reply: unknown[][];
  update: unknown[][];
  requestConfirm: unknown[][];
  setComposeChord: unknown[][];
  toggleActionCenter: unknown[][];
}

function makeIntent(overrides: Partial<EmailKeyboardIntent> = {}): {
  intent: EmailKeyboardIntent;
  calls: IntentCallLog;
} {
  const calls: IntentCallLog = {
    clearSelection: [],
    setFocusedIndex: [],
    setMessageIndex: [],
    showKeyboardHelp: [],
    closeComposer: [],
    clearQuery: [],
    setSearchFiltersOpen: [],
    setRegistryAddOpen: [],
    setFolder: [],
    startCompose: [],
    openThread: [],
    reply: [],
    update: [],
    requestConfirm: [],
    setComposeChord: [],
    toggleActionCenter: [],
  };

  const focusRef = { value: overrides.focusedIndex ?? 0 };
  const messageRef = { value: overrides.messageIndex ?? 0 };

  const intent: EmailKeyboardIntent = {
    selected: overrides.selected ?? null,
    composerOpen: overrides.composerOpen ?? false,
    query: overrides.query ?? "",
    searchFiltersOpen: overrides.searchFiltersOpen ?? false,
    registryAddOpen: overrides.registryAddOpen ?? false,
    composeChord: overrides.composeChord ?? false,
    focusedIndex: focusRef.value,
    visibleThreads: overrides.visibleThreads ?? [makePreview("t1", "A"), makePreview("t2", "B")],
    messageIndex: messageRef.value,
    clearSelection: overrides.clearSelection ?? ((...args: unknown[]) => { calls.clearSelection.push(args); }),
    setFocusedIndex:
      overrides.setFocusedIndex ??
      ((updater) => {
        const next = updater(focusRef.value);
        focusRef.value = next;
        calls.setFocusedIndex.push([next]);
      }),
    setMessageIndex:
      overrides.setMessageIndex ??
      ((updater) => {
        const next = updater(messageRef.value);
        messageRef.value = next;
        calls.setMessageIndex.push([next]);
      }),
    showKeyboardHelp: overrides.showKeyboardHelp ?? ((...args: unknown[]) => { calls.showKeyboardHelp.push(args); }),
    closeComposer: overrides.closeComposer ?? ((...args: unknown[]) => { calls.closeComposer.push(args); }),
    clearQuery:
      overrides.clearQuery ??
      (async (...args: unknown[]) => {
        calls.clearQuery.push(args);
      }),
    setSearchFiltersOpen:
      overrides.setSearchFiltersOpen ??
      ((...args: unknown[]) => { calls.setSearchFiltersOpen.push(args); }),
    setRegistryAddOpen:
      overrides.setRegistryAddOpen ??
      ((...args: unknown[]) => { calls.setRegistryAddOpen.push(args); }),
    setFolder: overrides.setFolder ?? ((...args: unknown[]) => { calls.setFolder.push(args); }),
    startCompose: overrides.startCompose ?? ((...args: unknown[]) => { calls.startCompose.push(args); }),
    openThread:
      overrides.openThread ??
      (async (...args: unknown[]) => {
        calls.openThread.push(args);
      }),
    reply:
      overrides.reply ??
      (async (...args: unknown[]) => {
        calls.reply.push(args);
      }),
    update:
      overrides.update ??
      (async (...args: unknown[]) => {
        calls.update.push(args);
      }),
    requestConfirm:
      overrides.requestConfirm ??
      (async (...args: unknown[]) => {
        calls.requestConfirm.push(args);
        return true;
      }),
    setComposeChord: overrides.setComposeChord ?? ((v: boolean) => {
        intent.composeChord = v;
        calls.setComposeChord.push([v]);
      }),
    toggleActionCenter: overrides.toggleActionCenter ?? (() => { calls.toggleActionCenter.push([]); }),
  };
  return { intent, calls };
}

function dispatchKey(key: string, target: EventTarget = document.body): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
}

function dispatchKeyOnInput(key: string): void {
  const input = document.createElement("input");
  document.body.appendChild(input);
  dispatchKey(key, input);
  document.body.removeChild(input);
}

describe("useEmailKeyboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores key events when target is an input", () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKeyOnInput("j");
    expect(calls.setFocusedIndex).toHaveLength(0);
  });

  it("ignores keys with meta/ctrl/alt modifiers", () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    const event = new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true });
    window.dispatchEvent(event);
    expect(calls.setFocusedIndex).toHaveLength(0);
  });

  it("Esc clears selection when a thread is selected", () => {
    const selected = makeThread();
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("Escape");
    expect(calls.clearSelection).toHaveLength(1);
  });

  it("Esc closes composer when composer is open", () => {
    const { intent, calls } = makeIntent({ composerOpen: true });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("Escape");
    expect(calls.closeComposer).toHaveLength(1);
  });

  it("Esc clears query when query is non-empty", () => {
    const { intent, calls } = makeIntent({ query: "invoice" });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("Escape");
    expect(calls.clearQuery).toHaveLength(1);
  });

  it("/ focuses the search input when no thread selected", () => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "搜索邮件");
    document.body.appendChild(input);
    const focusSpy = vi.spyOn(input, "focus");
    const { intent } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("/");
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("? opens the keyboard help modal", () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("?");
    expect(calls.showKeyboardHelp).toHaveLength(1);
  });

  it("j moves focus down, k moves focus up", () => {
    const { intent, calls } = makeIntent({ focusedIndex: 0 });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("j");
    dispatchKey("k");
    expect(calls.setFocusedIndex).toHaveLength(2);
    expect(calls.setFocusedIndex[0][0]).toBe(1);
    expect(calls.setFocusedIndex[1][0]).toBe(0);
  });

  it("g+i sets folder to inbox", () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("g");
    dispatchKey("i");
    expect(calls.setFolder).toHaveLength(1);
    expect(calls.setFolder[0][0]).toBe("inbox");
  });

  it("g+a toggles the AI action center", () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("g");
    dispatchKey("a");
    expect(calls.toggleActionCenter).toHaveLength(1);
    expect(calls.setFolder).toHaveLength(0);
  });

  it("g chord expires after timeout", async () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("g");
    expect(calls.setFolder).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    dispatchKey("i");
    expect(calls.setFolder).toHaveLength(0);
  });

  it("c+e opens composer via chord", async () => {
    const { intent, calls } = makeIntent();
    renderHook(() => useEmailKeyboard(intent));
    await act(async () => {
      dispatchKey("c");
    });
    await act(async () => {
      dispatchKey("e");
    });
    expect(calls.startCompose).toHaveLength(1);
    expect(calls.startCompose[0][0]).toBeUndefined();
  });

  it("e archives selected thread", () => {
    const selected = makeThread();
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("e");
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0][0]).toBe("archive");
  });

  it("u marks selected thread as read when it has unread", () => {
    const selected = makeThread();
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("u");
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0][0]).toBe("mark-read");
  });

  it("u marks selected thread as unread when already read", () => {
    const selected = makeThread({
      messages: [
        {
          id: "m",
          subject: "",
          threadId: "t",
          from: { address: "x@y.com" },
          to: [],
          cc: [],
          bcc: [],
          replyTo: [],
          date: "2026-08-31T10:00:00.000Z",
          text: "",
          html: "",
          attachments: [],
          unread: false,
        },
      ],
    });
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("u");
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0][0]).toBe("mark-unread");
  });

  it("# requests confirmation before trash", () => {
    const selected = makeThread();
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("#");
    expect(calls.requestConfirm).toHaveLength(1);
  });

  it("f opens composer with forward seed", () => {
    const selected = makeThread();
    const { intent, calls } = makeIntent({ selected });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("f");
    expect(calls.startCompose).toHaveLength(1);
    const seed = calls.startCompose[0][0] as { subject?: string; body?: string };
    expect(seed?.subject).toMatch(/Fwd:/);
    expect(seed?.body).toContain("--- 转发邮件 ---");
  });

  it("J/K navigate messages within selected thread", () => {
    const selected = makeThread({
      messages: [
        {
          id: "m1",
          subject: "",
          threadId: "t",
          from: { address: "x@y.com" },
          to: [],
          cc: [],
          bcc: [],
          replyTo: [],
          date: "2026-08-31T10:00:00.000Z",
          text: "",
          html: "",
          attachments: [],
          unread: false,
        },
        {
          id: "m2",
          subject: "",
          threadId: "t",
          from: { address: "x@y.com" },
          to: [],
          cc: [],
          bcc: [],
          replyTo: [],
          date: "2026-08-31T11:00:00.000Z",
          text: "",
          html: "",
          attachments: [],
          unread: false,
        },
      ],
    });
    const { intent, calls } = makeIntent({ selected, messageIndex: 0 });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("J");
    expect(calls.setMessageIndex[0][0]).toBe(1);
    dispatchKey("K");
    expect(calls.setMessageIndex[1][0]).toBe(0);
  });

  it("Enter opens the focused thread", () => {
    const { intent, calls } = makeIntent({ focusedIndex: 1 });
    renderHook(() => useEmailKeyboard(intent));
    dispatchKey("Enter");
    expect(calls.openThread).toHaveLength(1);
    const arg = calls.openThread[0][0] as EmailThreadPreview;
    expect(arg?.id).toBe("t2");
  });

  it("registers and cleans up the global keydown listener", () => {
    const { intent } = makeIntent();
    const { unmount } = renderHook(() => useEmailKeyboard(intent));
    const removeSpy = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

void ({} as unknown as EmailConfirmRequest);
