/**
 * ChatViewBannerStack — 横幅堆叠容器。
 *
 * 自上而下渲染:
 *   1. Pi 扩展部件(`extensionUi.widgets`)
 *   2. Pi 扩展状态条(`extensionUi.statuses`)
 *   3. Pi 扩展工作指示器(`extensionUi.workingVisible`)
 *   4. Provider / 连接 / 限流指示器(`StatusIndicator`)
 *   5. 错误横幅(`chatview__error-banner`) + 重试按钮 + 关闭按钮
 *   6. Plan Mode 持续横幅(`PlanModeBanner`)
 *
 * 各 hook 由 ChatView 提供;这里负责视觉一致性与渲染顺序。
 */
import type { ReactNode } from "react";
import { PlanModeBanner } from "@openbuddy/ui-shell";
import { StatusIndicator } from "@/components/StatusIndicator";
import type { Plan } from "@openbuddy/shared-types";
import type { MessageError } from "@openbuddy/ui-state/session-store";
import { formatPiError } from "@/lib/platform/error-format";

export type ExtensionUi = {
  statuses?: Record<string, string>;
  widgets?: Record<string, string[]>;
  workingMessage?: string;
  workingVisible?: boolean;
  workingIndicator?: unknown;
  hiddenThinkingLabel?: string;
  toolsExpanded?: boolean;
};

export type ChatViewBannerStackProps = {
  extensionUi?: ExtensionUi;
  error: Error | string | null;
  /** 是否显示 error 重试按钮(有 user 消息且非流式)。 */
  canRetry: boolean;
  onRetry: () => void | Promise<void>;
  onCloseError: () => void;
  planMode: boolean;
  plan?: Plan;
  /** PlanModeBanner 的 exit 回调(占位,实际由 App.tsx 持有)。 */
  onPlanExit: () => void;
  onToast?: (msg: string) => void;
};

export function ChatViewBannerStack(props: ChatViewBannerStackProps) {
  const items: ReactNode[] = [];

  if (props.extensionUi && Object.keys(props.extensionUi.widgets ?? {}).length > 0) {
    items.push(
      <div className="chatview__extension-widgets" aria-label="Pi 扩展组件" key="widgets">
        {Object.entries(props.extensionUi.widgets!).map(([key, lines]) => (
          <div className="chatview__extension-widget" key={key}>
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ))}
      </div>,
    );
  }
  if (props.extensionUi && Object.keys(props.extensionUi.statuses ?? {}).length > 0) {
    items.push(
      <div className="chatview__extension-status" aria-label="Pi 扩展状态" key="status">
        {Object.values(props.extensionUi.statuses!).join(" · ")}
      </div>,
    );
  }
  if (props.extensionUi?.workingVisible) {
    items.push(
      <div
        className="chatview__extension-working"
        role="status"
        aria-label="Pi 扩展工作状态"
        key="working"
      >
        <span className="chatview__extension-working-dot" aria-hidden="true" />
        <span>
          {props.extensionUi.workingMessage ||
            props.extensionUi.hiddenThinkingLabel ||
            "Pi 扩展正在工作"}
        </span>
        {props.extensionUi.toolsExpanded && (
          <span className="chatview__extension-working-tools">工具已展开</span>
        )}
      </div>,
    );
  }
  items.push(<StatusIndicator connection="unknown" key="indicator" />);
  if (props.error) {
    items.push(
      <div className="chatview__error-banner" role="alert" key="error">
        <span className="chatview__error-icon" aria-hidden="true">⚠</span>
        <span className="chatview__error-text" style={{ whiteSpace: "pre-wrap" }}>
          {formatPiError(props.error as never) ?? String(props.error)}
        </span>
        {props.canRetry && (
          <button
            className="chatview__error-retry"
            onClick={() => void props.onRetry()}
            aria-label="重试最后一条消息"
            title="重试最后一条消息"
            data-testid="chatview-error-retry"
          >
            ↻ 重试
          </button>
        )}
        <button
          className="chatview__error-close"
          onClick={props.onCloseError}
          aria-label="关闭错误提示"
          title="关闭"
        >
          ×
        </button>
      </div>,
    );
  }
  if (props.planMode) {
    items.push(
      <PlanModeBanner
        plan={props.plan}
        visible={props.planMode}
        onExit={props.onPlanExit}
        onToast={props.onToast}
        key="plan-banner"
      />,
    );
  }

  return <>{items}</>;
}
