/**
 * MailStatusBar — 底部状态栏,展示 AI 状态 + 键盘快捷键。
 *
 * 来自顶部产品(Superhuman, Shortwave)的灵感:把快捷键提示放在屏幕底部,
 * 让用户始终知道有哪些 AI 操作可用,而不是埋在 modal 里。
 */
import { AI_SHORTCUTS_HELP } from "../hooks/useAiShortcuts";

export interface MailStatusBarProps {
  aiStatus?: string;
  threadCount?: number;
  pendingPlanCount?: number;
  undoSecondsRemaining?: number;
  onShowHelp?: () => void;
}

export function MailStatusBar({
  aiStatus,
  threadCount,
  pendingPlanCount,
  undoSecondsRemaining,
  onShowHelp,
}: MailStatusBarProps): JSX.Element {
  return (
    <footer className="mail-status-bar" role="contentinfo" aria-label="邮件状态栏">
      <div className="mail-status-bar__shortcuts" aria-label="可用快捷键">
        {AI_SHORTCUTS_HELP.slice(0, 6).map(({ keys, label }) => (
          <span key={keys} className="mail-status-bar__shortcut">
            <kbd>{keys}</kbd>
            <span>{label}</span>
          </span>
        ))}
      </div>
      <div className="mail-status-bar__status" aria-live="polite">
        {threadCount !== undefined ? <span>{threadCount} 封线程</span> : null}
        {pendingPlanCount && pendingPlanCount > 0 ? (
          <span className="mail-status-bar__pending">📋 {pendingPlanCount} 个 AI 计划</span>
        ) : null}
        {undoSecondsRemaining && undoSecondsRemaining > 0 ? (
          <span className="mail-status-bar__undo">↶ 撤销 {undoSecondsRemaining}s</span>
        ) : null}
        {aiStatus ? (
          <span className="mail-status-bar__ai">
            <span className="mail-status-bar__dot" aria-hidden="true" />
            {aiStatus}
          </span>
        ) : null}
      </div>
      <div className="mail-status-bar__tail">
        {onShowHelp ? (
          <button type="button" onClick={onShowHelp} className="mail-status-bar__help">
            <kbd>?</kbd>
            <span>所有快捷键</span>
          </button>
        ) : null}
      </div>
    </footer>
  );
}
