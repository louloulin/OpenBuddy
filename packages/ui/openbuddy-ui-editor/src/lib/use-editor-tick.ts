/**
 * use-editor-tick —— 把 ProseMirror 的事务流变成 React 重渲染信号。
 *
 * 为什么不直接用 `useEditorState`(TipTap v3 自带):
 *   - 它要求传 selector 闭包,在本仓库的 React 18 + 多实例场景下容易
 *     触发无谓的比较开销;
 *   - 工具栏按钮数量少,整体重渲染比逐项 selector 更简单也更可预测。
 * 因此这里只暴露一个单调递增的 tick,组件自行读取 `editor.isActive()`。
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";

/** 订阅编辑器事务 / 选区变化,返回递增计数。 */
export function useEditorTick(editor: Editor | null): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((value) => value + 1);
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    editor.on("focus", bump);
    editor.on("blur", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("selectionUpdate", bump);
      editor.off("focus", bump);
      editor.off("blur", bump);
    };
  }, [editor]);

  return tick;
}

/** 选区是否为空(空选区的 bubble menu 不该出现)。 */
export function hasTextSelection(editor: Editor | null): boolean {
  if (!editor) return false;
  const { from, to } = editor.state.selection;
  return from !== to;
}

/** 当前选区所在 block 是否为空(floating menu 只在空行出现)。 */
export function isCurrentBlockEmpty(editor: Editor | null): boolean {
  if (!editor) return false;
  const { $from } = editor.state.selection;
  return $from.parent.content.size === 0;
}
