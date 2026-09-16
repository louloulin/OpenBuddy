/**
 * EditorToolbar —— 编辑器顶部固定工具栏。
 *
 * 与气泡菜单的分工:
 *   - 工具栏放"结构性"操作(标题 / 列表 / 表格 / 图表 / 对齐 / 撤销);
 *   - 气泡菜单只放"行内"操作(加粗 / 斜体 / 链接 / 清除格式)。
 * 这样高频操作在鼠标附近,低频结构操作在固定位置,不会互相遮挡。
 */
import type { Editor } from "@tiptap/core";
import type { ReactNode } from "react";
import { useEditorTick } from "../lib/use-editor-tick";
import { ToolbarButton } from "./ToolbarButton";
import styles from "./EditorToolbar.module.css";

export interface EditorToolbarProps {
  editor: Editor | null;
  /** 隐藏某些按钮 id。 */
  hidden?: string[];
  /** 追加到最右侧(宿主插槽)。 */
  trailing?: ReactNode;
  /** 插入表格用的尺寸。 */
  tableSize?: { rows: number; cols: number };
  /** Mermaid / 表格等"重"块是否可用。 */
  features?: { table?: boolean; mermaid?: boolean; math?: boolean; image?: boolean };
  className?: string;
}

export function EditorToolbar({
  editor,
  hidden = [],
  trailing,
  tableSize = { rows: 3, cols: 3 },
  features = { table: true, mermaid: true, math: true, image: false },
  className,
}: EditorToolbarProps) {
  // 订阅事务以刷新 active 态(React 无法直接感知 ProseMirror 状态变化)。
  useEditorTick(editor);

  if (!editor) return null;
  const disabled = !editor.isEditable;
  const show = (id: string) => !hidden.includes(id);

  return (
    <div
      className={[styles.toolbar, className].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label="编辑器工具栏"
    >
      <div className={styles.group}>
        <ToolbarButton label="撤销" shortcut="mod+z" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          ↺
        </ToolbarButton>
        <ToolbarButton label="重做" shortcut="mod+shift+z" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          ↻
        </ToolbarButton>
      </div>

      <div className={styles.group}>
        {[1, 2, 3].map((level) =>
          show(`h${level}`) ? (
            <ToolbarButton
              key={level}
              label={`${level} 级标题`}
              active={editor.isActive("heading", { level })}
              disabled={disabled}
              onClick={() => editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()}
            >
              {`H${level}`}
            </ToolbarButton>
          ) : null,
        )}
      </div>

      <div className={styles.group}>
        {show("bullet") ? (
          <ToolbarButton label="无序列表" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            •
          </ToolbarButton>
        ) : null}
        {show("ordered") ? (
          <ToolbarButton label="有序列表" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1.
          </ToolbarButton>
        ) : null}
        {show("task") ? (
          <ToolbarButton label="任务列表" active={editor.isActive("taskList")} disabled={disabled} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            ☑
          </ToolbarButton>
        ) : null}
        {show("quote") ? (
          <ToolbarButton label="引用" active={editor.isActive("blockquote")} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </ToolbarButton>
        ) : null}
        {show("codeBlock") ? (
          <ToolbarButton label="代码块" active={editor.isActive("codeBlock")} disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            {"{ }"}
          </ToolbarButton>
        ) : null}
      </div>

      <div className={styles.group}>
        {show("table") && features.table ? (
          <ToolbarButton
            label="插入表格"
            disabled={disabled}
            onClick={() => editor.chain().focus().insertTable({ ...tableSize, withHeaderRow: true }).run()}
          >
            ▦
          </ToolbarButton>
        ) : null}
        {show("mermaid") && features.mermaid ? (
          <ToolbarButton
            label="插入 Mermaid 图表"
            disabled={disabled}
            onClick={() => editor.chain().focus().setMermaidBlock().run()}
          >
            ◇
          </ToolbarButton>
        ) : null}
        {show("math") && features.math ? (
          <ToolbarButton
            label="插入公式"
            disabled={disabled}
            onClick={() => editor.chain().focus().insertContent({ type: "blockMath", attrs: { latex: "E = mc^2" } }).run()}
          >
            ∑
          </ToolbarButton>
        ) : null}
        {show("divider") ? (
          <ToolbarButton label="分隔线" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            ―
          </ToolbarButton>
        ) : null}
      </div>

      <div className={styles.group}>
        {show("align") ? (
          <>
            <ToolbarButton label="左对齐" active={editor.isActive({ textAlign: "left" })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
              ⬅
            </ToolbarButton>
            <ToolbarButton label="居中" active={editor.isActive({ textAlign: "center" })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
              ↔
            </ToolbarButton>
            <ToolbarButton label="右对齐" active={editor.isActive({ textAlign: "right" })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
              ➡
            </ToolbarButton>
          </>
        ) : null}
      </div>

      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  );
}
