/**
 * markdown 画布承载 —— 源码 textarea + 实时预览。
 *
 * 首版不上 Tiptap:它带来一整条 ProseMirror 依赖图,而画布的 markdown 场景
 * 是"长文档改写",纯文本编辑 + 预览已经够用,等真需要富文本块级操作再换。
 * 改动经 `onChange` 回到 store,防抖写修订历史由上层负责。
 */
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@openbuddy/ui-markdown";
import type { CanvasTab } from "@openbuddy/ui-state/canvas-store";
import { useT } from "@openbuddy/ui-locale/client";

export interface CanvasMarkdownEditorProps {
  tab: CanvasTab;
  onChange?(content: string): void;
}

export function CanvasMarkdownEditor({ tab, onChange }: CanvasMarkdownEditorProps) {
  const sourceLabel = useT("conversation.canvas.sourceLabel");
  const [draft, setDraft] = useState(tab.content ?? "");
  // 只在**切 tab** 时重置草稿。依赖 tab.content 会在每次 onChange 回写 store 后
  // 触发 effect,把用户正在输入的内容重置掉(光标跳回开头)。
  const lastCanvasId = useRef(tab.canvasId);
  useEffect(() => {
    if (lastCanvasId.current === tab.canvasId) return;
    lastCanvasId.current = tab.canvasId;
    setDraft(tab.content ?? "");
  }, [tab.canvasId, tab.content]);

  return (
    <div className="canvas-markdown" data-testid="canvas-markdown">
      <textarea
        className="canvas-markdown__source"
        data-testid="canvas-markdown-source"
        aria-label={sourceLabel}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event.target.value);
        }}
      />
      <div className="canvas-markdown__preview" data-testid="canvas-markdown-preview">
        <Markdown>{draft}</Markdown>
      </div>
    </div>
  );
}

export default CanvasMarkdownEditor;
