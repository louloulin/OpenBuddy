import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import type { ChatMessage } from "@/features/chat/state/session-store";

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "写一篇长文" }], meta: { timestamp: now - 10_000 } };
const truncated: ChatMessage = {
  id: "a", role: "assistant", complete: true, meta: { timestamp: now - 1_000, model: "fixture-model", stopReason: "length" },
  parts: [{ kind: "text", text: "文章开头……" }],
};

describe("继续生成 / 删除本轮问答 (G1-27)", () => {
  it("offers 继续生成 when the answer was cut off by the output limit", () => {
    const onContinue = vi.fn();
    render(<ThemeProvider><TurnView messages={[truncated]} user={user} running={false} isLast sessionId="s" onContinue={onContinue} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("hides 继续生成 when the answer is complete", () => {
    render(<ThemeProvider><TurnView messages={[{ ...truncated, meta: { ...truncated.meta, stopReason: "stop" } }]} user={user} running={false} isLast sessionId="s" onContinue={vi.fn()} /></ThemeProvider>);
    expect(screen.queryByRole("button", { name: "继续生成" })).toBeNull();
  });

  it("deletes the whole turn from the more menu", () => {
    const onDeleteTurn = vi.fn();
    render(<ThemeProvider><TurnView messages={[truncated]} user={user} running={false} isLast sessionId="s" onDeleteTurn={onDeleteTurn} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除本轮问答" }));
    expect(onDeleteTurn).toHaveBeenCalledWith("u");
  });

  it("regenerates with another model", () => {
    const onRetry = vi.fn();
    const models = [{ id: "prov/model-a", label: "Model A" }, { id: "prov/model-b", label: "Model B" }];
    render(<ThemeProvider><TurnView messages={[truncated]} user={user} running={false} isLast sessionId="s" onRetry={onRetry} models={models} /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Model B" }));
    expect(onRetry).toHaveBeenCalledWith("prov/model-b");
  });
});
