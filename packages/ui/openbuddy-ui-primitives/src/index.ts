/**
 * @openbuddy/ui-primitives — 统一对外入口
 *
 * 原子组件层。承载按钮、输入框、卡片、徽标、Tabs、Tooltip 等无业务语义的可复用基础组件。
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
export { Button } from "./components/Button";
import type { SlotMap } from "@openbuddy/ui-slots";
declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 全局通知层(list)。注册方是 `client.ts`(把本包的 `Toast` 放进去),
     * 消费者是「统一 overlay 层」——当前由第三方/替代外壳(ui-layout 的
     * `AppFrame` 是参考实现)取用,本产品外壳走自己的 toast host。
     *
     * 这条槽属于「有意扩展点」:零内置消费不是漏接线,不要为了让它显示成
     * `ok` 而硬接一个消费者进来。
     */
    "notifications": { kind: "list"; scope: "root" };
  }
}
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/Button";
export { Pill } from "./components/Pill";
export type { PillProps, PillTone } from "./components/Pill";
export { Toast } from "./components/Toast";
export { Modal } from "./components/Modal";
export type { ModalProps } from "./components/Modal";
export { Spinner } from "./components/Spinner";
export type { SpinnerProps } from "./components/Spinner";
export { FilterableList } from "./components/FilterableList";
export type { FilterableListProps, FilterableListItem } from "./components/FilterableList";
export { ThemePreview } from "./components/ThemePreview";
export type { ThemePreviewProps, ThemePreviewToken } from "./components/ThemePreview";
export * from "./icons";
export { AnimatedTabs } from "./components/AnimatedTabs";
export type { AnimatedTabsProps, AnimatedTabsItem } from "./components/AnimatedTabs";
export { Skeleton } from "./components/Skeleton";
export type { SkeletonProps } from "./components/Skeleton";
export { KbdHint } from "./components/KbdHint";
export type { KbdHintProps } from "./components/KbdHint";
export { Marquee } from "./components/Marquee";
export { Resizable, clampWidth } from "./components/Resizable";
export type { ResizableProps } from "./components/Resizable";
export type { MarqueeProps } from "./components/Marquee";
