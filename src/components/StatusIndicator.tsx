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
  // announce connection state changes (see tests/electron/agent-died.spec.ts
  // — the agent-died recovery surface expects at least one role="status"
  // element attached as soon as the renderer mounts). When providerName
  // is empty we still render the wrapper so aria-live works; we just
  // hide the visual chrome.
  return (
    <div
      className={`status-indicator${providerName ? "" : " status-indicator--empty"}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={providerName ? undefined : `连接状态：${state}`}
      data-connection={connection}
    >
      {providerName ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

export const StatusIndicator = memo(StatusIndicatorImpl);