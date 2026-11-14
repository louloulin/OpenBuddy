import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { UserBubble } from "../UserBubble";
import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { MarkdownPre } from "@openbuddy/markdown/MarkdownPre";
import type { ChatMessage } from "@/features/chat/state/session-store";

const prompt = (meta: ChatMessage["meta"] = {}): ChatMessage => ({ id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "原来的问题" }], meta });

describe("编辑提问（原地）", () => {
  it("edits in place: Escape keeps the prompt, Enter resends the new text", async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<UserBubble message={prompt()} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const box = screen.getByRole("textbox", { name: "编辑提问" });
    expect(box).toHaveValue("原来的问题");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑提问" }), { target: { value: "  改过的问题 " } });
    await act(async () => { fireEvent.keyDown(screen.getByRole("textbox", { name: "编辑提问" }), { key: "Enter" }); });
    expect(onEdit).toHaveBeenCalledWith("改过的问题", true);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("hands a prompt with files back to the composer instead of resending without them", async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<UserBubble message={prompt({ attachments: ["/w/a.txt"] })} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByText(/附件需要在输入框里重新添加/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放回输入框" })); });
    expect(onEdit).toHaveBeenCalledWith("原来的问题", false);
  });

  it("offers no edit while a reply is running", () => {
    render(<UserBubble message={prompt()} />);
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
  });
});

describe("思考用时", () => {
  afterEach(() => vi.useRealTimers());

  it("labels a finished thinking block 已思考 Xs and stops being live once a tool call starts", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
    const thought: ChatMessage = { id: "a1", role: "assistant", complete: false, meta: {}, parts: [{ kind: "thought", text: "先想一想", contentIndex: 0 }] };
    const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "q" }], meta: {} };
    const view = render(<ThemeProvider><TurnView messages={[thought]} user={user} running isLast sessionId="s" /></ThemeProvider>);
    expect(screen.getByText("思考中")).toBeInTheDocument();
    vi.setSystemTime(new Date("2026-11-14T10:00:04Z"));
    const withTool: ChatMessage = { ...thought, parts: [...thought.parts, { kind: "tool_call", contentIndex: 1, toolCall: { toolCallId: "t1", title: "bash", kind: "bash", status: "in_progress", content: [], rawInput: { command: "ls" } } }] };
    view.rerender(<ThemeProvider><TurnView messages={[withTool]} user={user} running isLast sessionId="s" /></ThemeProvider>);
    expect(screen.queryByText("思考中")).toBeNull();
    expect(screen.getByText("已思考 4s")).toBeInTheDocument();
  });
});

describe("长代码块折叠", () => {
  it("folds blocks longer than a screenful and toggles them", () => {
    const code = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const { container } = render(<MarkdownPre language="ts" code={code}><code>{code}</code></MarkdownPre>);
    const toggle = screen.getByRole("button", { name: "展开全部 · 30 行" });
    expect(container.querySelector(".md-code-body--folded")).not.toBeNull();
    fireEvent.click(toggle);
    expect(container.querySelector(".md-code-body--folded")).toBeNull();
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves short blocks alone", () => {
    render(<MarkdownPre language="ts" code={"a\nb"}><code>{"a\nb"}</code></MarkdownPre>);
    expect(screen.queryByRole("button", { name: /展开全部/ })).toBeNull();
  });
});

describe("长提问折叠", () => {
  it("folds a huge pasted prompt and renders only its head until expanded", () => {
    const text = "材料" + "A".repeat(5000);
    render(<UserBubble message={{ id: "u", role: "user", complete: true, parts: [{ kind: "text", text }], meta: {} }} />);
    const more = screen.getByRole("button", { name: "展开全部（5,002 字）" });
    expect(document.querySelector(".msg__bubble--folded .msg__bubble-text")!.textContent!.length).toBe(1200);
    fireEvent.click(more);
    expect(document.querySelector(".msg__bubble--folded")).toBeNull();
    expect(document.querySelector(".msg__bubble-text")!.textContent).toBe(text);
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();
  });
});
