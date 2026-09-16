/**
 * 编辑侧 round-trip 保真测试 —— markdown →(bridge)→ HTML →(真实 TipTap
 * schema)→ HTML →(bridge)→ markdown。
 *
 * 为什么要走**真实编辑器**而不是只测 bridge:
 *   `markdown-bridge` 的两个方向各自都有单测,但"打开编辑器 → 保存"这条
 *   真实路径中间还插着 ProseMirror 的 schema:一个节点如果 schema 不认识,
 *   会被静默丢掉;属性名如果对不上,会被重置成默认值。只用纯函数测不出这些。
 *
 * 判据:往返后的 markdown 必须与原文**逐字符相等**(在统一了尾随空格与
 * 连续空行之后),否则用户的文档在保存时就被静默改写了。
 *
 * 已知的**规范化**(不算丢内容,见文件末尾的专门用例):
 *   - 单行块级公式 `$$x$$` 写出时规范成三行 `$$\n x\n$$`;
 *   - `_斜体_` 写出时规范成 `*斜体*`。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "../extensions";
import { markdownToHtml, htmlToMarkdown } from "../lib/markdown-bridge";

const editors: Editor[] = [];

function createEditor(content: string) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions({ allowImages: true }),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** 真实路径:markdown 进编辑器,再从编辑器出来。 */
function roundTrip(markdown: string): string {
  const editor = createEditor(markdownToHtml(markdown));
  return htmlToMarkdown(editor.getHTML());
}

/** 归一化:去掉首尾空行、行尾空格,并把 3+ 连续空行压成 2 行。 */
function normalize(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FIXTURES: Array<[name: string, markdown: string]> = [
  ["行内公式", "行内 $E = mc^2$ 公式"],
  ["块级公式(规范形式)", "$$\na^2 + b^2 = c^2\n$$"],
  ["多行块级公式", "$$\n\\sum_{i=1}^{n} x_i = X\n$$"],
  ["mermaid 图表", "```mermaid\ngraph TD\n  A --> B\n```"],
  ["mermaid 与公式混排", "前言\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n\n$$\nf(x) = x^2\n$$"],
  ["代码块", "```ts\nconst a: number = 1;\n```"],
  ["表格", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
  ["任务列表", "- [ ] 未完成\n- [x] 已完成"],
  ["嵌套列表", "- 一级\n  - 二级\n- 另一条"],
  ["三层嵌套列表", "- 一\n  - 二\n    - 三\n- 回到一层"],
  ["嵌套有序列表", "1. 一\n2. 二\n  - 补充\n3. 三"],
  ["有序列表起始序号不是 1", "3. 三\n4. 四"],
  ["任务项里嵌普通子列表", "- [ ] 父任务\n  - 子项 A\n  - 子项 B"],
  ["标题层级", "# H1\n\n## H2\n\n### H3"],
  ["链接与强调", "**粗** 与 *斜* 与 [链接](https://example.com)"],
  ["分隔线", "上\n\n---\n\n下"],
  ["公式后紧跟段落", "$$\nx = 1\n$$\n\n正文一段。"],
  ["引用与行内代码", "> 引用 `code` 文本"],
];

describe("编辑侧 round-trip 保真(markdown → TipTap → markdown)", () => {
  it.each(FIXTURES)("%s", (_name, markdown) => {
    expect(normalize(roundTrip(markdown))).toBe(normalize(markdown));
  });

  it("整篇文档(混合块级结构)一次往返不丢内容", () => {
    const doc = [
      "# 计划书",
      "",
      "第一段带 **强调** 与行内公式 $a+b$。",
      "",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$",
      "",
      "```mermaid",
      "graph LR",
      "  A --> B",
      "```",
      "",
      "| 步骤 | 状态 |",
      "| --- | --- |",
      "| 设计 | 完成 |",
      "",
      "- 阶段一",
      "  - 设计",
      "  - 评审",
      "- 阶段二",
      "",
      "- [x] 设计",
      "- [ ] 实现",
      "",
      "> 结尾引用。",
    ].join("\n");
    expect(normalize(roundTrip(doc))).toBe(normalize(doc));
  });

  it("公式里的 LaTeX 特殊字符不会被 HTML 转义污染", () => {
    const out = roundTrip("$$\\frac{a}{b} < \\sqrt{c > d}$$");
    expect(out).toContain("\\frac{a}{b} < \\sqrt{c > d}");
  });

  it("mermaid 源码里的换行 / 箭头 / 引号原样保留", () => {
    const source = 'flowchart TD\n  A["入口"] --> B{判断}\n  B -->|是| C';
    const out = roundTrip(`\`\`\`mermaid\n${source}\n\`\`\``);
    expect(out).toContain(source);
  });

  it("往返两次是幂等的(第二次不再变化)", () => {
    const first = roundTrip("$$\nx = 1\n$$\n\n- 父\n  - 子");
    expect(roundTrip(first)).toBe(first);
  });
});

/**
 * 规范化 ≠ 丢内容:这两种输入会被改写成等价的标准写法,内容一字不动,
 * 而且第二次往返就稳定了。把它们显式写下来,免得后人误以为是 bug。
 */
describe("已知规范化(内容不变,只换写法)", () => {
  it("单行块级公式被写成三行形式,内容不变", () => {
    expect(roundTrip("$$a^2 + b^2 = c^2$$")).toBe("$$\na^2 + b^2 = c^2\n$$");
  });

  it("下划线斜体被写成星号斜体", () => {
    expect(roundTrip("_斜_")).toBe("*斜*");
  });

  /**
   * 相邻的"普通项"和"任务项"在 TipTap 里是两个不同的列表节点(taskList 只
   * 接受 taskItem 子节点,混在一起会让普通项被 schema 丢掉)。写回 markdown
   * 时两段列表之间因此多一个空行 —— 这是**正确**的 markdown(两个相邻列表
   * 本来就需要空行分隔),内容没有变化。
   */
  it("普通项与任务项相邻时会拆成两个列表(内容不丢)", () => {
    const out = roundTrip("- 普通项\n- [ ] 任务项");
    expect(out).toBe("- 普通项\n\n- [ ] 任务项");
    expect(roundTrip(out)).toBe(out);
  });
});
