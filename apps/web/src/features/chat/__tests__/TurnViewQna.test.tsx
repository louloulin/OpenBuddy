import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import type { ChatMessage } from "@/features/chat/state/session-store";

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "帮我梳理" }], meta: { timestamp: now - 10_000 } };
const answer: ChatMessage = {
  id: "a", role: "assistant", complete: true, meta: { timestamp: now - 1_000, model: "fixture-model" },
  parts: [{ kind: "text", text: "可以先确认几点：\n\n1. 目标用户是谁？\n- 预算范围是多少？\n最后是排期。" }],
};

describe("逐条回答 (pii W1.8)", () => {
  it("collects the question lines in this answer into a numbered prompt", () => {
    const onInsertPrompt = vi.fn();
    render(<ThemeProvider><TurnView messages={[answer]} user={user} running={false} isLast sessionId="s" onInsertPrompt={onInsertPrompt} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "逐条回答" }));
    expect(onInsertPrompt).toHaveBeenCalledWith(
      "请逐条回答以下问题：\n1. 目标用户是谁？\n2. 预算范围是多少？",
    );
  });

  it("toasts when the answer has no questions", () => {
    const onInsertPrompt = vi.fn();
    const onToast = vi.fn();
    render(<ThemeProvider><TurnView messages={[{ ...answer, parts: [{ kind: "text", text: "没有问题的回答。" }] }]} user={user} running={false} isLast sessionId="s" onInsertPrompt={onInsertPrompt} onToast={onToast} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "逐条回答" }));
    expect(onToast).toHaveBeenCalledWith("这条回答里没有找到问题");
    expect(onInsertPrompt).not.toHaveBeenCalled();
  });
});
