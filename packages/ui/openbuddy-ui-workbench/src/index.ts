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

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * ⌘K 搜索面板(single)。注册方 `client.tsx`(`SearchOverlay`),消费者
     * `src/features/app/AppShell.tsx` 的 `SearchSurface` —— 它会把内核
     * `plugin.command` 槽里的插件命令整理成 `pluginCommands` 一起传下去。
     */
    "overlay.search": { kind: "single"; scope: "root" };
    /**
     * R68 — Office 三件套预览槽。每个槽都是 single(scope: root),第三方
     * 插件以更高 priority 注册同名单例槽即可接管对应格式的内嵌预览。
     *
     * 默认实现即本包的 DocxPreview / XlsxPreview / PptxPreview,通过
     * 懒加载的 docx-preview / SheetJS / pptx-preview 渲染为 DOM。FilePreview
     * 在没有插件接管时走这些默认;有插件接管时,以插件为准。
     *
     * 槽的合约:
     * - props:`{ filename: string; content: string; fallback: ReactNode; className?: string }`
     * - 卸载时机:跟随文件预览面板的卸载
     * - 失败语义:内部已经 lazy import 失败兜底到 `fallback`,插槽层无需关心
     */
    "workbench.preview.docx": { kind: "single"; scope: "root" };
    "workbench.preview.xlsx": { kind: "single"; scope: "root" };
    "workbench.preview.pptx": { kind: "single"; scope: "root" };
  }
}

export { SearchOverlay } from "./SearchOverlay";
export {
  filterPluginCommands,
  matchPluginSlashCommand,
  parseSlashQuery,
  pluginCommandLabel,
  runPluginCommand,
} from "./plugin-commands";
export type { PluginCommandPayload } from "./plugin-commands";
export {
  ModelSelector,
  inferCapabilities,
  type CapabilityHint,
} from "./ModelSelector";
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
export { SlashCommands, slashCommandsKeyHandler, NATIVE_PI_COMMANDS } from "./SlashCommands";
export { TeamStatusView } from "./TeamStatusView";
export { WorkflowBlackboard, computeWorkflowLevels } from "./WorkflowBlackboard";
export type { WorkflowBlackboardProps } from "./WorkflowBlackboard";

// ── 查看器 chrome（对齐 WorkBuddy / cabinet 的查看器头部）──────────────
//   ArtifactTabsBar      打开了哪些（切换 / 中键关闭 / 拖拽排序 / 溢出菜单）
//   ArtifactViewerHeader 组合条：面包屑 + 状态徽标 + ViewerToolbar
//   ViewerToolbar        能对它做什么（未传 handler 的按钮一律 disabled）
export { ArtifactTabsBar } from "./ArtifactTabsBar";
export { ArtifactBreadcrumb, buildBreadcrumbItems } from "./ArtifactBreadcrumb";
export type {
  ArtifactBreadcrumbProps,
  ArtifactBreadcrumbSegment,
} from "./ArtifactBreadcrumb";
export { ArtifactViewerHeader } from "./ArtifactViewerHeader";
export type {
  ArtifactViewerHeaderProps,
  ArtifactViewerStatus,
  ArtifactViewerStatusTone,
} from "./ArtifactViewerHeader";
export { ViewerToolbar } from "./ViewerToolbar";
export type { ViewerToolbarMenuItem, ViewerToolbarProps } from "./ViewerToolbar";

// Office 内嵌预览（docx / xlsx / pptx）—— 与 PdfJsPreview 同构的懒加载 + 降级。
export { DocxPreview } from "./DocxPreview";
export type { DocxPreviewProps } from "./DocxPreview";
export { XlsxPreview } from "./XlsxPreview";
export type { XlsxPreviewProps } from "./XlsxPreview";
export { PptxPreview } from "./PptxPreview";
export type { PptxPreviewProps } from "./PptxPreview";
export {
  decodeDataUrl,
  officePreviewKindLabel,
  pickOfficePreviewKind,
  toArrayBuffer,
} from "./office-preview";
export type { OfficePreviewKind } from "./office-preview";
export { loadDocxPreview, loadPptxPreview, loadXlsx } from "./office-preview-loader";
export type {
  DocxPreviewModule,
  PptxPreviewModule,
  PptxPreviewer,
  XlsxModule,
  XlsxWorkbook,
} from "./office-preview-loader";

export { projectArtifact } from "./artifact-view-model";
export type { ArtifactViewModel, ArtifactViewStatus } from "./artifact-view-model";
export { resolveArtifactPreview } from "./artifact-preview-route";
export type { ArtifactPreviewResult, ArtifactPreviewRoute } from "./artifact-preview-route";
export { FileTreeView } from "./FileTreeView";
export type { FileTreeViewProps, FileTreeSlotComponent } from "./FileTreeView";
export { ViewSelector, defaultViews } from "./ViewSelector";
