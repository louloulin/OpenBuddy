/**
 * TiptapEditor —— 基于 TipTap 的富文本 / Markdown 编辑器外壳。
 *
 * 与渲染层的关系(重要):
 *   - 会话正文的**渲染**仍然由 `@openbuddy/ui-markdown`(react-markdown)
 *     负责,流式输出不走这里,因此不会因为编辑器引入而产生 caret 抖动;
 *   - 需要"用户真的编辑富文本"的场景(笔记 / 文档 / 计划书)才挂载本组件。
 *   两层通过 `markdown-bridge` 的纯函数互相转换,互不依赖对方的运行时。
 *
 * 受控策略:
 *   - `value` 是外部真相;但**只在编辑器未聚焦且非输入法合成中**才写回,
 *     否则光标会被外部更新打断(见 `shouldSyncExternalValue`);
 *   - 编辑器自己的 `update` 通过 `onChange` 回传,宿主只需把值存起来。
 *
 * 微内核扩展点(本包自取,宿主无需透传):
 *   - `editor.toolbar`        → 工具栏追加按钮
 *   - `editor.slash-commands` → `/` 菜单追加命令
 *   - `editor.mention-sources`→ `@` 候选追加来源(有来源时自动开启 mention)
 *   三个槽位都由 props 同名覆盖(`toolbarActions` / `slashCommands` /
 *   `mention`),props 优先 —— 单元测试与独立挂载不依赖内核。
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, Extensions } from "@tiptap/core";
import {
  buildEditorExtensions,
  type BuildEditorExtensionsOptions,
} from "../extensions";
import type { MentionExtensionOptions } from "../extensions/mention-suggestion";
import {
  htmlToMarkdown,
  markdownToHtml,
  shouldSyncExternalValue,
} from "../lib/markdown-bridge";
import {
  DEFAULT_SLASH_COMMANDS,
  mergeSlashCommandContributions,
} from "../lib/slash-command";
import { gatherMentionItems, type EditorMentionSource } from "../lib/mention";
import type { EditorToolbarAction } from "../lib/toolbar-actions";
import {
  useEditorMentionSources,
  useEditorSlashCommands,
  useEditorToolbarActions,
} from "../lib/use-editor-slots";
import { EditorToolbar } from "./EditorToolbar";
import { BubbleToolbar } from "./BubbleToolbar";
import { FloatingToolbar } from "./FloatingToolbar";
import styles from "./TiptapEditor.module.css";

export type EditorValueFormat = "html" | "markdown";

export interface TiptapEditorProps {
  /** 受控值。格式由 `format` 决定。 */
  value?: string;
  format?: EditorValueFormat;
  /** 值变化回调(用户输入触发)。 */
  onChange?: (value: string, editor: Editor) => void;
  /** 编辑器实例就绪(宿主可挂流式 / 命令)。 */
  onReady?: (editor: Editor) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  /** 扩展裁剪选项。 */
  extensions?: BuildEditorExtensionsOptions;
  /** 额外扩展(追加在最后)。 */
  extraExtensions?: Extensions;
  /** mention 配置(传了才启用 `@`);未传时若有插件候选来源则自动启用。 */
  mention?: MentionExtensionOptions;
  /** 工具栏追加按钮;未传时读内核 `editor.toolbar` 槽位。 */
  toolbarActions?: readonly EditorToolbarAction[];
  /** 顶部工具栏:true = 默认,false = 不渲染,ReactNode = 自定义。 */
  toolbar?: boolean | ReactNode;
  /** 选区气泡菜单。 */
  bubbleMenu?: boolean;
  /** 空行悬浮菜单。 */
  floatingMenu?: boolean;
  /** 工具栏 / 面板下方的自定义内容(如字数统计、保存状态)。 */
  footer?: ReactNode;
  /** 气泡菜单里"链接"按钮的取值方式。 */
  onRequestLink?: (currentHref: string | null) => string | null | Promise<string | null>;
  ariaLabel?: string;
  className?: string;
  minHeight?: number;
}

/** 把任意受控值转成 TipTap 能吃的 HTML。 */
export function toEditorHtml(value: string, format: EditorValueFormat): string {
  return format === "markdown" ? markdownToHtml(value) : value;
}

