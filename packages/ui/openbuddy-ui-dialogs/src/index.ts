/**
 * @openbuddy/ui-dialogs — 统一对外入口
 *
 * 通用对话框层。承载确认、提示、表单、权限确认、文件选择等系统级模态对话框。
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

export { AboutDialog } from "./AboutDialog";

export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmTone } from "./ConfirmDialog";

export { FeedbackDialog } from "./FeedbackDialog";

export { FolderTrustDialog } from "./FolderTrustDialog";

export { ModalIcon } from "./ModalIcon";

export { ModalShell, ModalHead, ModalBody, ModalFooter } from "./ModalShell";
export type { ModalTone, ModalShellProps, ModalHeadProps } from "./ModalShell";

export { PermissionInlineCard } from "./PermissionDialog";

export { ProjectConfirmDialog, ProjectInputDialog } from "./ProjectDialog";

export { PromptDialog } from "./PromptDialog";
