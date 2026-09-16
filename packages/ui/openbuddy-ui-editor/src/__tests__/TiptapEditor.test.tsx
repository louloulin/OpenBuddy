/**
 * TiptapEditor 单测 —— 受控同步、只读模式、流式写入(不抖动路径)。
 *
 * jsdom 没有真实布局,`coordsAtPos` 会返回 0 矩形;因此气泡 / 悬浮菜单的
 * 断言只验证"该出现时出现",不验证像素位置(定位算法已由
 * suggestion-popup.test.ts 单测覆盖)。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { TiptapEditor, fromEditorHtml, toEditorHtml } from "../components/TiptapEditor";
import { useEditorStream } from "../lib/use-editor-stream";

/** 从 onReady 捕获编辑器实例的最小 harness。 */
function mount(props: Partial<Parameters<typeof TiptapEditor>[0]> = {}) {
  let instance: Editor | null = null;
  const utils = render(
    <TiptapEditor
      {...props}
      onReady={(editor) => {
        instance = editor;
        props.onReady?.(editor);
      }}
    />,
  );
  return {
    ...utils,
    editor: () => {
      if (!instance) throw new Error("editor not ready");
      return instance;
    },
  };
}

/** 等编辑器实例就绪。 */
async function ready(harness: ReturnType<typeof mount>) {
  await waitFor(() => expect(harness.editor()).toBeTruthy());
  return harness.editor();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toEditorHtml / fromEditorHtml", () => {
  it("markdown 格式双向转换", () => {
    expect(toEditorHtml("# h", "markdown")).toBe("<h1>h</h1>");
    expect(fromEditorHtml("<h1>h</h1>", "markdown")).toBe("# h");
  });

  it("html 格式原样透传", () => {
    expect(toEditorHtml("<p>x</p>", "html")).toBe("<p>x</p>");
    expect(fromEditorHtml("<p>x</p>", "html")).toBe("<p>x</p>");
  });
});

describe("TiptapEditor", () => {
  it("渲染初始 markdown 内容", async () => {
    mount({ value: "# 标题\n\n正文" });
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("正文")).toBeInTheDocument();
  });

  it("默认渲染工具栏与无障碍标签", async () => {
    mount();
    await waitFor(() => {
      expect(screen.getByRole("toolbar", { name: "编辑器工具栏" })).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "编辑器" })).toBeInTheDocument();
  });

  it("toolbar=false 时不渲染工具栏", async () => {
    mount({ toolbar: false });
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
    expect(screen.queryByRole("toolbar", { name: "编辑器工具栏" })).not.toBeInTheDocument();
  });

  it("toolbar 传入自定义节点时替换默认工具栏", async () => {
    mount({ toolbar: <div data-testid="custom-toolbar" /> });
    await waitFor(() => {
      expect(screen.getByTestId("custom-toolbar")).toBeInTheDocument();
    });
    expect(screen.queryByRole("toolbar", { name: "编辑器工具栏" })).not.toBeInTheDocument();
  });

  it("onChange 在文档变化时回传 markdown", async () => {
    const onChange = vi.fn();
    const harness = mount({ onChange, value: "" });
    const editor = await ready(harness);
    await act(async () => {
      editor.commands.setContent("<h2>新内容</h2>");
    });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("## 新内容");
  });

  it("外部 value 在未聚焦时写回", async () => {
    const harness = mount({ value: "第一版" });
    const editor = await ready(harness);
    harness.rerender(<TiptapEditor value="第二版" onReady={harness.editor} />);
    await waitFor(() => {
      expect(editor.getText()).toContain("第二版");
    });
  });

  it("编辑器自己发出的值不会引发回声写回", async () => {
    const harness = mount({ value: "" });
    const editor = await ready(harness);
    await act(async () => {
      editor.commands.setContent("<p>用户输入</p>");
    });
    const htmlBefore = editor.getHTML();
    harness.rerender(<TiptapEditor value={fromEditorHtml(htmlBefore, "markdown")} onReady={harness.editor} />);
    expect(editor.getHTML()).toBe(htmlBefore);
  });

  it("editable=false 时同步到编辑器实例", async () => {
    const harness = mount({ editable: false });
    const editor = await ready(harness);
    await waitFor(() => {
      expect(editor.isEditable).toBe(false);
    });
    harness.rerender(<TiptapEditor editable onReady={harness.editor} />);
    await waitFor(() => {
      expect(editor.isEditable).toBe(true);
    });
  });

  it("footer 渲染在编辑器下方", async () => {
    mount({ footer: <span data-testid="foot">12 字</span> });
    await waitFor(() => {
      expect(screen.getByTestId("foot")).toBeInTheDocument();
    });
  });

  it("data-editable 反映只读状态", async () => {
    const { container } = mount({ editable: false });
    await waitFor(() => {
      expect(container.querySelector('[data-editable="false"]')).toBeTruthy();
    });
  });
});

