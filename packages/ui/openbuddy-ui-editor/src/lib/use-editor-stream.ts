/**
 * use-editor-stream —— agent 流式输出写进编辑器的受控通道。
 *
 * 抖动问题的根因:如果每个 chunk 都重新解析整篇 markdown 再 `setContent`,
 * ProseMirror 会重建文档,caret 与滚动位置每帧跳一次。
 *
 * 解法(本 hook 的核心约定):
 *   - 流式阶段:每个 chunk 以**纯文本节点**追加到光标处 —— 文档结构不变,
 *     滚动与 caret 天然稳定,渲染成本 O(chunk);
 *   - 流式结束(`finish()`):一次性把累积的 markdown 解析成 HTML 覆盖文档,
 *     拿到最终排版。用户感知是"文字先流出来,最后定型"。
 */
import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { MarkdownStreamBuffer, markdownToHtml } from "./markdown-bridge";

export interface UseEditorStreamOptions {
  /** 流式结束后解析用的格式。 */
  format?: "markdown" | "html" | "text";
  /** 流式结束时回调(宿主可用于落盘 / 触发自动保存)。 */
  onFinish?: (fullText: string) => void;
}

export interface EditorStream {
  /** 追加一个 chunk。 */
  append(chunk: string): void;
  /** 结束流式:把累积内容解析成结构化文档。 */
  finish(): void;
  /** 重置缓冲与文档。 */
  reset(initial?: string): void;
  /** 是否处于流式中。 */
  streaming: boolean;
  /** 当前累积文本。 */
  value(): string;
}

export function useEditorStream(
  editor: Editor | null,
  options: UseEditorStreamOptions = {},
): EditorStream {
  const { format = "markdown", onFinish } = options;
  const bufferRef = useRef(new MarkdownStreamBuffer());
  const [streaming, setStreaming] = useState(false);

  const append = useCallback(
    (chunk: string) => {
      if (chunk.length === 0) return;
      const full = bufferRef.current.append(chunk);
      setStreaming(true);
      if (!editor || editor.isDestroyed) return;
      // 纯文本插入:不解析 markdown,不重建文档。
      editor.commands.insertContent({ type: "text", text: chunk });
      void full;
    },
    [editor],
  );

  const finish = useCallback(() => {
    const full = bufferRef.current.value();
    setStreaming(false);
    if (editor && !editor.isDestroyed && format !== "text") {
      const html = format === "html" ? full : markdownToHtml(full);
      editor.commands.setContent(html, { emitUpdate: false });
    }
    onFinish?.(full);
  }, [editor, format, onFinish]);

  const reset = useCallback(
    (initial = "") => {
      bufferRef.current.reset(initial);
      setStreaming(false);
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent(
          initial.length > 0 ? markdownToHtml(initial) : "",
          { emitUpdate: false },
        );
      }
    },
    [editor],
  );

  return {
    append,
    finish,
    reset,
    streaming,
    value: () => bufferRef.current.value(),
  };
}
