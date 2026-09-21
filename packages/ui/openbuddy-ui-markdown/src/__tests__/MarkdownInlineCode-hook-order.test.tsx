/**
 * MarkdownInlineCode-hook-order.test.tsx — R93 regression guard.
 *
 * `MarkdownInlineCode` 有一个「识别为可点击路径后直接 return 路径样式 <code>」
 * 的提前返回,而复制按钮所需的 `useState` / `useEffect` / `useCallback`
 * 原先排在它之后。Markdown 重渲染时同一个 `<code>` 实例的 `code` 内容会变化
 * (流式输出、会话切换、模型重写消息),一旦在「路径」和「普通内联代码」之间
 * 翻转,hook 数量随之变化 → React #300 / #310,聊天区整块塌掉。
 *
 * 这个用例把同一实例沿两个方向推一遍路径边界。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownInlineCode } from "../components/MarkdownInlineCode";

describe("MarkdownInlineCode — R93 hook 顺序稳定", () => {
  it("同一实例在「路径 → 普通内联代码 → 路径」之间切换不改变 hook 数量", () => {
    const onPathClick = vi.fn();

    const { container, rerender } = render(
      <MarkdownInlineCode pathClickHandler={{ onPathClick }}>
        {"src/foo.ts"}
      </MarkdownInlineCode>,
    );
    expect(container.querySelector("code.md-clickable-path")).toBeTruthy();

    // ① 路径 → 普通代码:命中提前返回消失的分支。修复前这里同步抛错。
    expect(() => {
      rerender(
        <MarkdownInlineCode pathClickHandler={{ onPathClick }}>
          {"hello world"}
        </MarkdownInlineCode>,
      );
    }).not.toThrow();
    expect(container.querySelector("button.md-inline-code__copy")).toBeTruthy();

    // ② 普通代码 → 路径:反向同样要安全。
    expect(() => {
      rerender(
        <MarkdownInlineCode pathClickHandler={{ onPathClick }}>
          {"src/foo.ts"}
        </MarkdownInlineCode>,
      );
    }).not.toThrow();
    expect(container.querySelector("code.md-clickable-path")).toBeTruthy();
  });
});
