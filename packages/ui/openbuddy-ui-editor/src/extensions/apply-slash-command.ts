/**
 * apply-slash-command —— 把 `/` 命令映射到真实的 ProseMirror 编辑操作。
 *
 * 单独成文件的原因:
 *   - 这是"菜单里选中了什么"到"文档变成什么样"的唯一真相,需要单测;
 *   - 需要在不渲染 React 的前提下用 headless `Editor` 验证(更快更稳)。
 *
 * 约定:`range` 是 suggestion 给出的 `/xxx` 文本区间,所有命令都必须先
 * `deleteRange(range)` 再插入内容,否则会留下残字。
 */
import type { Editor } from "@tiptap/core";
import type { EditorSlashCommand } from "../lib/slash-command";
import { DEFAULT_MERMAID_CODE } from "./mermaid-block";

export interface SlashCommandEnv {
  /**
   * 图片命令需要宿主提供 URL(打开文件选择器 / 粘贴板)。
   * 未提供时图片命令是 no-op —— 而不是插入一个坏掉的 <img>。
   */
  requestImageUrl?: () => string | null | Promise<string | null>;
  /** 自定义表格尺寸。 */
  tableSize?: { rows: number; cols: number };
  /** mermaid 默认源码。 */
  mermaidCode?: string;
}

export interface SlashRange {
  from: number;
  to: number;
}

/**
 * 执行命令。返回是否真的改动了文档(no-op 返回 false,便于上层判断
 * 要不要提示用户)。
 */
export function applySlashCommand(
  editor: Editor,
  command: EditorSlashCommand,
  range: SlashRange,
  env: SlashCommandEnv = {},
): boolean {
  const chain = editor.chain().focus().deleteRange(range);
  switch (command.id) {
    case "h1":
      return chain.setHeading({ level: 1 }).run();
    case "h2":
      return chain.setHeading({ level: 2 }).run();
    case "h3":
      return chain.setHeading({ level: 3 }).run();
    case "bullet":
      return chain.toggleBulletList().run();
    case "ordered":
      return chain.toggleOrderedList().run();
    case "task":
      return chain.toggleTaskList().run();
    case "quote":
      return chain.toggleBlockquote().run();
    case "divider":
      return chain.setHorizontalRule().run();
    case "code":
      return chain.toggleCodeBlock().run();
    case "table": {
      const rows = env.tableSize?.rows ?? 3;
      const cols = env.tableSize?.cols ?? 3;
      return chain.insertTable({ rows, cols, withHeaderRow: true }).run();
    }
    case "mermaid":
      return chain
        .insertContent({
          type: "mermaidBlock",
          attrs: { code: env.mermaidCode ?? DEFAULT_MERMAID_CODE },
        })
        .run();
    case "math":
      return chain.insertContent({ type: "blockMath", attrs: { latex: "E = mc^2" } }).run();
    case "image": {
      const request = env.requestImageUrl;
      if (!request) return false;
      const resolved = request();
      if (resolved instanceof Promise) {
        // 异步选择器:先结束当前链,拿到 URL 后再插入。
        void resolved.then((url) => {
          if (!url) return;
          editor.chain().focus().setImage({ src: url }).run();
        });
        return true;
      }
      if (!resolved) return false;
      return editor.chain().focus().setImage({ src: resolved }).run();
    }
    default:
      return false;
  }
}

/** 命令 id → 是否需要宿主能力(用于菜单里禁用不可用项)。 */
export function slashCommandNeedsEnv(
  command: EditorSlashCommand,
  env: SlashCommandEnv = {},
): boolean {
  return command.id === "image" && typeof env.requestImageUrl !== "function";
}
