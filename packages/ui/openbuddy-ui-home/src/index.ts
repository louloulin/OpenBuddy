/**
 * @openbuddy/ui-home — 统一对外入口
 *
 * 首页场景层。承载登录后的首页布局、欢迎语、推荐场景、最近会话、快捷入口。
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
export { HomeHeader } from "./HomeHeader";
export { HomeComposer } from "./HomeComposer";
export { SceneTabs } from "./SceneTabs";
export { PracticeCases } from "./PracticeCases";
