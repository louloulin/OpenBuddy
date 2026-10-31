/**
 * MarkdownPre-collapse.test — plan1030 批 5c（长代码限高 + wrap 切换）。
 *
 * 锁定四条不变量：
 *   1. 头部有 wrap 切换按钮，点击切换 aria-pressed 与标签（默认不换行）；
 *   2. 内容自然高度 > 420px 时折叠（md-code-pre--collapsed）并出现「展开全部」；
 *   3. 点击展开后折叠类移除、展开栏消失；
 *   4. 未超限的代码块不折叠、无展开栏（jsdom scrollHeight=0 即未超限）。
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MarkdownPre } from "../components/MarkdownPre";

function setScrollHeight(px: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return px;
    },
  });
}

describe("MarkdownPre 长代码限高 + wrap（plan1030 批 5c）", () => {
  it("头部有 wrap 切换按钮，默认未按下，点击后切换", () => {
    const { container, getByRole } = render(
      <MarkdownPre language="ts" code={"const a = 1;\n"}>
        <code>const a = 1;</code>
      </MarkdownPre>,
    );
    const wrapBtn = getByRole("button", { name: "自动换行" });
    expect(wrapBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(wrapBtn);
    expect(wrapBtn.getAttribute("aria-pressed")).toBe("true");
    // aria-label 优先于内部文本：按下后可访问名变为「关闭自动换行」
    expect(getByRole("button", { name: "关闭自动换行" })).toBeTruthy();
    // wrap class 落在 pre 上
    expect(container.querySelector("pre.md-code-pre--wrap")).not.toBeNull();
    void container;
  });

  it("超过 420px 的代码块折叠并显示展开栏，点击展开后移除", () => {
    setScrollHeight(1000);
    try {
      const code = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
      const { container, getByRole } = render(
        <MarkdownPre language="ts" code={code}>
          <code>{code}</code>
        </MarkdownPre>,
      );
      expect(container.querySelector("pre.md-code-pre--collapsed")).not.toBeNull();
      const expand = getByRole("button", { name: /展开全部（60 行）/ });
      fireEvent.click(expand);
      expect(container.querySelector("pre.md-code-pre--collapsed")).toBeNull();
      expect(container.querySelector(".md-code-expand")).toBeNull();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
  });

  it("未超限的代码块不折叠", () => {
    setScrollHeight(100);
    try {
      const { container, queryByRole } = render(
        <MarkdownPre language="ts" code={"const a = 1;"}>
          <code>const a = 1;</code>
        </MarkdownPre>,
      );
      expect(container.querySelector("pre.md-code-pre--collapsed")).toBeNull();
      expect(queryByRole("button", { name: /展开全部/ })).toBeNull();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    }
  });
});