describe("useEditorStream", () => {
  /**
   * 宿主形态的 harness:在宿主组件里持有 editor 状态,把同一个实例同时
   * 交给 TiptapEditor(onReady)与 useEditorStream(editor)。这与真实宿主
   * (文档面板 / 笔记页)的写法一致,避免测试自造一套不存在的绑定方式。
   */
  function StreamHost({
    onStream,
    onChange,
  }: {
    onStream: (stream: ReturnType<typeof useEditorStream>) => void;
    onChange?: (value: string, editor: Editor) => void;
  }) {
    const [editor, setEditor] = useState<Editor | null>(null);
    const stream = useEditorStream(editor);
    onStream(stream);
    return <TiptapEditor value="" onChange={onChange} onReady={setEditor} />;
  }

  async function mountStream(onChange?: (value: string, editor: Editor) => void) {
    let stream: ReturnType<typeof useEditorStream> | null = null;
    const utils = render(<StreamHost onStream={(next) => (stream = next)} onChange={onChange} />);
    await waitFor(() => expect(stream).not.toBeNull());
    return {
      ...utils,
      stream: () => stream as ReturnType<typeof useEditorStream>,
      editor: () => {
        // 通过 DOM 找到 ProseMirror 实例对应的 TiptapEditor 内部 editor:
        // 这里改用 getText 断言,因此只需返回渲染出来的 textbox 容器。
        return document.querySelector(".ProseMirror") as HTMLElement;
      },
    };
  }

  it("流式追加阶段只插纯文本(文档不重建,无 caret 抖动)", async () => {
    const harness = await mountStream();
    await act(async () => {
      harness.stream().append("# 标题\n");
    });
    await act(async () => {
      harness.stream().append("正文 **粗体**");
    });

    const dom = harness.editor();
    expect(dom.textContent).toContain("正文 **粗体**");
    // 关键断言:流式阶段没有解析成 h1 —— 结构只在 finish() 时一次性定型。
    expect(dom.querySelector("h1")).toBeNull();
    expect(harness.stream().streaming).toBe(true);
  });

  it("finish() 一次性把累积 markdown 定型为结构化文档", async () => {
    const harness = await mountStream();
    await act(async () => {
      harness.stream().append("# 标题\n\n正文 **粗体**");
    });
    await act(async () => {
      harness.stream().finish();
    });

    const dom = harness.editor();
    expect(dom.querySelector("h1")?.textContent).toBe("标题");
    expect(dom.querySelector("strong")?.textContent).toBe("粗体");
    expect(harness.stream().streaming).toBe(false);
  });

  it("finish() 回调拿到完整文本", async () => {
    const finished: string[] = [];
    function Host() {
      const [editor, setEditor] = useState<Editor | null>(null);
      const stream = useEditorStream(editor, { onFinish: (full) => finished.push(full) });
      (Host as unknown as { stream?: ReturnType<typeof useEditorStream> }).stream = stream;
      return <TiptapEditor value="" onReady={setEditor} />;
    }
    render(<Host />);
    await waitFor(() => expect((Host as unknown as { stream?: unknown }).stream).toBeDefined());
    const stream = (Host as unknown as { stream: ReturnType<typeof useEditorStream> }).stream;
    await act(async () => {
      stream.append("abc");
    });
    await act(async () => {
      stream.finish();
    });
    expect(finished).toEqual(["abc"]);
  });

  it("reset 清空文档与缓冲", async () => {
    const harness = await mountStream();
    await act(async () => {
      harness.stream().append("abc");
    });
    await act(async () => {
      harness.stream().reset();
    });
    expect(harness.stream().value()).toBe("");
    expect(harness.editor().textContent).toBe("");
  });

  it("reset 可以带初始内容", async () => {
    const harness = await mountStream();
    await act(async () => {
      harness.stream().reset("# 初始");
    });
    expect(harness.editor().querySelector("h1")?.textContent).toBe("初始");
    expect(harness.stream().value()).toBe("# 初始");
  });

  it("空 chunk 不改变 streaming 状态", async () => {
    const harness = await mountStream();
    await act(async () => {
      harness.stream().append("");
    });
    expect(harness.stream().streaming).toBe(false);
  });

  it("流式期间 onChange 也会触发(宿主可做实时字数统计)", async () => {
    const onChange = vi.fn();
    const harness = await mountStream(onChange);
    await act(async () => {
      harness.stream().append("text");
    });
    expect(onChange).toHaveBeenCalled();
  });
});
