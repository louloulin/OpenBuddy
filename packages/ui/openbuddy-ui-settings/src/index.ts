/**
 * @openbuddy/ui-settings — 统一对外入口
 *
 * 设置层。承载系统设置项面板、Tabs 导航、设置入口注册与各子面板的聚合入口。
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

export { HomePage } from "./HomePage";
export { SettingsPanel } from "./SettingsPanel";
export { AssistantsPanel } from "./AssistantsPanel";
export { PolicySettingsPanel } from "./PolicySettingsPanel";

export {
  PersonalizeSettingsPanel,
  ShortcutsSettingsPanel,
  HelpSettingsPanel,
  SecuritySettingsPanel,
  DataSettingsPanel,
  GeneralSettingsPanel,
  AccountSettingsPanel,
  AgentSettingsPanel,
  AssistantSettingsPanel,
} from "./SettingsSections";
