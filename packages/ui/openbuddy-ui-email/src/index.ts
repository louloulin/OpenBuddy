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
 *   - ./ai            → Email AI 闭环 UI 入口(AiInboxShell / 摘要 / 回复 / 计划条 / 命令面板)
 *   - ./ai/styles.css → 配套 CSS(消费者自行在 root 引入)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export { EmailComposer } from "./EmailComposer";
/**
 * @deprecated 推荐用 EmailAiPanel(AI 闭环 3 段视图)。此导出仍保留供
 *   - Settings → 高级邮件页(注册、规则、迁移、批量同步)
 *   - 第三方插件用更高 priority 整体替换 placeholder.email 槽
 * 不再主动调用。计划在 0.16.0 删除。
 */
export { EmailPanel as EmailPanelAdvanced } from "./EmailPanel";
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

// AI 闭环模块 — 渐进式迁移目标。
// EmailPanel 现在是薄壳,内部组合 AiInboxShell。消费者可以从子路径
// `@openbuddy/ui-email/ai` 单独使用 AI 组件,而无需引入整个面板。
export {
  AiInboxShell,
  AiSummaryCard,
  EmailAiPanel,
  isEmailAiPanelAvailable,
  AiReplySuggester,
  AiActionPlanStrip,
  AiCommandBar,
  MailRail,
  useAiInbox,
  useAiLoop,
  createAiInboxRuntime,
  phaseIdle,
  phaseReady,
  phaseError,
  phaseLoading,
  type AiInboxShellProps,
  type EmailAiPanelProps,
  type AiInboxThread,
  type AiInboxAccount,
  type AiSummaryCardProps,
  type AiSummaryAction,
  type AiReplySuggesterProps,
  type AiActionPlanStripProps,
  type AiCommandBarProps,
  type MailRailProps,
  type RailView,
  type RailFolder,
  type RailAccount,
  type RailCounts,
  type AiInboxRuntime,
  type UseAiInboxArgs,
  type UseAiInboxResult,
  type UseAiLoopArgs,
  type UseAiLoopResult,
  type AiAction,
  type AiActionDecision,
  type AiActionKind,
  type AiActionPlan,
  type AiActionReceipt,
  type AiReplySuggestion,
  type AiThreadSummary,
  type AsyncPhase,
  type AsyncPhaseReady,
  type UndoEntry,
} from "./ai/index";


declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 邮件主面板(single)。
     * 消费者:PlaceholderPage「邮件」路由。
     */
    "placeholder.email": { kind: "single"; scope: "root" };
    /**
     * 邮件撰写面板(single)。
     * 消费者:EmailPanel 内部的「新建邮件」模态。
     */
    "placeholder.email-composer": { kind: "single"; scope: "root" };
  }
}
