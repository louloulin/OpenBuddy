/**
 * EmailHeader — WorkBuddy 风格的邮件工作区头部。
 *
 * 头部只承载一级导航和高频动作；AI 分析、分诊和计划的具体内容留在
 * action center / detail 区域，避免把 7 个等权按钮堆在同一行。
 */
import type { EmailProcessingPlan } from "@openbuddy/capability-email";

export interface EmailHeaderProps {
  pendingPlans: EmailProcessingPlan[];
  actionCenterLoading: boolean;
  accountId: string;
  canCompose: boolean;
  onOpenPendingPlan: (plan: EmailProcessingPlan) => void;
  onOpenActionCenter: () => void;
  onRunReplyZero: (kind: "needs_reply" | "waiting_for_reply") => void;
  onRunDigest: () => void;
  onRunTriage: () => void;
  onRunSummary: () => void;
  onCompose: () => void;
}

export function EmailHeader({
  pendingPlans,
  actionCenterLoading,
  accountId,
  canCompose,
  onOpenPendingPlan,
  onOpenActionCenter,
  onRunReplyZero,
  onRunDigest,
  onRunTriage,
  onRunSummary,
  onCompose,
}: EmailHeaderProps): JSX.Element {
  const hasAccount = Boolean(accountId);
  const openPendingPlan = () => {
    const first = pendingPlans[0];
    if (first) onOpenPendingPlan(first);
  };

  return (
    <header className="email-panel__header wb-email-header">
      <div className="wb-email-header__title">
        <h1>邮件</h1>
        <p>通过已授权的邮件 MCP 管理收件箱、线程和草稿。</p>
      </div>
      <div className="email-panel__header-actions wb-email-header__actions" aria-label="邮件工作区操作">
        <button type="button" onClick={openPendingPlan} disabled={pendingPlans.length === 0}>
          待确认计划{pendingPlans.length > 0 ? `（${pendingPlans.length}）` : ""}
        </button>
        <button type="button" onClick={onOpenActionCenter} disabled={actionCenterLoading}>
          {actionCenterLoading ? "加载 AI 行动中心…" : "AI 行动中心"}
        </button>
        <button type="button" className="wb-email-header__ai-reply-zero" onClick={() => onRunReplyZero("needs_reply")} disabled={!hasAccount}>待我回复</button>
        <button type="button" className="wb-email-header__ai-digest" onClick={onRunDigest} disabled={!hasAccount}>今日简报</button>
        <button type="button" className="wb-email-header__ai-triage" onClick={onRunTriage} disabled={!hasAccount}>AI 分诊</button>
        <button type="button" className="wb-email-header__ai-summary" onClick={onRunSummary} disabled={!hasAccount}>AI 摘要</button>
        <details className="wb-email-header__ai-menu">
          <summary>AI 助手</summary>
          <div role="menu" aria-label="AI 邮件助手">
            <button type="button" role="menuitem" onClick={() => onRunReplyZero("needs_reply")} disabled={!hasAccount}>待我回复</button>
            <button type="button" role="menuitem" onClick={() => onRunReplyZero("waiting_for_reply")} disabled={!hasAccount}>等待对方</button>
            <button type="button" role="menuitem" onClick={onRunDigest} disabled={!hasAccount}>今日简报</button>
            <button type="button" role="menuitem" onClick={onRunTriage} disabled={!hasAccount}>AI 分诊</button>
            <button type="button" role="menuitem" onClick={onRunSummary} disabled={!hasAccount}>AI 摘要</button>
          </div>
        </details>
        <button type="button" className="email-primary" disabled={!canCompose} onClick={onCompose}>写邮件</button>
      </div>
    </header>
  );
}
