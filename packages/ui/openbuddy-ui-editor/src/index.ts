/**
 * @openbuddy/ui-editor — 统一对外入口
 *
 * 编辑层。承载基于 TipTap 的富文本 / Markdown 编辑器,与只读渲染层
 * (`@openbuddy/ui-markdown`)通过 `markdown-bridge` 的纯函数对接:
 *   - 渲染层继续用 react-markdown,流式输出不经过编辑器,因此没有 caret 抖动;
 *   - 需要结构化编辑(笔记 / 文档 / 计划书)时才挂载本包的编辑器。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染 (TiptapEditor / EditorToolbar ...)
 *   - 公共工具 (Utilities)    → 纯函数 (markdownToHtml / htmlToMarkdown / filterSlashCommands ...)
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *   - ./components    → 组件集合
 *   - ./extensions    → TipTap 扩展装配
 *   - ./styles        → 编辑器正文字体 / 排版全局样式(含 KaTeX)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";

export type { SlotMap };

// --- 组件 -----------------------------------------------------------------
export { TiptapEditor, toEditorHtml, fromEditorHtml } from "./components/TiptapEditor";
export type { TiptapEditorProps, EditorValueFormat } from "./components/TiptapEditor";
export { EditorToolbar } from "./components/EditorToolbar";
export type { EditorToolbarProps } from "./components/EditorToolbar";
export { BubbleToolbar, selectionRect } from "./components/BubbleToolbar";
export type { BubbleToolbarProps } from "./components/BubbleToolbar";
export { FloatingToolbar, emptyBlockRect } from "./components/FloatingToolbar";
export type { FloatingToolbarProps } from "./components/FloatingToolbar";
export { EditorPopup } from "./components/EditorPopup";
export type { EditorPopupProps } from "./components/EditorPopup";
export { ToolbarButton } from "./components/ToolbarButton";
export type { ToolbarButtonProps } from "./components/ToolbarButton";
export { SuggestionMenu } from "./components/SuggestionMenu";
export type { SuggestionMenuProps } from "./components/SuggestionMenu";
export { MermaidNodeView } from "./components/MermaidNodeView";

// --- 扩展 -----------------------------------------------------------------
export {
  buildEditorExtensions,
  getLowlight,
  type BuildEditorExtensionsOptions,
} from "./extensions";
export { MermaidBlock, DEFAULT_MERMAID_CODE } from "./extensions/mermaid-block";
export type { MermaidBlockOptions } from "./extensions/mermaid-block";
export {
  createSlashCommandExtension,
  createSlashCommandMenuRenderer,
  type SlashCommandExtensionOptions,
  type SlashCommandMenuState,
} from "./extensions/slash-command";
export {
  createMentionExtensions,
  createMentionMenuRenderer,
  type MentionExtensionOptions,
} from "./extensions/mention-suggestion";
export {
  applySlashCommand,
  slashCommandNeedsEnv,
  type SlashCommandEnv,
  type SlashRange,
} from "./extensions/apply-slash-command";

// --- 纯工具 ---------------------------------------------------------------
export {
  markdownToHtml,
  htmlToMarkdown,
  renderInline,
  escapeHtml,
  unescapeHtml,
  shouldSyncExternalValue,
  MarkdownStreamBuffer,
} from "./lib/markdown-bridge";
export {
  DEFAULT_SLASH_COMMANDS,
  detectSlashTrigger,
  filterSlashCommands,
  groupSlashCommands,
  mergeSlashCommandContributions,
  moveSlashSelection,
  type EditorSlashCommand,
  type EditorSlashCommandContribution,
  type EditorSlashCommandRun,
  type EditorSlashCommandRunContext,
  type SlashCommandKind,
  type SlashTrigger,
} from "./lib/slash-command";
export {
  detectMentionTrigger,
  filterMentionItems,
  gatherMentionItems,
  isMentionItem,
  mentionToMarkdown,
  type EditorMentionItem,
  type EditorMentionSource,
  type MentionTrigger,
} from "./lib/mention";
export {
  mergeToolbarActions,
  runToolbarAction,
  toolbarActionActive,
  toolbarActionDisabled,
  type EditorToolbarAction,
} from "./lib/toolbar-actions";
export {
  useEditorMentionSources,
  useEditorSlashCommands,
  useEditorToolbarActions,
} from "./lib/use-editor-slots";
export {
  computePopupPosition,
  createSuggestionPopup,
  type PopupPosition,
  type RectLike,
  type SuggestionPopup,
} from "./lib/suggestion-popup";
export { useEditorTick, hasTextSelection, isCurrentBlockEmpty } from "./lib/use-editor-tick";
export { useEditorStream, type EditorStream, type UseEditorStreamOptions } from "./lib/use-editor-stream";
export { loadMermaid, resetMermaidLoader } from "./lib/mermaid-loader";

// --- 槽位声明 -------------------------------------------------------------
declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 编辑器主体。宿主(笔记页 / 文档面板)可以整体替换编辑器实现,
     * 默认注册的是本包的 `TiptapEditor`。
     */
    "editor.body": {
      kind: "single";
      scope: "session-maybe";
      owner: {
        value?: string;
        format?: "html" | "markdown";
        editable?: boolean;
        placeholder?: string;
      };
    };
    /**
     * 工具栏扩展区。
     *
     * 两种贡献方式:
     *   - **数据型**(推荐):payload = `EditorToolbarAction`,由 `TiptapEditor`
     *     读取后交给 `EditorToolbar` 渲染 —— 插件不必知道编辑器长什么样;
     *   - **组件型**:payload = React 组件,由宿主自行决定渲染位置
     *     (例如放进 `trailing`)。
     */
    "editor.toolbar": {
      kind: "list";
      scope: "session-maybe";
      owner: { editorId?: string };
    };
    /** `/` 命令来源。payload = `EditorSlashCommandContribution`(带 `run`)。 */
    "editor.slash-commands": {
      kind: "list";
      scope: "session-maybe";
      owner: Record<string, never>;
    };
    /** `@` 候选来源。payload = `EditorMentionSource`(静态 items 或 getItems)。 */
    "editor.mention-sources": {
      kind: "list";
      scope: "session-maybe";
      owner: { query: string };
    };
  }
}

// --- 代码高亮 -------------------------------------------------------------
export {
  CodeHighlight,
  buildCodeDecorations,
  CODE_HIGHLIGHT_PLUGIN_KEY,
  type CodeHighlightOptions,
} from "./extensions/code-highlight";
