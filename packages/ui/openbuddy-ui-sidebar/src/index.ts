/**
 * @openbuddy/ui-sidebar — 统一对外入口
 *
 * 侧栏层。承载会话列表、收藏、最近访问与侧栏设置项 UI。
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
import type { SlotMap } from "@openbuddy/ui-slots";
export type { SlotMap };

export { ColleaguesPanel } from "./ColleaguesPanel";
export { ConversationList } from "./ConversationList";
export { PinnedSection } from "./PinnedSection";
export { WorkspaceGroup } from "./WorkspaceGroup";
export { Sidebar } from "./Sidebar";
export { SubagentIndicator, SessionRowWithSubagents } from "./SubagentIndicator";
