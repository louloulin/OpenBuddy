import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { useUiPrefs } from "@/app/state/ui-prefs-store";
import type { ChatMessage } from "@/features/chat/state/session-store";
import { useFindFocusStore } from "../state/find-focus-store";
import { findRanges, highlightInMessage } from "../find-highlight";

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "分析一下" }], meta: { timestamp: now - 9_000 } };
const messages: ChatMessage[] = [
  {
    id: "a1", role: "assistant", complete: true, meta: { timestamp: now - 8_000 },
    parts: [
      { kind: "thought", text: "先确认独角兽指标的口径。", contentIndex: 0 },
      { kind: "tool_call", contentIndex: 1, toolCall: { toolCallId: "t1", title: "bash", kind: "bash", status: "completed", content: [], rawInput: { command: "ls" } } },
    ],
  },
  { id: "a2", role: "assistant", complete: true, meta: { timestamp: now - 1_000 }, parts: [{ kind: "text", text: "结论如下。", contentIndex: 0 }] },
];
const view = () => render(<ThemeProvider><div data-msg-ids="a1 a2"><TurnView messages={messages} user={user} running={false} isLast sessionId="s" /></div></ThemeProvider>);

beforeEach(() => act(() => useUiPrefs.getState().setPrefs({ conciseMode: true })));
afterEach(() => act(() => useFindFocusStore.getState().set("", null)));

describe("in-chat find reaches folded content (U3.5)", () => {
  it("unfolds a finished turn and its thinking block when the current hit is inside them", () => {
    view();
    expect(screen.getByRole("button", { name: /已完成/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("先确认独角兽指标的口径。")).toBeNull();
    act(() => useFindFocusStore.getState().set("独角兽", "a1"));
    expect(screen.getByRole("button", { name: /已完成/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("先确认独角兽指标的口径。")).toBeInTheDocument();
  });

  it("leaves the turn folded when the hit is only in the visible answer or in another turn", () => {
    view();
    act(() => useFindFocusStore.getState().set("结论", "a2"));
    expect(screen.getByRole("button", { name: /已完成/ })).toHaveAttribute("aria-expanded", "false");
    act(() => useFindFocusStore.getState().set("独角兽", "other"));
    expect(screen.getByRole("button", { name: /已完成/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("finds every occurrence inside the hit's container", () => {
    view();
    act(() => useFindFocusStore.getState().set("独角兽", "a1"));
    const container = document.querySelector('[data-msg-ids~="a1"]')!;
    expect(findRanges(container, "独角兽").map((r) => r.toString())).toEqual(["独角兽"]);
    expect(highlightInMessage(document, "a1", "结论")).toBe(1);
    expect(highlightInMessage(document, "missing", "结论")).toBe(0);
  });
});
