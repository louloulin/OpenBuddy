/**
 * markdown-bridge 单测 —— 这是"渲染层 ↔ 编辑层"无损往返的守门人。
 *
 * 覆盖三类断言:
 *   1. markdown → HTML 的块级 / 行内映射;
 *   2. HTML → markdown 的反向映射;
 *   3. 往返幂等(round-trip),这是"打开编辑器再保存不会重写文档"的保证。
 */
import { describe, expect, it } from "vitest";
import {
  MarkdownStreamBuffer,
  escapeHtml,
  htmlToMarkdown,
  markdownToHtml,
  renderInline,
  shouldSyncExternalValue,
  unescapeHtml,
} from "../lib/markdown-bridge";

describe("escapeHtml / unescapeHtml", () => {
  it("转义全部 HTML 特殊字符", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("往返还原文本", () => {
    const raw = `<b>"q" & 'a'</b>`;
    expect(unescapeHtml(escapeHtml(raw))).toBe(raw);
  });

  it("&amp; 最后还原,避免二次解码", () => {
    expect(unescapeHtml("&amp;lt;")).toBe("&lt;");
  });
});

describe("renderInline", () => {
  it("解析粗体 / 斜体 / 删除线 / 行内代码", () => {
    expect(renderInline("**b**")).toBe("<strong>b</strong>");
    expect(renderInline("*i*")).toBe("<em>i</em>");
    expect(renderInline("~~s~~")).toBe("<s>s</s>");
    expect(renderInline("`c`")).toBe("<code>c</code>");
  });

  it("行内代码优先于强调(反引号内不解析)", () => {
    expect(renderInline("`**a**`")).toBe("<code>**a**</code>");
  });

  it("链接与图片", () => {
    expect(renderInline("[t](https://x.dev)")).toBe('<a href="https://x.dev">t</a>');
    expect(renderInline("![alt](a.png)")).toBe('<img src="a.png" alt="alt">');
  });

  it("行内公式映射到 data-type=inline-math", () => {
    expect(renderInline("$E=mc^2$")).toBe(
      '<span data-type="inline-math" data-latex="E=mc^2"></span>',
    );
  });

  it("转义裸 HTML,阻断注入", () => {
    expect(renderInline("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("链接文本里的强调仍然生效", () => {
    expect(renderInline("[**x**](u)")).toBe('<a href="u"><strong>x</strong></a>');
  });
});

describe("markdownToHtml", () => {
  it("标题 1-6 级", () => {
    expect(markdownToHtml("## 二级")).toBe("<h2>二级</h2>");
    expect(markdownToHtml("###### 六级")).toBe("<h6>六级</h6>");
  });

  it("段落 + 空行分隔", () => {
    expect(markdownToHtml("a\n\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("未闭合的围栏也吃掉剩余内容", () => {
    expect(markdownToHtml("```js\nconst a = 1;")).toBe(
      '<pre><code class="language-js">const a = 1;</code></pre>',
    );
  });

  it("mermaid 围栏映射为图表节点", () => {
    // 属性值里的换行被编码为 &#10;,避免 HTML 属性跨行(解析器行为差异大)。
    expect(markdownToHtml("```mermaid\ngraph TD\nA-->B\n```")).toBe(
      '<div data-type="mermaid" data-code="graph TD&#10;A--&gt;B"></div>',
    );
  });

  it("块级公式(单行与多行)", () => {
    expect(markdownToHtml("$$a+b$$")).toBe('<div data-type="block-math" data-latex="a+b"></div>');
    expect(markdownToHtml("$$\na+b\n$$")).toBe(
      '<div data-type="block-math" data-latex="a+b"></div>',
    );
  });

  it("引用块", () => {
    expect(markdownToHtml("> 引用一\n> 引用二")).toBe(
      "<blockquote><p>引用一<br>引用二</p></blockquote>",
    );
  });

  it("三种列表", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li><p>a</p></li><li><p>b</p></li></ol>");
    expect(markdownToHtml("- [ ] a\n- [x] b")).toContain('data-type="taskList"');
    expect(markdownToHtml("- [ ] a\n- [x] b")).toContain('data-checked="true"');
  });

  it("表格", () => {
    const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toBe(
      "<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>",
    );
  });

  it("分隔线", () => {
    expect(markdownToHtml("---")).toBe("<hr>");
  });

  it("空输入返回空串", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("\n\n\n")).toBe("");
  });

  it("CRLF 归一化", () => {
    expect(markdownToHtml("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
  });

  it("未知语法降级为段落而不是抛错", () => {
    expect(markdownToHtml("@@@ weird @@")).toBe("<p>@@@ weird @@</p>");
  });
});

describe("htmlToMarkdown", () => {
  it("标题 / 段落 / 行内格式", () => {
    expect(htmlToMarkdown("<h2>t</h2><p>a <strong>b</strong> <em>c</em></p>")).toBe(
      "## t\n\na **b** *c*",
    );
  });

  it("代码块带语言", () => {
    expect(htmlToMarkdown('<pre><code class="language-ts">const a = 1;</code></pre>')).toBe(
      "```ts\nconst a = 1;\n```",
    );
  });

  it("任务列表", () => {
    expect(
      htmlToMarkdown(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>',
      ),
    ).toBe("- [x] done\n- [ ] todo");
  });

  it("表格还原为 GFM", () => {
    expect(
      htmlToMarkdown(
        "<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>",
      ),
    ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("公式节点", () => {
    expect(htmlToMarkdown('<span data-type="inline-math" data-latex="x"></span>')).toBe("$x$");
    expect(htmlToMarkdown('<div data-type="block-math" data-latex="y"></div>')).toBe("$$\ny\n$$");
    expect(htmlToMarkdown('<div data-type="mermaid" data-code="graph TD"></div>')).toBe(
      "```mermaid\ngraph TD\n```",
    );
  });

  it("无 DOM 环境退化为纯文本", () => {
    const out = htmlToMarkdown("<p>a</p><p>b</p>", {
      parser: undefined as never,
    });
    // 有 jsdom 时走正常路径;断言只保证不抛错且有内容。
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("往返幂等(round-trip)", () => {
  const cases = [
    "# 标题\n\n正文 **粗** 与 `code`。",
    "- a\n- b",
    "1. 一\n2. 二",
    "- [ ] todo\n- [x] done",
    "> 引用",
    "---",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "```ts\nconst a = 1;\n```",
    "```mermaid\ngraph TD\nA-->B\n```",
    "$$\nE = mc^2\n$$",
    "行内 $x^2$ 公式",
    "[链接](https://openbuddy.dev)",
  ];

  it.each(cases)("md → html → md 不改变输入:%s", (input) => {
    expect(htmlToMarkdown(markdownToHtml(input))).toBe(input);
  });

  it("二次往返稳定(幂等)", () => {
    const once = htmlToMarkdown(markdownToHtml("- [x] a\n\n## h\n\n| x |\n| --- |\n| 1 |"));
    const twice = htmlToMarkdown(markdownToHtml(once));
    expect(twice).toBe(once);
  });
});

describe("MarkdownStreamBuffer", () => {
  it("累积 chunk 并保序", () => {
    const buffer = new MarkdownStreamBuffer();
    buffer.append("# 标题\n");
    buffer.append("正文");
    expect(buffer.value()).toBe("# 标题\n正文");
  });

  it("识别未闭合围栏", () => {
    const buffer = new MarkdownStreamBuffer();
    buffer.append("```js\nconst a = 1;");
    expect(buffer.hasOpenFence()).toBe(true);
    buffer.append("\n```");
    expect(buffer.hasOpenFence()).toBe(false);
  });

  it("reset 清空或替换内容", () => {
    const buffer = new MarkdownStreamBuffer("a");
    buffer.append("b");
    buffer.reset();
    expect(buffer.value()).toBe("");
    buffer.reset("seed");
    expect(buffer.value()).toBe("seed");
  });
});

describe("shouldSyncExternalValue", () => {
  it("回声(与自己刚发出的值相同)不写回", () => {
    expect(
      shouldSyncExternalValue({ focused: false, composing: false, lastEmitted: "same", newValue: "same" }),
    ).toBe(false);
  });

  it("聚焦中不写回(避免 caret 跳动)", () => {
    expect(
      shouldSyncExternalValue({ focused: true, composing: false, lastEmitted: "old", newValue: "new" }),
    ).toBe(false);
  });

  it("输入法合成中不写回", () => {
    expect(
      shouldSyncExternalValue({ focused: false, composing: true, lastEmitted: "old", newValue: "new" }),
    ).toBe(false);
  });

  it("未聚焦且非合成时写回", () => {
    expect(
      shouldSyncExternalValue({ focused: false, composing: false, lastEmitted: "old", newValue: "new" }),
    ).toBe(true);
  });

  it("force 时无视聚焦直接写回", () => {
    expect(
      shouldSyncExternalValue({ focused: true, composing: true, lastEmitted: "old", newValue: "new", force: true }),
    ).toBe(true);
  });
});
