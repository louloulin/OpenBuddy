# @openbuddy/ui-editor

编辑层(Phase C)。基于 [TipTap](https://tiptap.dev/) 的富文本 / Markdown
编辑器,与只读渲染层 `@openbuddy/ui-markdown` 通过纯函数桥 `markdown-bridge`
对接。

## 为什么是"两个编辑器路径"

OpenBuddy 的会话正文有两条路径,刻意不合并:

| 场景 | 组件 | 理由 |
| --- | --- | --- |
| 只读 / 流式渲染 | `@openbuddy/ui-markdown`(react-markdown) | agent 流式输出不能经过文档模型,否则 caret 与滚动每帧抖动 |
| 结构化编辑 | 本包 `TiptapEditor` | 表格 / 任务列表 / 图表 / 公式需要真实的文档树 |

两者通过 `markdownToHtml` / `htmlToMarkdown` 互转,并且保证 markdown 往返
幂等(见 `src/__tests__/markdown-bridge.test.ts` 的 round-trip 用例)。

## 安装与引入

```ts
// 组件
import { TiptapEditor } from "@openbuddy/ui-editor";

// 槽位注册入口(由 @openbuddy/ui-runtime 调用)
import { apply } from "@openbuddy/ui-editor/client";

// 编辑器正文排版样式(含 KaTeX CSS),在应用入口引入一次
import "@openbuddy/ui-editor/styles";
```

## 快速上手

```tsx
import { useState } from "react";
import { TiptapEditor } from "@openbuddy/ui-editor";

export function NotePanel() {
  const [markdown, setMarkdown] = useState("# 标题\n\n开始写吧");
  return (
    <TiptapEditor
      value={markdown}
      format="markdown"
      placeholder="输入 / 调出命令"
      onChange={setMarkdown}
      onRequestLink={(current) => window.prompt("链接", current ?? "https://")}
    />
  );
}
```

## 流式写入(agent 生成进编辑器)

```tsx
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { TiptapEditor, useEditorStream } from "@openbuddy/ui-editor";

export function StreamingDoc() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const stream = useEditorStream(editor, { onFinish: (full) => save(full) });

  return (
    <>
      <button onClick={() => stream.reset()}>重新生成</button>
      <TiptapEditor value="" onReady={setEditor} />
      {/* pi 事件循环里:stream.append(chunk);流结束:stream.finish(); */}
    </>
  );
}
```

`append()` 阶段只插入**纯文本节点**,因此文档结构不变、滚动与 caret 稳定;
`finish()` 时一次性把累积 markdown 解析成结构化文档定型。这是"流式 paste
长 markdown 不抖动"的实现方式,测试见 `src/__tests__/TiptapEditor.test.tsx`。

## 扩展裁剪

```tsx
<TiptapEditor
  extensions={{
    table: { rows: 3, cols: 3 },  // false = 关闭
    math: true,                    // KaTeX 行内 / 块级公式
    mermaid: true,                 // ```mermaid 图表节点
    allowImages: true,             // 需要图片节点时开启
    codeHighlight: true,           // lowlight 语法高亮
  }}
  mention={{ getItems: (query) => searchWorkspace(query) }}
/>
```

`buildEditorExtensions()` 是纯函数,同样的 options 得到同样的扩展顺序,
因此"某些扩展在 / 不在"可以单测(见 `src/__tests__/editor-core.test.ts`)。

## 槽位

| 槽位 | kind | scope | payload | 说明 |
| --- | --- | --- | --- | --- |
| `editor.body` | single | session-maybe | 组件 | 编辑器主体,默认注册 `TiptapEditor` |
| `editor.toolbar` | list | session-maybe | `EditorToolbarAction` | 工具栏追加按钮(内置按钮恒在) |
| `editor.slash-commands` | list | session-maybe | `EditorSlashCommandContribution` | `/` 菜单追加命令(内置命令恒在) |
| `editor.mention-sources` | list | session-maybe | `EditorMentionSource` | `@` 候选来源;有来源时自动开启 `@` |

三个扩展点都由 **`TiptapEditor` 自己消费**(`src/lib/use-editor-slots.ts`),
所以插件"注册即可见",宿主不需要认识编辑器内部类型。缺内核(单测 / 独立
挂载)时退化为空集,编辑器仍完整可用。

### 插件贡献示例

```ts
import { defineExtension } from "@openbuddy/plugin-sdk";

export default defineExtension({
  manifest: { name: "word-count", version: "1.0.0", description: "字数统计" },
  setup(api) {
    api.registerSlot("editor.toolbar", "list", "root", {
      id: "word-count",
      label: "字数统计",
      icon: "#",
      run: (editor) => alert(editor.getText().length),
    });
    api.registerSlot("editor.slash-commands", "list", "root", {
      id: "callout",
      title: "提示块",
      group: "插件",
      run: ({ editor }) => editor.chain().focus().insertContent("> 提示\n").run(),
    });
    api.registerSlot("editor.mention-sources", "list", "root", {
      id: "symbols",
      getItems: (query) => myIndex.search(query),
    });
  },
});
```

契约细节:贡献命令与内置命令 **id 撞名时内置优先**;`run` 执行前 `/xxx`
区间已被删除;`run` / `isActive` / `isDisabled` 抛错会被吞掉,不会弄炸编辑器。

## 代码高亮为什么不用 `@tiptap/extension-code-block-lowlight`

该扩展从自己的包目录 `import "highlight.js/lib/core"`,在 pnpm 的严格隔离下
会解析到仓库根部的 `highlight.js@10`(没有 `exports` 子路径映射),Node ESM
无法解析无扩展名子路径,直接启动失败。本包改为自己实现低亮装饰插件
(`src/extensions/code-highlight.ts`),只依赖 `lowlight`,少一层包耦合。

## 测试

```bash
pnpm vitest run --config vitest.config.ts packages/ui/openbuddy-ui-editor
```

- `markdown-bridge.test.ts` — 往返幂等 + 流式缓冲 + 外部值同步判据
- `slash-command.test.ts` / `mention.test.ts` — 触发探测与过滤排序
- `suggestion-popup.test.ts` — 浮层定位与生命周期
- `editor-core.test.ts` — headless Editor 上的扩展装配与命令映射
- `editor-contributions.test.ts` — 三个扩展点的纯逻辑(去重 / 容错 / 默认值)
- `editor-slot-wiring.test.tsx` — 真内核 + 真插件桥:插件注册 → 界面上可见
- `TiptapEditor.test.tsx` / `EditorToolbar.test.tsx` / `SuggestionMenu.test.tsx` / `MermaidNodeView.test.tsx` — React 交互

jsdom 缺少 `Range.getClientRects`,会让 ProseMirror 的 `coordsAtPos` 抛错;
测试通过 `src/test-shims/prosemirror-jsdom.ts` 补零矩形(线上 Chromium 无此问题)。
