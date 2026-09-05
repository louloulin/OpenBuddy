/**
 * @openbuddy/ui-email — 统一对外入口
 *
 * 邮件 UI 层。承载邮件会话、撰写、附件、垃圾邮件过滤等邮件客户端 UI。
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
export { EmailComposer } from "./EmailComposer";
export { EmailPanel } from "./EmailPanel";
export { ConnectionBanner, shouldShowConnectionBanner } from "./ConnectionBanner";
export type { ConnectionBannerProps, ConnectionBannerVariant } from "./ConnectionBanner";
export { ProviderRegistryCard } from "./ProviderRegistryCard";
export type { ProviderRegistryCardProps } from "./ProviderRegistryCard";

export { EmailHeader } from "./EmailHeader";
export type { EmailHeaderProps } from "./EmailHeader";
export { EmailList } from "./EmailList";
export type { EmailListProps } from "./EmailList";
export { EmailDetail } from "./EmailDetail";
export type { EmailDetailProps } from "./EmailDetail";
export { EmailSidebar } from "./EmailSidebar";
export type { EmailSidebarProps, EmailFolder, EmailView } from "./EmailSidebar";
