/**
 * @openbuddy/ui-markdown — 统一对外入口
 *
 * Markdown 渲染层。承载聊天与文档中的 Markdown 流式渲染、代码块高亮、Mermaid 图表。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export { Markdown } from "./components/Markdown";
export { MarkdownInlineCode } from "./components/MarkdownInlineCode";
export { MarkdownPre } from "./components/MarkdownPre";
export { MarkdownPreMermaid } from "./components/MarkdownPreMermaid";
export { CodeBlockActions } from "./components/CodeBlockActions";
export type { MarkdownProps } from "./components/Markdown";
export type {
  MarkdownConfig,
  MarkdownTheme,
  PathType,
  PathClickHandler,
  CodeBlockAction,
} from "./components/types";
export { preprocessMarkdown } from "./components/preprocess";
