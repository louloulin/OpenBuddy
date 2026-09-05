/**
 * @openbuddy/ui-shell — 统一对外入口
 *
 * 外层 Shell 层。承载应用窗口外壳、托盘菜单、关于页、调试入口等操作系统集成。
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

export { TitleBar } from "./TitleBar";
export { TopbarActions } from "./TopbarActions";
export { TopbarTitle } from "./TopbarTitle";
export { WorkspacePicker } from "./WorkspacePicker";
export { AssistantTopTabs } from "./AssistantTopTabs";
export {
  AssistantWorkbenchNav,
} from "./AssistantWorkbenchNav";
export {
  assistantPluginTabsFromContributions,
  ASSISTANT_TAB_SECTIONS,
  ASSISTANT_TAB_ROUTE_BY_SECTION,
} from "./AssistantTopTabs";
export type { AssistantTopTabItem } from "./AssistantTopTabs";
export { SessionControls } from "./SessionControls";
export { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
export type { ShortcutEntry } from "./KeyboardShortcutsDialog";
export { PlanModeBanner } from "./PlanModeBanner";
