/**
 * EditorToolbar / BubbleToolbar / FloatingToolbar 单测。
 *
 * 用 headless `Editor` 驱动(不经过 TiptapEditor),这样断言直接落在
 * "点了按钮文档变成什么样"上,与真实交互等价。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorToolbar } from "../components/EditorToolbar";
import { BubbleToolbar } from "../components/BubbleToolbar";
import { FloatingToolbar } from "../components/FloatingToolbar";
import { buildEditorExtensions } from "../extensions";

const editors: Editor[] = [];

function makeEditor(content = "<p>hello</p>") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildEditorExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

/**
 * 选中一段文本。必须先 focus —— 气泡菜单的显示条件之一是"编辑器聚焦",
 * 这是产品行为(未聚焦时不该弹出行内格式条),不是测试妥协。
 */
async function selectText(editor: Editor, from: number, to: number) {
  await act(async () => {
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to });
  });
}

describe("EditorToolbar", () => {
  it("editor 为 null 时不渲染", () => {
    const { container } = render(<EditorToolbar editor={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("渲染撤销 / 重做 / 标题 / 列表 / 表格 / 图表 / 公式 按钮", () => {
    render(<EditorToolbar editor={makeEditor()} />);
    for (const label of [
      "撤销",
      "重做",
      "1 级标题",
      "2 级标题",
      "3 级标题",
      "无序列表",
      "有序列表",
      "任务列表",
      "引用",
      "代码块",
      "插入表格",
      "插入 Mermaid 图表",
      "插入公式",
      "分隔线",
      "左对齐",
      "居中",
      "右对齐",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("hidden 列表可裁剪按钮", () => {
    render(<EditorToolbar editor={makeEditor()} hidden={["h1", "divider", "align"]} />);
    expect(screen.queryByLabelText("1 级标题")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("分隔线")).not.toBeInTheDocument();
    expect(screen.getByLabelText("2 级标题")).toBeInTheDocument();
  });

  it("features.table=false 时隐藏表格按钮", () => {
    render(<EditorToolbar editor={makeEditor()} features={{ table: false }} />);
    expect(screen.queryByLabelText("插入表格")).not.toBeInTheDocument();
  });

  it("点击 H2 把段落改成二级标题", async () => {
    const editor = makeEditor("<p>text</p>");
    render(<EditorToolbar editor={editor} />);
    await act(async () => {
      screen.getByLabelText("2 级标题").click();
    });
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
  });

  it("点击无序列表切换 bulletList", async () => {
    const editor = makeEditor("<p>text</p>");
    render(<EditorToolbar editor={editor} />);
    await act(async () => {
      screen.getByLabelText("无序列表").click();
    });
    expect(editor.isActive("bulletList")).toBe(true);
  });

  it("active 态随编辑器状态更新", async () => {
    const editor = makeEditor("<h2>t</h2>");
    render(<EditorToolbar editor={editor} />);
    await waitFor(() => {
      expect(screen.getByLabelText("2 级标题")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("只读时按钮 disabled", () => {
    const editor = makeEditor();
    editor.setEditable(false);
    render(<EditorToolbar editor={editor} />);
    expect(screen.getByLabelText("2 级标题")).toBeDisabled();
    expect(screen.getByLabelText("插入表格")).toBeDisabled();
  });

  it("trailing 插槽渲染在最右", () => {
    render(<EditorToolbar editor={makeEditor()} trailing={<span data-testid="trail">保存</span>} />);
    expect(screen.getByTestId("trail")).toBeInTheDocument();
  });

  it("表格按钮使用传入的尺寸", async () => {
    const editor = makeEditor("<p>t</p>");
    render(<EditorToolbar editor={editor} tableSize={{ rows: 2, cols: 1 }} />);
    await act(async () => {
      screen.getByLabelText("插入表格").click();
    });
    expect(editor.isActive("table")).toBe(true);
  });
});

describe("BubbleToolbar", () => {
  it("无选区时不渲染", () => {
    const editor = makeEditor();
    render(<BubbleToolbar editor={editor} />);
    expect(screen.queryByLabelText("加粗")).not.toBeInTheDocument();
  });

  it("disabled 时不渲染", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection({ from: 1, to: 4 });
    render(<BubbleToolbar editor={editor} disabled />);
    expect(screen.queryByLabelText("加粗")).not.toBeInTheDocument();
  });

  it("有选区时渲染行内格式按钮", async () => {
    const editor = makeEditor();
    render(<BubbleToolbar editor={editor} />);
    await selectText(editor, 1, 4);
    await waitFor(() => {
      expect(screen.getByLabelText("加粗")).toBeInTheDocument();
    });
    for (const label of ["斜体", "下划线", "删除线", "行内代码", "高亮", "链接", "清除格式"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("点击加粗给选区加粗", async () => {
    const editor = makeEditor();
    render(<BubbleToolbar editor={editor} />);
    await selectText(editor, 1, 4);
    await waitFor(() => expect(screen.getByLabelText("加粗")).toBeInTheDocument());
    await act(async () => {
      screen.getByLabelText("加粗").click();
    });
    expect(editor.isActive("bold")).toBe(true);
  });

  it("链接按钮走宿主提供的选择器", async () => {
    const editor = makeEditor();
    const onRequestLink = vi.fn().mockResolvedValue("https://openbuddy.dev");
    render(<BubbleToolbar editor={editor} onRequestLink={onRequestLink} />);
    await selectText(editor, 1, 4);
    await waitFor(() => expect(screen.getByLabelText("链接")).toBeInTheDocument());
    await act(async () => {
      screen.getByLabelText("链接").click();
    });
    await waitFor(() => {
      expect(editor.getHTML()).toContain("https://openbuddy.dev");
    });
  });

  it("空链接地址会移除已有链接", async () => {
    const editor = makeEditor('<p><a href="https://a.dev">link</a></p>');
    render(<BubbleToolbar editor={editor} onRequestLink={() => ""} />);
    await selectText(editor, 1, 5);
    await waitFor(() => expect(screen.getByLabelText("链接")).toBeInTheDocument());
    await act(async () => {
      screen.getByLabelText("链接").click();
    });
    await waitFor(() => {
      expect(editor.getHTML()).not.toContain("<a ");
    });
  });

  it("extra 插槽追加按钮", async () => {
    const editor = makeEditor();
    render(<BubbleToolbar editor={editor} extra={<button type="button">自定义</button>} />);
    await selectText(editor, 1, 4);
    await waitFor(() => expect(screen.getByText("自定义")).toBeInTheDocument());
  });
});

describe("FloatingToolbar", () => {
  it("非空段落不渲染", () => {
    const editor = makeEditor("<p>hello</p>");
    render(<FloatingToolbar editor={editor} />);
    expect(screen.queryByLabelText("表格")).not.toBeInTheDocument();
  });

  it("空段落且聚焦时渲染插入菜单", async () => {
    const editor = makeEditor("<p></p>");
    render(<FloatingToolbar editor={editor} />);
    await act(async () => {
      editor.commands.focus();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("表格")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Mermaid 图表")).toBeInTheDocument();
    expect(screen.getByLabelText("公式")).toBeInTheDocument();
  });

  it("点击图表按钮插入 mermaidBlock", async () => {
    const editor = makeEditor("<p></p>");
    render(<FloatingToolbar editor={editor} />);
    await act(async () => {
      editor.commands.focus();
    });
    await waitFor(() => expect(screen.getByLabelText("Mermaid 图表")).toBeInTheDocument());
    await act(async () => {
      screen.getByLabelText("Mermaid 图表").click();
    });
    expect(JSON.stringify(editor.getJSON())).toContain("mermaidBlock");
  });

  it("onInsertImage 存在时才渲染图片按钮", async () => {
    const editor = makeEditor("<p></p>");
    const { rerender } = render(<FloatingToolbar editor={editor} />);
    await act(async () => {
      editor.commands.focus();
    });
    await waitFor(() => expect(screen.getByLabelText("表格")).toBeInTheDocument());
    expect(screen.queryByLabelText("图片")).not.toBeInTheDocument();

    const onInsertImage = vi.fn();
    rerender(<FloatingToolbar editor={editor} onInsertImage={onInsertImage} />);
    await waitFor(() => expect(screen.getByLabelText("图片")).toBeInTheDocument());
    screen.getByLabelText("图片").click();
    expect(onInsertImage).toHaveBeenCalled();
  });
});
