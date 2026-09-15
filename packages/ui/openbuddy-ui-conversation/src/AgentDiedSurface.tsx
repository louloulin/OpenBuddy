/**
 * AgentDiedSurface — Phase 6.5 Agent 死亡友好错误卡片
 *
 * 包含图标 + 错误描述 + 重试按钮 + 返回会话按钮。
 */
import { useCallback } from "react";

export interface AgentDiedSurfaceProps {
  error?: Error | string;
  onRetry?: () => void;
  onBack?: () => void;
}

export function AgentDiedSurface({ error, onRetry, onBack }: AgentDiedSurfaceProps) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误";
  const handleRetry = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  return (
    <div className="wb-error-surface wb-error-surface--agent-died" role="alert">
      <span className="wb-error-surface__icon" aria-hidden="true">💀</span>
      <h3 className="wb-error-surface__title">Agent 进程已退出</h3>
      <p className="wb-error-surface__detail">{message}</p>
      <div className="wb-error-surface__actions">
        {onRetry && (
          <button
            type="button"
            className="wb-error-surface__btn wb-error-surface__btn--primary"
            onClick={handleRetry}
          >
            重试
          </button>
        )}
        {onBack && (
          <button type="button" className="wb-error-surface__btn" onClick={onBack}>
            返回会话列表
          </button>
        )}
      </div>
    </div>
  );
}
