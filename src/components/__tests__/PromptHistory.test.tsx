import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PromptHistory, promptPreview } from "../chat/PromptHistory";
import type { ChatMessage } from "@/stores/session-store";

const user = (id: string, text: string, meta: ChatMessage["meta"] = {}): ChatMessage => ({ id, role: "user", complete: true, parts: text ? [{ kind: "text", text }] : [], meta });
const reply = (id: string): ChatMessage => ({ id, role: "assistant", complete: true, parts: [{ kind: "text", text: "answer" }] });

describe("提问历史", () => {
  it("lists every prompt of the task in order and jumps to the picked one", () => {
    const onJump = vi.fn();
    render(<PromptHistory messages={[user("u1", "第一个问题"), reply("a1"), user("u2", "第二个\n问题"), reply("a2")]} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "提问历史" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["1第一个问题", "2第二个 问题"]);
    fireEvent.click(items[1]);
    expect(onJump).toHaveBeenCalledWith("u2");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is disabled without prompts and closes on Escape", () => {
    const { rerender } = render(<PromptHistory messages={[]} onJump={() => {}} />);
    expect(screen.getByRole("button", { name: "提问历史" })).toBeDisabled();
    rerender(<PromptHistory messages={[user("u1", "hi")]} onJump={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "提问历史" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("describes attachment-only and skill-only prompts", () => {
    expect(promptPreview(user("u", "", { attachments: ["/a/b/report.pdf", "/a/c.png"] }))).toBe("附件：report.pdf、c.png");
    expect(promptPreview(user("u", "", { skill: "commit" }))).toBe("技能 · commit");
  });
});
