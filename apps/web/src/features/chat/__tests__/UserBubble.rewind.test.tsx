import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UserBubble } from "../UserBubble";
import type { ChatMessage } from "@/features/chat/state/session-store";

const message = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  parts: [{ kind: "text", text }],
} as ChatMessage);

describe("UserBubble 工具栏 (WorkBuddy 对齐)", () => {
  it("offers 复制 / 回退到此消息前 / 编辑", () => {
    const onRewind = vi.fn();
    render(<UserBubble message={message("m1", "帮我做这件事")} onRewind={onRewind} onToast={vi.fn()} />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    const rewind = screen.getByRole("button", { name: "回退到此消息前" });
    fireEvent.click(rewind);
    expect(onRewind).toHaveBeenCalledOnce();
  });

  it("hides the rewind button while no handler is given", () => {
    render(<UserBubble message={message("m1", "x")} onToast={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "回退到此消息前" })).toBeNull();
  });
});
