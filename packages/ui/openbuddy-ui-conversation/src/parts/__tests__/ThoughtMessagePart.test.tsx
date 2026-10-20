/**
 * ThoughtMessagePart —— 思考块标题的完成态必须诚实。
 *
 * 真机截图(2026-10-11)暴露:一轮对话**已经回答完**,思考块标题却写着
 * 「深度思考 思考中」。根因是耗时回退:完成时 `elapsedMs` 为 null → 回退
 * `formatSecondsZh(0)` → 而 <1000ms 恰好返回「思考中」。
 *
 * 这条断言是 mutation 可杀的:把回退改回 `formatSecondsZh(0)`,第一条立刻红。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThoughtMessagePart } from "../ThoughtMessagePart";

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

vi.mock("../../conversation-slots", () => ({
  ConversationMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

const renderPart = (opts: { isStreaming: boolean; complete: boolean }) =>
  render(
    <ThoughtMessagePart
      part={{ kind: "thought", text: "先想一下" } as never}
      messageId="m1"
      isStreaming={opts.isStreaming}
      complete={opts.complete}
    />,
  );

describe("ThoughtMessagePart", () => {
  it("已完成的思考块不再自称「思考中」", () => {
    renderPart({ isStreaming: false, complete: true });
    const summary = document.querySelector(".msg__thought-label");
    expect(summary?.textContent).toBe("深度思考");
    expect(document.querySelector(".msg__thought")?.textContent).not.toContain("思考中");
  });

  it("流式中的思考块显示「思考中」", () => {
    renderPart({ isStreaming: true, complete: false });
    expect(screen.getByText("思考中")).toBeInTheDocument();
  });
});
