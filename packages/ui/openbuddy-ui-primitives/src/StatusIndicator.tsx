/**
 * R4.2 — Provider / Connection status indicator.
 *
 * Slim status bar surfaced at the top of ChatView. Shows:
 *   - Provider id (e.g. "openai", "anthropic", "echo")
 *   - Current model
 *   - Connection state (connected / reconnecting / disconnected)
 *   - Optional rate-limit window remaining (R4.2 wires usage_update.rateLimitRemaining)
 *
 * All values derive from existing Zustand stores so the indicator never owns
 * state of its own — it just renders the truth.
 */
import { memo } from "react";
import type { ProviderId } from "@openbuddy/shared-types";

export type ConnectionState = "connected" | "reconnecting" | "disconnected" | "unknown";

export interface StatusIndicatorProps {
  providerId?: ProviderId | string;
  providerLabel?: string;
  modelLabel?: string;
  connection: ConnectionState;
  /** Rate-limit window remaining (ms) — undefined hides the pill. */
  rateLimitRemainingMs?: number;
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: "已连接",
  reconnecting: "重连中…",
  disconnected: "已断开",
  unknown: "未知",
};

function StatusIndicatorImpl({
  providerId,
  providerLabel,
  modelLabel,
  connection,
  rateLimitRemainingMs,
}: StatusIndicatorProps) {
  const state = CONNECTION_LABEL[connection] ?? CONNECTION_LABEL.unknown;
  const stateClass = `status-indicator__state status-indicator__state--${connection}`;
  const providerName = providerLabel ?? providerId;
  // R4.2 — keep the role="status" / aria-live wrapper mounted even when
  // the user has not picked a provider yet, so screen readers always
  // announce connection state changes (see AgentDiedSurface.test.tsx —
  // the agent-died recovery surface expects at least one role="status"
  // element attached as soon as the renderer mounts).
  //
  // R15 — 用户反馈侧栏底部那枚绿色的 "openbuddy" 胶囊太吵。没有 provider 时
  // 改为「屏幕阅读器专用」的隐藏节点:role="status" 仍挂载(agent-died 恢复
  // 流程照常工作),但视觉上不再占位。一旦宿主注入了真实 providerName,
  // 才渲染可见的 provider · model · rate-limit 行。
  if (!providerName) {
    return (
      <div
        className="status-indicator status-indicator--builtin wb-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`连接状态：${state}（openbuddy 内核）`}
        data-connection={connection}
      >
        {/* 保留逐状态的可访问名(与有 provider 时一致),屏幕阅读器可查到;
            视觉上被 .wb-sr-only 隐藏,不再渲染那枚绿色 "openbuddy" 胶囊。 */}
        <span className={stateClass} aria-label={`连接状态：${state}`} />
      </div>
    );
  }

  return (
    <div
      className="status-indicator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-connection={connection}
    >
      <span className={stateClass} aria-label={`连接状态：${state}`} />
      <span className="status-indicator__provider" title={providerName}>
        {providerName}
      </span>
      {modelLabel ? (
        <>
          <span className="status-indicator__sep" aria-hidden="true">·</span>
          <span className="status-indicator__model" title={modelLabel}>{modelLabel}</span>
        </>
      ) : null}
      {typeof rateLimitRemainingMs === "number" && rateLimitRemainingMs > 0 ? (
        <>
          <span className="status-indicator__sep" aria-hidden="true">·</span>
          <span className="status-indicator__rate-limit" title="速率限制窗口剩余">
            ⏱ {(rateLimitRemainingMs / 1000).toFixed(1)}s
          </span>
        </>
      ) : null}
    </div>
  );
}

export const StatusIndicator = memo(StatusIndicatorImpl);