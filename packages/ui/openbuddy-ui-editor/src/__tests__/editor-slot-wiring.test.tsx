/**
 * editor-slot-wiring —— 编辑器三个扩展点的**端到端**接线测试。
 *
 * 与 `editor-contributions.test.ts`(纯函数)的分工:
 *   - 那边证明"坏数据被收敛";
 *   - 这边证明"插件注册 → 用户在编辑器里真的看得见":真内核
 *     (`SlotProvider` + `registerAllBuiltinUis`)、真插件桥
 *     (`installPluginSdkBridge`)、真 TipTap 实例。
 *
 * 这条链路此前是断的:三个槽位声明齐全、零消费者,插件注册进去石沉大海。
 * 因此断言落在 DOM 上,而不是"槽位里有几条 entry"。
 */
import "@testing-library/jest-dom/vitest";
import "../test-shims/prosemirror-jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import {
  SlotProvider,
  getOrCreateSingleton,
  installPluginSdkBridge,
} from "@openbuddy/ui-runtime/client";
import { TiptapEditor } from "../components/TiptapEditor";

const disposers: Array<() => void> = [];

/** 往内核里塞一条数据型贡献(等价于插件 `api.registerSlot(...)` 的效果)。 */
function contribute(name: string, payload: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      { name, kind: "list", scope: "session-maybe", registrant: "test-plugin", payload },
      null as never,
    ),
  );
}

function mountEditor() {
  let instance: Editor | null = null;
  const utils = render(
    <SlotProvider>
      <TiptapEditor
        value="<p>hi</p>"
        format="html"
        onReady={(editor) => {
          instance = editor;
        }}
      />
    </SlotProvider>,
  );
  return { ...utils, editor: () => instance as Editor | null };
}

async function readyEditor(harness: ReturnType<typeof mountEditor>) {
  await waitFor(() => expect(harness.editor()).toBeTruthy());
  return harness.editor() as Editor;
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  vi.restoreAllMocks();
});

describe("editor.toolbar 插件按钮", () => {
  it("插件注册的按钮渲染在工具栏上,点击真的执行", async () => {
    const onClick = vi.fn();
    contribute("editor.toolbar", { id: "word-count", label: "字数统计", icon: "∑", run: onClick });
    render(<SlotProvider><TiptapEditor value="<p>hi</p>" format="html" /></SlotProvider>);

    const button = await screen.findByLabelText("字数统计");
    expect(button).toHaveTextContent("∑");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("脏 payload(缺 run)不会渲染出死按钮", async () => {
    contribute("editor.toolbar", { id: "broken", label: "点不动" });
    render(<SlotProvider><TiptapEditor value="<p>hi</p>" format="html" /></SlotProvider>);

    await screen.findByLabelText("2 级标题");
    expect(screen.queryByLabelText("点不动")).not.toBeInTheDocument();
  });
});

describe("editor.slash-commands 插件命令", () => {
  it("输入 `/` 时插件命令出现在补全菜单里", async () => {
    contribute("editor.slash-commands", { id: "callout", title: "提示块", run: () => {} });
    const harness = mountEditor();
    const editor = await readyEditor(harness);

    await act(async () => {
      editor.commands.focus();
      editor.commands.insertContent("/");
    });

    await waitFor(() => expect(document.body.textContent).toContain("提示块"));
    // 内置命令必须仍在:插件是增量,不是替换。
    expect(document.body.textContent).toContain("一级标题");

    // 继续输入 query,内置项被过滤掉、插件项仍然命中。
    await act(async () => {
      editor.commands.insertContent("callout");
    });
    await waitFor(() => expect(document.body.textContent).toContain("提示块"));
    expect(document.body.textContent).not.toContain("一级标题");
  });
});

describe("editor.mention-sources 插件候选", () => {
  it("有插件来源时自动开启 `@`,并列出插件条目", async () => {
    contribute("editor.mention-sources", {
      id: "symbols",
      items: [{ id: "sym-1", label: "computeScore", detail: "函数" }],
    });
    const harness = mountEditor();
    const editor = await readyEditor(harness);

    await act(async () => {
      editor.commands.focus();
      editor.commands.insertContent(" @comp");
    });

    await waitFor(() => expect(document.body.textContent).toContain("computeScore"));
  });
});
