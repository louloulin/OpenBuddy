import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TurnView } from "../chat/TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { useUiPrefs } from "@/stores/ui-prefs-store";
import type { ChatMessage } from "@/stores/session-store";

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "看看环境" }], meta: { timestamp: now - 12_000 } };
const messages: ChatMessage[] = [
  {
    id: "a1", role: "assistant", complete: true, meta: { timestamp: now - 11_000, model: "fixture-model" },
    parts: [
      { kind: "text", text: "我先运行一个命令。", contentIndex: 0 },
      { kind: "tool_call", contentIndex: 1, toolCall: { toolCallId: "t1", title: "bash", kind: "bash", status: "completed", content: [], rawInput: { command: "echo hi" }, durationMs: 9 } },
    ],
  },
  { id: "a2", role: "assistant", complete: true, meta: { timestamp: now - 1_000, model: "fixture-model" }, parts: [{ kind: "text", text: "命令输出 hi。", contentIndex: 0 }] },
];
const view = () => render(<ThemeProvider><TurnView messages={messages} user={user} running={false} isLast sessionId="s" /></ThemeProvider>);

describe("简洁模式", () => {
  beforeEach(() => act(() => useUiPrefs.getState().setPrefs({ conciseMode: true })));

  it("folds a finished turn's steps behind 已完成 · 用时 and keeps the answer", () => {
    view();
    expect(screen.getByRole("button", { name: /已完成 · 用时 11s/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("echo hi")).toBeNull();
    expect(screen.getByText("命令输出 hi。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /已完成/ }));
    expect(screen.getByText("echo hi")).toBeInTheDocument();
  });

  it("shows the steps expanded when concise mode is off, and follows the switch live", () => {
    act(() => useUiPrefs.getState().setPrefs({ conciseMode: false }));
    view();
    expect(screen.getByText("echo hi")).toBeInTheDocument();
    act(() => useUiPrefs.getState().setPrefs({ conciseMode: true }));
    expect(screen.queryByText("echo hi")).toBeNull();
    expect(JSON.parse(localStorage.getItem("openbuddy.ui-prefs") ?? "{}")).toEqual({ conciseMode: true });
  });
});
