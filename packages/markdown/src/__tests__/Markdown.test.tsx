import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../index";

/**
 * §6 markdown 渲染验证：代码块高亮、表格、任务列表、行内代码、公式。
 * 直接渲染真实管线（react-markdown + remark-gfm + rehype-highlight +
 * rehype-katex + rehype-sanitize），断言 DOM 里出现对应的 GFM/HLJS 结构。
 */

describe("Markdown 渲染（§6 验证）", () => {
  it("fenced 代码块:hljs 高亮 span + 语言标签", () => {
    render(
      <Markdown>{["```ts", "const x: number = 1;", "```"].join("\n")}</Markdown>,
    );
    // rehype-highlight 把 token 拆成 <span class="hljs-keyword"> 等
    const hljs = document.querySelector("code.hljs, pre code");
    expect(hljs).not.toBeNull();
    const keyword = document.querySelector(".hljs-keyword");
    expect(keyword?.textContent).toContain("const");
    // MarkdownPre 显示语言标签
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("未知语言代码块仍渲染为普通 pre(不抛错)", () => {
    render(
      <Markdown>{["```xyz-lang", "plain text", "```"].join("\n")}</Markdown>,
    );
    expect(screen.getByText("plain text")).toBeInTheDocument();
  });

  it("GFM 表格:table/thead/td 渲染且被包裹在滚动容器里", () => {
    render(
      <Markdown>
        {"| 列A | 列B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    const wrapper = document.querySelector(".md-table-wrapper");
    expect(wrapper).not.toBeNull();
    const table = wrapper!.querySelector("table");
    expect(table).not.toBeNull();
    expect(screen.getByText("列A")).toBeInTheDocument();
    expect(screen.getByText("列B")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("GFM 任务列表:checkbox input 渲染,勾选态正确", () => {
    render(
      <Markdown>
        {"- [x] 已完成项\n- [ ] 待办项"}
      </Markdown>,
    );
    const boxes = Array.from(
      document.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect(screen.getByText("已完成项")).toBeInTheDocument();
    expect(screen.getByText("待办项")).toBeInTheDocument();
  });

  it("行内代码渲染 <code>", () => {
    render(<Markdown>{"使用 `pnpm test` 跑测试"}</Markdown>);
    const code = screen.getByText("pnpm test");
    expect(code.tagName).toBe("CODE");
  });

  it("数学公式渲染 katex(行内 $ 与块级 $$)", () => {
    render(<Markdown>{"$E=mc^2$ 和\n$$\\int_0^1 x dx$$"}</Markdown>);
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("链接保留 target=_blank + noopener(sanitize 后)", () => {
    render(<Markdown>{"[官网](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "官网" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("原始 HTML 不进 DOM(无 rehype-raw,script/onerror 天然不存在)", () => {
    render(
      <Markdown>
        {'text <script>alert(1)</script> <img src=x onerror=alert(1)>'}
      </Markdown>,
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    // 原文以纯文本形式呈现,不是被解析执行。
    expect(document.body.textContent).toContain("alert(1)");
  });
});
