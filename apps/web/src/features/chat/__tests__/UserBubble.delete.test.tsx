import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UserBubble } from "../UserBubble";
import type { ChatMessage } from "@/features/chat/state/session-store";

const message = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  parts: [{ kind: "text", text }],
} as ChatMessage);

describe("UserBubble 删除该消息 (G1-27)", () => {
  it("offers 删除该消息 and calls the handler", () => {
    const onDelete = vi.fn();
    render(<UserBubble message={message("m1", "帮我做这件事")} onDelete={onDelete} onToast={vi.fn()} />);
    const remove = screen.getByRole("button", { name: "删除该消息" });
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("hides the delete button while no handler is given", () => {
    render(<UserBubble message={message("m1", "x")} onToast={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "删除该消息" })).toBeNull();
  });
});