/** 把编辑器内容转回受控值的格式。 */
export function fromEditorHtml(html: string, format: EditorValueFormat): string {
  return format === "markdown" ? htmlToMarkdown(html) : html;
}

export function TiptapEditor({
  value = "",
  format = "markdown",
  onChange,
  onReady,
  onFocus,
  onBlur,
  placeholder,
  editable = true,
  autofocus = false,
  extensions,
  extraExtensions,
  mention,
  toolbar = true,
  bubbleMenu = true,
  floatingMenu = true,
  footer,
  onRequestLink,
  toolbarActions: toolbarActionsProp,
  ariaLabel = "编辑器",
  className,
  minHeight,
}: TiptapEditorProps) {
  // 内核扩展点(无内核时是空数组,行为与今天一致)。
  const slotToolbarActions = useEditorToolbarActions();
  const slotSlashCommands = useEditorSlashCommands();
  const slotMentionSources = useEditorMentionSources();
  const lastEmittedRef = useRef<string>(value);
  const composingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const formatRef = useRef(format);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  formatRef.current = format;

  const toolbarActions = toolbarActionsProp ?? slotToolbarActions;

  /** `/` 命令 = 内置(或宿主显式传入)+ 插件贡献。false 表示宿主关掉了菜单。 */
  const resolvedSlashCommands = useMemo(() => {
    const explicit = extensions?.slashCommands;
    if (explicit === false) return false;
    if (slotSlashCommands.length === 0) return explicit;
    const base = explicit?.commands ?? DEFAULT_SLASH_COMMANDS;
    return { ...(explicit ?? {}), commands: mergeSlashCommandContributions(base, slotSlashCommands) };
  }, [extensions?.slashCommands, slotSlashCommands]);

  /** `@` 候选 = 宿主 getItems(可选)+ 插件来源;两者都没有则不开 mention。 */
  const resolvedMention = useMemo((): MentionExtensionOptions | undefined => {
    if (slotMentionSources.length === 0) return mention;
    const contributed = (query: string) => gatherMentionItems(slotMentionSources, query);
    if (!mention) return { getItems: contributed };
    const base = mention.getItems;
    return {
      ...mention,
      getItems: async (query: string) => [
        ...(await base(query)),
        ...(await contributed(query)),
      ],
    };
  }, [mention, slotMentionSources]);

  const builtExtensions = useMemo(
    () =>
      buildEditorExtensions({
        ...extensions,
        placeholder,
        mention: resolvedMention,
        slashCommands: resolvedSlashCommands,
        extra: extraExtensions,
      }),
    // 扩展只在配置真的变了时重建;placeholder / mention 由宿主控制稳定性。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(extensions ?? {}), placeholder, resolvedMention, resolvedSlashCommands, extraExtensions],
  );

  const editor = useEditor({
    extensions: builtExtensions,
    content: toEditorHtml(value, format),
    editable,
    autofocus,
    editorProps: {
      attributes: {
        class: "ob-editor-content",
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: instance }) => {
      const next = fromEditorHtml(instance.getHTML(), formatRef.current);
      lastEmittedRef.current = next;
      onChangeRef.current?.(next, instance);
    },
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
  });

  useEffect(() => {
    if (editor) onReadyRef.current?.(editor);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // 外部值写回:只在安全时机(见 shouldSyncExternalValue)。
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const should = shouldSyncExternalValue({
      focused: editor.isFocused,
      composing: composingRef.current,
      lastEmitted: lastEmittedRef.current,
      newValue: value,
    });
    if (!should) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(toEditorHtml(value, format), { emitUpdate: false });
  }, [editor, value, format]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);
  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
  }, []);

  const toolbarNode =
    toolbar === true
      ? <EditorToolbar editor={editor} actions={toolbarActions} />
      : toolbar === false
        ? null
        : toolbar;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={minHeight ? { minHeight } : undefined}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      data-editable={editable ? "true" : "false"}
    >
      {toolbarNode}
      <div className={styles.surface}>
        <EditorContent editor={editor} className={styles.content} />
      </div>
      {bubbleMenu ? <BubbleToolbar editor={editor} onRequestLink={onRequestLink} /> : null}
      {floatingMenu ? <FloatingToolbar editor={editor} /> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
