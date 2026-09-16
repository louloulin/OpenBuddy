/**
 * extensions/index —— 组装编辑器扩展集合的唯一入口。
 *
 * 设计取舍:
 *   - StarterKit 提供基础 schema;这里显式关掉 TipTap v3 内置的
 *     `link` / `underline`,改由我们按需配置(避免默认 autolink 在
 *     markdown 往返时改写用户文本)。
 *   - 表格 / 任务列表 / 代码高亮 / 公式 / 图片 / 对齐 单独挂载,便于
 *     宿主按场景裁剪(聊天内联编辑器不需要表格,笔记页则需要)。
 *   - 图表与公式节点与 `markdown-bridge` 的 DOM 契约严格对齐。
 */
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextAlign } from "@tiptap/extension-text-align";
import { Underline } from "@tiptap/extension-underline";
import { Mathematics } from "@tiptap/extension-mathematics";
import { createLowlight, common } from "lowlight";
import { CodeHighlight } from "./code-highlight";
import type { Extensions } from "@tiptap/core";
import { MermaidBlock } from "./mermaid-block";
import {
  createSlashCommandExtension,
  type SlashCommandExtensionOptions,
} from "./slash-command";
import {
  createMentionExtensions,
  type MentionExtensionOptions,
} from "./mention-suggestion";

let lowlightInstance: ReturnType<typeof createLowlight> | null = null;

/** lowlight 实例全局复用,避免每个编辑器实例重建语法表(启动开销明显)。 */
export function getLowlight(): ReturnType<typeof createLowlight> {
  if (!lowlightInstance) lowlightInstance = createLowlight(common);
  return lowlightInstance;
}

export interface BuildEditorExtensionsOptions {
  placeholder?: string;
  /** 是否启用代码高亮(关闭后用普通 codeBlock,包更小)。 */
  codeHighlight?: boolean;
  /** 表格默认尺寸。 */
  table?: { rows: number; cols: number } | false;
  /** 图片上传 / 选择器:提供后才启用 image 节点。 */
  allowImages?: boolean;
  /** 数学公式(KaTeX)。 */
  math?: boolean;
  /** Mermaid 图表。 */
  mermaid?: boolean;
  /** `/` 命令菜单。传 false 关闭。 */
  slashCommands?: SlashCommandExtensionOptions | false;
  /** `@` mention。不传则关闭。 */
  mention?: MentionExtensionOptions;
  /** 额外扩展(宿主追加,排在最后)。 */
  extra?: Extensions;
}

/**
 * 组装扩展数组。纯函数 —— 同样的 options 得到同样的扩展顺序,便于单测
 * 断言"某些扩展在 / 不在"。
 */
export function buildEditorExtensions(
  options: BuildEditorExtensionsOptions = {},
): Extensions {
  const {
    placeholder,
    codeHighlight = true,
    table = { rows: 3, cols: 3 },
    allowImages = false,
    math = true,
    mermaid = true,
    slashCommands,
    mention,
    extra,
  } = options;

  const extensions: Extensions = [
    StarterKit.configure({
      link: false,
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: false }),
  ];

  if (codeHighlight) {
    extensions.push(CodeHighlight.configure({ lowlight: getLowlight() }));
  }
  if (table !== false) {
    extensions.push(Table.configure({ resizable: true }), TableRow, TableHeader, TableCell);
  }
  extensions.push(TaskList, TaskItem.configure({ nested: true }));
  if (allowImages) extensions.push(Image.configure({ inline: false, allowBase64: true }));
  if (math) extensions.push(Mathematics);
  if (mermaid) extensions.push(MermaidBlock);
  if (placeholder) {
    extensions.push(Placeholder.configure({ placeholder }));
  }
  if (slashCommands !== false) {
    extensions.push(createSlashCommandExtension(slashCommands ?? {}));
  }
  if (mention) {
    extensions.push(...createMentionExtensions(mention));
  }
  if (extra) extensions.push(...extra);

  return extensions;
}
