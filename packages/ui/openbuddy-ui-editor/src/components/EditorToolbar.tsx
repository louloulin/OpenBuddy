/**
 * EditorToolbar —— 编辑器顶部固定工具栏。
 *
 * 与气泡菜单的分工:
 *   - 工具栏放"结构性"操作(标题 / 列表 / 表格 / 图表 / 对齐 / 撤销);
 *   - 气泡菜单只放"行内"操作(加粗 / 斜体 / 链接 / 清除格式)。
 * 这样高频操作在鼠标附近,低频结构操作在固定位置,不会互相遮挡。
 *
 * 插件扩展:`actions` 来自内核 `editor.toolbar` 槽位(由 `TiptapEditor`
 * 读取后透传),也可以由宿主直接传 —— 两者都是同一个数据结构,渲染路径
 * 只有一条。内置按钮永远先渲染,插件按钮排在后面且受 `hidden` 约束。
 */
import type { Editor } from "@tiptap/core";
import { useMemo, type ReactNode } from "react";
import { useEditorTick } from "../lib/use-editor-tick";
import {
  mergeToolbarActions,
  runToolbarAction,
  toolbarActionActive,
  toolbarActionDisabled,
  type EditorToolbarAction,
} from "../lib/toolbar-actions";
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
  /**
   * 追加按钮(插件贡献 / 宿主自定义)。数据型契约,与 `editor.toolbar`
   * 槽位的 payload 完全一致:`{ id, label, run, ... }`。
   */
  actions?: readonly (EditorToolbarAction | undefined | null)[];
  className?: string;
}

export function EditorToolbar({
  editor,
  hidden = [],
  trailing,
  tableSize = { rows: 3, cols: 3 },
  features = { table: true, mermaid: true, math: true, image: false },
  actions,
  className,
}: EditorToolbarProps) {
  // 订阅事务以刷新 active 态(React 无法直接感知 ProseMirror 状态变化)。
  useEditorTick(editor);

  // 必须在早返回之前调用 hook(React 规则);坏数据在这里被一次性清理掉。
  // hidden 默认值是字面量数组,每次渲染都是新引用 —— 用它当 dep 会让 useMemo 失效,
  // 所以按内容做 key(插件按钮数量很小,拼接成本可忽略)。
  const hiddenKey = hidden.join("\u0000");
  const contributed = useMemo(
    () => mergeToolbarActions(actions, hidden),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, hiddenKey],
  );

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

      {contributed.length > 0 ? (
        <div className={styles.group} data-contributed="true">
          {contributed.map((action) => (
            <ToolbarButton
              key={action.id}
              label={action.label}
              shortcut={action.shortcut}
              active={toolbarActionActive(action, editor)}
              disabled={disabled || toolbarActionDisabled(action, editor)}
              onClick={() => runToolbarAction(action, editor)}
            >
              {action.icon ?? "\u25c6"}
            </ToolbarButton>
          ))}
        </div>
      ) : null}

      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  );
}
