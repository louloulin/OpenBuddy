/**
 * @openbuddy/ui-email/ai — Email AI 闭环 UI 公共入口。
 *
 * 导出策略:
 *   - 组件默认从 components 子目录导出
 *   - hooks 默认从 hooks 子目录导出
 *   - 类型与状态机辅助从 ./types 导出
 *   - CSS 由消费者在 root 显式 import(避免副作用)
 */
export {
  AiInboxShell,
  type AiInboxShellProps,
  type AiInboxThread,
  type AiInboxAccount,
  phaseIdle,
} from "./components/AiInboxShell";
export { phaseReady, phaseError, phaseLoading } from "./types";
export { AiSummaryCard, type AiSummaryCardProps, type AiSummaryAction } from "./components/AiSummaryCard";
export { EmailAiPanel, isEmailAiPanelAvailable, type EmailAiPanelProps } from "./components/EmailAiPanel";
export { AiReplySuggester, type AiReplySuggesterProps } from "./components/AiReplySuggester";
export { AiActionPlanStrip, type AiActionPlanStripProps } from "./components/AiActionPlanStrip";
export { AiCommandBar, type AiCommandBarProps } from "./components/AiCommandBar";
export { MailRail, type MailRailProps, type RailView, type RailFolder, type RailAccount, type RailCounts } from "./components/MailRail";
export { ReceiptToast, type ReceiptToastProps } from "./components/ReceiptToast";
export { MailStatusBar, type MailStatusBarProps } from "./components/MailStatusBar";
export { useAiShortcuts, AI_SHORTCUTS_HELP, type AiShortcut, type UseAiShortcutsArgs } from "./hooks/useAiShortcuts";
export { useEmailData, type EmailDataProvider, type EmailListFilters, type UseEmailDataArgs, type UseEmailDataResult } from "./hooks/useEmailData";
export { useAiInbox, useAiLoop, createAiInboxRuntime, type AiInboxRuntime, type UseAiInboxArgs, type UseAiInboxResult, type UseAiLoopArgs, type UseAiLoopResult } from "./hooks";
export { useEmailAiRuntime, type CapabilityBindings, type UseEmailAiRuntimeArgs } from "./hooks/useEmailAiRuntime";
export type {
  AiAction,
  AiActionDecision,
  AiActionKind,
  AiActionPlan,
  AiActionReceipt,
  AiReplySuggestion,
  AiThreadSummary,
  AsyncPhase,
  AsyncPhaseReady,
  UndoEntry,
} from "./types";
export type { AiTriageHint, AiTriageChip } from "./hooks/useAiInbox";

export { EmailAiStyles } from "./components/EmailAiStyles";
export { PrivacySettingsPanel, resetPrivacyPrefsForTests, type PrivacySettingsPanelProps } from "./components/PrivacySettingsPanel";
export {
  createSentryReporter,
  installSentryReporter,
  type SentryLike,
  type SentryReporter,
  type CreateSentryReporterOptions,
} from "./sentry-reporter";
export {
  errorReporter,
  setErrorReportingEnabled,
  resetErrorReporter,
  reactErrorToContext,
  type ReportedError,
  type ErrorReporter,
} from "./error-reporter";
export {
  AI_TOKEN_PALETTE,
  WB_TOKEN_FALLBACK,
  buildTokenStyleSheet,
  type AiTokenName,
  type WbTokenName,
} from "./ai-tokens";
export {
  recordTelemetry,
  telemetryStore,
  useTelemetryAggregate,
  useTelemetryEvents,
  useTelemetryEnabled,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryAggregate,
} from "./telemetry-store";
