/**
 * BubbleToolbar —— 选中文本时贴在选区上方的行内格式菜单。
 *
 * 显示条件(三个都满足):
 *   1. 编辑器可编辑且聚焦;
 *   2. 选区非空;
 *   3. 不处于代码块 / 图表这样的原子块内(那些块有自己的编辑方式)。
 */
import type { Editor } from "@tiptap/core";
import { useMemo, type ReactNode } from "react";
import { EditorPopup } from "./EditorPopup";
import { ToolbarButton } from "./ToolbarButton";
import { hasTextSelection, useEditorTick } from "../lib/use-editor-tick";
import type { RectLike } from "../lib/suggestion-popup";

export interface BubbleToolbarProps {
  editor: Editor | null;
  /** 追加按钮(宿主插槽)。 */
  extra?: ReactNode;
  /** 强制隐藏(如移动端窄屏)。 */
  disabled?: boolean;
  /** 链接按钮点击:宿主弹输入框;未提供则用 prompt 兜底。 */
  onRequestLink?: (currentHref: string | null) => string | null | Promise<string | null>;
}

/** 从当前选区算出锚点矩形;jsdom 与无布局环境下返回 null。 */
export function selectionRect(editor: Editor | null): RectLike | null {
  if (!editor) return null;
  const { from, to } = editor.state.selection;
  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    };
  } catch {
    return null;
  }
}

export function BubbleToolbar({ editor, extra, disabled, onRequestLink }: BubbleToolbarProps) {
  const tick = useEditorTick(editor);
  // tick 变化代表选区/文档变了,锚点矩形必须重算;它出现在依赖里是刻意的。
  const rect = useMemo(() => selectionRect(editor), [editor, tick]);

  const visible =
    !disabled &&
    Boolean(editor) &&
    Boolean(editor?.isEditable) &&
    Boolean(editor?.isFocused) &&
    hasTextSelection(editor) &&
    !editor?.isActive("codeBlock") &&
    !editor?.isActive("mermaidBlock");

  if (!visible || !editor) return null;

  const handleLink = async () => {
    const current = (editor.getAttributes("link").href as string | undefined) ?? null;
    const next = onRequestLink
      ? await onRequestLink(current)
      : typeof window !== "undefined" && typeof window.prompt === "function"
        ? window.prompt("链接地址", current ?? "https://")
        : null;
    if (next === null || next === undefined) return;
    if (next.trim().length === 0) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: next.trim() }).run();
  };

  return (
    <EditorPopup visible rect={rect} ariaLabel="行内格式">
      <ToolbarButton label="加粗" shortcut="mod+b" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        B
      </ToolbarButton>
      <ToolbarButton label="斜体" shortcut="mod+i" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        I
      </ToolbarButton>
      <ToolbarButton label="下划线" shortcut="mod+u" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        U
      </ToolbarButton>
      <ToolbarButton label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        S
      </ToolbarButton>
      <ToolbarButton label="行内代码" shortcut="mod+e" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        {"<>"}
      </ToolbarButton>
      <ToolbarButton label="高亮" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        ▨
      </ToolbarButton>
      <ToolbarButton label="链接" shortcut="mod+k" active={editor.isActive("link")} onClick={() => void handleLink()}>
        🔗
      </ToolbarButton>
      <ToolbarButton
        label="清除格式"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        ⌫
      </ToolbarButton>
      {extra}
    </EditorPopup>
  );
}
