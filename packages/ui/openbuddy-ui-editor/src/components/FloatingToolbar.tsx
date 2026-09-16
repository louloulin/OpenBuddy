/**
 * FloatingToolbar —— 空行上浮现的"插入块"菜单。
 *
 * 只在"当前 block 为空 + 编辑器聚焦"时出现,避免干扰正常输入。
 * 内容与工具栏的结构性按钮保持一致,但只保留真正高频的插入动作。
 */
import type { Editor } from "@tiptap/core";
import { useMemo, type ReactNode } from "react";
import { EditorPopup } from "./EditorPopup";
import { ToolbarButton } from "./ToolbarButton";
import { isCurrentBlockEmpty, useEditorTick } from "../lib/use-editor-tick";
import type { RectLike } from "../lib/suggestion-popup";

export interface FloatingToolbarProps {
  editor: Editor | null;
  extra?: ReactNode;
  disabled?: boolean;
  features?: { table?: boolean; mermaid?: boolean; math?: boolean };
  tableSize?: { rows: number; cols: number };
  /** 插入图片(宿主提供选择器)。 */
  onInsertImage?: () => void;
}

/** 空行锚点矩形(取光标位置)。 */
export function emptyBlockRect(editor: Editor | null): RectLike | null {
  if (!editor) return null;
  try {
    const { from } = editor.state.selection;
    return editor.view.coordsAtPos(from);
  } catch {
    return null;
  }
}

export function FloatingToolbar({
  editor,
  extra,
  disabled,
  features = { table: true, mermaid: true, math: true },
  tableSize = { rows: 3, cols: 3 },
  onInsertImage,
}: FloatingToolbarProps) {
  const tick = useEditorTick(editor);
  const rect = useMemo(() => emptyBlockRect(editor), [editor, tick]);

  const visible =
    !disabled &&
    Boolean(editor) &&
    Boolean(editor?.isEditable) &&
    Boolean(editor?.isFocused) &&
    isCurrentBlockEmpty(editor);

  if (!visible || !editor) return null;

  return (
    <EditorPopup
      visible
      rect={rect}
      role="menu"
      ariaLabel="插入内容"
      className="ob-editor-floating"
    >
      {features.table ? (
        <ToolbarButton
          label="表格"
          onClick={() => editor.chain().focus().insertTable({ ...tableSize, withHeaderRow: true }).run()}
        >
          ▦
        </ToolbarButton>
      ) : null}
      {features.mermaid ? (
        <ToolbarButton
          label="Mermaid 图表"
          onClick={() => editor.chain().focus().setMermaidBlock().run()}
        >
          ◇
        </ToolbarButton>
      ) : null}
      {features.math ? (
        <ToolbarButton
          label="公式"
          onClick={() => editor.chain().focus().insertContent({ type: "blockMath", attrs: { latex: "E = mc^2" } }).run()}
        >
          ∑
        </ToolbarButton>
      ) : null}
      <ToolbarButton label="代码块" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"{ }"}
      </ToolbarButton>
      <ToolbarButton label="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        ❝
      </ToolbarButton>
      {onInsertImage ? (
        <ToolbarButton label="图片" onClick={onInsertImage}>
          ▣
        </ToolbarButton>
      ) : null}
      {extra}
    </EditorPopup>
  );
}
