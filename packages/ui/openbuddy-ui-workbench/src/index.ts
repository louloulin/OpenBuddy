/**
 * @openbuddy/ui-workbench — 统一对外入口
 *
 * 工作台层。承载工作台场景(Agent 工作台/计划工作台/调试工作台等)的多面板组合视图。
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

export { SearchOverlay } from "./SearchOverlay";
export { ModelSelector } from "./ModelSelector";
export type { ModelOption, ThinkingLevel } from "./ModelSelector";
export { AssistantCalendarPanel } from "./AssistantCalendarPanel";
export { AssistantWorkspacePanel, AssistantExtensionPanel } from "./AssistantWorkspacePanel";
export type { AssistantWorkspacePanelProps } from "./AssistantWorkspacePanel";

export { BrowserPreview } from "./BrowserPreview";
export { BuddyDirectory } from "./BuddyDirectory";
export type { BuddyEntry } from "./BuddyDirectory";
export { FilePreview } from "./FilePreview";
export { LocalAssistantView } from "./LocalAssistantView";
export { ProjectCollaborationTab } from "./ProjectCollaborationTab";
export { ProjectDetailView } from "./ProjectDetailView";
export { RecoveryList } from "./RecoveryList";
export { RendererContributionView, RendererContributionCard, RendererSlotView } from "./RendererContributionView";
export { ShareMenu } from "./ShareMenu";
export { SlashCommands, slashCommandsKeyHandler } from "./SlashCommands";
export { TeamStatusView } from "./TeamStatusView";
export { WorkflowBlackboard, computeWorkflowLevels } from "./WorkflowBlackboard";
export type { WorkflowBlackboardProps } from "./WorkflowBlackboard";

export { ArtifactTabsBar } from "./ArtifactTabsBar";
export { FileTreeView } from "./FileTreeView";
export { ViewSelector, defaultViews } from "./ViewSelector";