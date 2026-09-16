/**
 * 编辑器内核单测 —— 用 headless `Editor`(不渲染 React)验证:
 *   1. 扩展装配的选择性(开关真的生效);
 *   2. `/` 命令 → 文档结构的映射;
 *   3. markdown-bridge 产出的 HTML 能被真实 schema 解析(这是"打开
 *      编辑器不丢内容"的关键,比字符串相等更有说服力)。
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "../extensions";
import { applySlashCommand } from "../extensions/apply-slash-command";
import { markdownToHtml, htmlToMarkdown } from "../lib/markdown-bridge";
import { DEFAULT_SLASH_COMMANDS } from "../lib/slash-command";

const editors: Editor[] = [];

function createEditor(content = "", options: Parameters<typeof buildEditorExtensions>[0] = {}) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions(options),
    content,
  });
  editors.push(editor);
  return editor;
}

function commandById(id: string) {
  const found = DEFAULT_SLASH_COMMANDS.find((command) => command.id === id);
  if (!found) throw new Error(`missing command ${id}`);
  return found;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe("buildEditorExtensions", () => {
  it("默认包含公式与图表节点", () => {
    const editor = createEditor();
    expect(editor.schema.nodes.blockMath).toBeDefined();
    expect(editor.schema.nodes.mermaidBlock).toBeDefined();
    expect(editor.schema.nodes.table).toBeDefined();
    expect(editor.schema.nodes.taskList).toBeDefined();
  });

  it("table=false 时不注册表格", () => {
    const editor = createEditor("", { table: false });
    expect(editor.schema.nodes.table).toBeUndefined();
  });

  it("allowImages=false 时不注册图片", () => {
    expect(createEditor().schema.nodes.image).toBeUndefined();
    expect(createEditor("", { allowImages: true }).schema.nodes.image).toBeDefined();
  });

  it("math/mermaid 可单独关闭", () => {
    const editor = createEditor("", { math: false, mermaid: false });
    expect(editor.schema.nodes.blockMath).toBeUndefined();
    expect(editor.schema.nodes.mermaidBlock).toBeUndefined();
  });

  it("placeholder 开关生效", () => {
    expect(createEditor().extensionManager.extensions.some((e) => e.name === "placeholder")).toBe(false);
    expect(
      createEditor("", { placeholder: "写点什么" }).extensionManager.extensions.some(
        (e) => e.name === "placeholder",
      ),
    ).toBe(true);
  });

  it("slashCommands=false 时不注册命令扩展", () => {
    const editor = createEditor("", { slashCommands: false });
    expect(editor.extensionManager.extensions.some((e) => e.name === "slashCommand")).toBe(false);
  });

  it("mention 配置后才注册 mention 节点", () => {
    expect(createEditor().schema.nodes.mention).toBeUndefined();
    const editor = createEditor("", { mention: { getItems: () => [] } });
    expect(editor.schema.nodes.mention).toBeDefined();
  });
});

describe("markdown 解析进真实 schema", () => {
  it("标题 / 列表 / 表格 / 任务列表 都能被解析", () => {
    const editor = createEditor(
      markdownToHtml("# 标题\n\n- a\n- b\n\n- [ ] x\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"),
    );
    const json = editor.getJSON();
    const types: string[] = [];
    const walk = (node: { type?: string; content?: unknown[] }) => {
      if (node.type) types.push(node.type);
      (node.content ?? []).forEach((child) => walk(child as { type?: string }));
    };
    walk(json as { type?: string; content?: unknown[] });
    expect(types).toContain("heading");
    expect(types).toContain("bulletList");
    expect(types).toContain("taskList");
    expect(types).toContain("table");
    expect(types).toContain("tableHeader");
  });

  it("图表与公式节点带完整属性", () => {
    const editor = createEditor(
      markdownToHtml("```mermaid\ngraph TD\nA-->B\n```\n\n$$\nE = mc^2\n$$"),
    );
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain("graph TD\\nA-->B");
    expect(json).toContain("E = mc^2");
  });

  it("行内公式 round-trip 回 markdown", () => {
    const editor = createEditor(markdownToHtml("行内 $x^2$ 公式"));
    expect(htmlToMarkdown(editor.getHTML())).toBe("行内 $x^2$ 公式");
  });

  it("未知 HTML 被 schema 丢弃而不是抛错", () => {
    expect(() => createEditor("<p>ok</p><weird><span>x</span></weird>")).not.toThrow();
  });
});

describe("applySlashCommand", () => {
  it("h2 把段落变成二级标题", () => {
    const editor = createEditor("<p>/h2</p>");
    // 模拟 suggestion:把整段替换掉。
    editor.commands.setContent("<p>heading text</p>");
    const ok = applySlashCommand(editor, commandById("h2"), { from: 1, to: 3 });
    expect(ok).toBe(true);
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
  });

  it("三种列表命令", () => {
    for (const [id, type] of [
      ["bullet", "bulletList"],
      ["ordered", "orderedList"],
      ["task", "taskList"],
    ] as const) {
      const editor = createEditor("<p>item</p>");
      expect(applySlashCommand(editor, commandById(id), { from: 1, to: 2 })).toBe(true);
      expect(editor.isActive(type)).toBe(true);
      editor.destroy();
    }
  });

  it("表格使用指定尺寸且带表头", () => {
    const editor = createEditor("<p>t</p>");
    applySlashCommand(editor, commandById("table"), { from: 1, to: 2 }, { tableSize: { rows: 2, cols: 4 } });
    const table = JSON.stringify(editor.getJSON());
    const json = editor.getJSON() as { content?: Array<{ type: string; content?: unknown[] }> };
    const tableNode = json.content?.find((node) => node.type === "table");
    expect(tableNode).toBeDefined();
    expect(table.length).toBeGreaterThan(0);
    expect(editor.isActive("table")).toBe(true);
  });

  it("mermaid 命令插入带默认源码的图表节点", () => {
    const editor = createEditor("<p>m</p>");
    expect(applySlashCommand(editor, commandById("mermaid"), { from: 1, to: 2 })).toBe(true);
    const json = editor.getJSON() as { content?: Array<{ type: string; attrs?: { code?: string } }> };
    const node = json.content?.find((n) => n.type === "mermaidBlock");
    expect(node?.attrs?.code).toContain("graph TD");
  });

  it("mermaid 命令可自定义源码", () => {
    const editor = createEditor("<p>m</p>");
    applySlashCommand(editor, commandById("mermaid"), { from: 1, to: 2 }, { mermaidCode: "graph LR\nX-->Y" });
    expect(JSON.stringify(editor.getJSON())).toContain("graph LR");
  });

  it("math 命令插入块级公式", () => {
    const editor = createEditor("<p>f</p>");
    expect(applySlashCommand(editor, commandById("math"), { from: 1, to: 2 })).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toContain("blockMath");
  });

  it("图片命令在没有宿主能力时是 no-op(不插坏图)", () => {
    const editor = createEditor("<p>i</p>", { allowImages: true });
    const before = editor.getHTML();
    expect(applySlashCommand(editor, commandById("image"), { from: 1, to: 2 })).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("图片命令在宿主提供 URL 时插入图片", () => {
    const editor = createEditor("<p>i</p>", { allowImages: true });
    const ok = applySlashCommand(editor, commandById("image"), { from: 1, to: 2 }, {
      requestImageUrl: () => "data:image/png;base64,AAAA",
    });
    expect(ok).toBe(true);
    expect(editor.getHTML()).toContain("<img");
  });

  it("未知命令返回 false 且不改文档", () => {
    const editor = createEditor("<p>x</p>");
    const before = editor.getHTML();
    const ok = applySlashCommand(
      editor,
      { id: "nope", title: "?", kind: "block", icon: "?", group: "g" },
      { from: 1, to: 2 },
    );
    expect(ok).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("divider / quote / code 命令", () => {
    const divider = createEditor("<p>d</p>");
    expect(applySlashCommand(divider, commandById("divider"), { from: 1, to: 2 })).toBe(true);
    expect(divider.getHTML()).toContain("<hr");

    const quote = createEditor("<p>q</p>");
    expect(applySlashCommand(quote, commandById("quote"), { from: 1, to: 2 })).toBe(true);
    expect(quote.isActive("blockquote")).toBe(true);

    const code = createEditor("<p>c</p>");
    expect(applySlashCommand(code, commandById("code"), { from: 1, to: 2 })).toBe(true);
    expect(code.isActive("codeBlock")).toBe(true);
  });
});
