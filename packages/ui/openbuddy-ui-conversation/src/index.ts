/**
 * @openbuddy/ui-conversation — 统一对外入口
 *
 * 会话对话层。承载对话流式渲染、消息操作、上下文压缩、引用附件等会话交互相关 UI。
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

export { ChatView } from "./ChatView";
export { ChatRail } from "./ChatRail";
export { Composer } from "./Composer";
export { ContextUsagePill } from "./ContextUsagePill";
export { FileChangesPanel } from "./FileChangesPanel";
export { FindBar, isFindHit } from "./FindBar";
export { InputAddMenu } from "./InputAddMenu";
export { LoadingRow } from "./LoadingRow";
export { MessageItem } from "./MessageItem";
export { AnsiText } from "./AnsiText";
export { QuestionInlineCard } from "./QuestionInlineCard";
export { RewindBar } from "./RewindBar";
export { ToolCallCard, ToolCallDetailBody } from "./ToolCallCard";
export { ToolSidePanel } from "./ToolSidePanel";
export type { ToolSidePanelMode } from "./ToolSidePanel";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    "conversation.body": { kind: "single"; scope: "session-maybe" };
    "conversation.composer": { kind: "single"; scope: "session-maybe" };
    "conversation.toolside": { kind: "list"; scope: "session" };
    "conversation.message.markdown": { kind: "single"; scope: "session" };
  }
}
export { MentionPicker } from "./MentionPicker";
export type { MentionPickerProps } from "./MentionPicker";
