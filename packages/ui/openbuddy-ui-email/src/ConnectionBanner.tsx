/**
 * ConnectionBanner — Email Empty State 组件
 *
 * 设计意图:解决 EmailPanel 在「无 provider」「未授权」状态下的视觉坍缩。
 *
 * 历史问题(R7.0):
 *   - EmailPanel 只有「Ready」一种渲染分支
 *   - accounts.length === 0 → 整面板空白 + 弹一条 toast
 *   - 用户面对 toast 飘过 + 空白列表,认知:「这坏了」
 *   - 30 秒 polling 触发 toast 重复 → UI 卡死感
 *
 * 设计原则(对齐 WorkBuddy):
 *   - **Empty State 是状态,不是错误**:用 banner 替代,而不是 toast
 *   - **强主按钮**:「打开连接器」是清晰的下一步
 *   - **持久可见**:banner 不自动消失,直到用户授权或 dismiss
 *   - **视觉对齐 `--wb-*` token**:与 Sidebar/ChatView 视觉一致
 *
 * 三种 variant:
 *   - `no-provider` — 默认,完全无 provider
 *   - `partial`     — 部分能力可用(读但不能写)
 *   - `reauthorize` — token 过期需重新授权
 *
 * @see docs/comet/changes/email-module-architecture-review/analysis/email-architecture-review.md §4.1
 */
import { useCallback } from "react";

export type ConnectionBannerVariant = "no-provider" | "partial" | "reauthorize";

export interface ConnectionBannerProps {
  variant: ConnectionBannerVariant;
  /** 标题(主信息) */
  title?: string;
  /** 描述(辅助说明) */
  description?: string;
  /** 主按钮 label */
  primaryActionLabel?: string;
  /** 主按钮点击 — 跳到「专家·技能·连接器」 */
  onPrimaryAction?: () => void;
  /** 次按钮(可选)— 例如「重试」 */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** 关闭按钮(可选)— 用户主动 dismiss */
  onDismiss?: () => void;
  /** WorkBuddy foundation icon name(预留,目前用 unicode) */
  iconName?: "alert" | "key" | "plug";
}

const VARIANT_DEFAULTS: Record<ConnectionBannerVariant, {
  title: string;
  description: string;
  primaryActionLabel: string;
  iconName: NonNullable<ConnectionBannerProps["iconName"]>;
  iconChar: string;
}> = {
  "no-provider": {
    title: "邮箱 MCP 未连接",
    description: "前往「专家·技能·连接器」授权邮箱 MCP,即可在 OpenBuddy 内统一管理 Gmail / Outlook / IMAP 邮箱。",
    primaryActionLabel: "打开连接器",
    iconName: "plug",
    iconChar: "🔌",
  },
  "partial": {
    title: "邮箱能力部分可用",
    description: "已授权邮箱但部分能力缺失,可能是权限 scope 不全或连接器声明的能力尚未发现。前往「专家·技能·连接器」查看详情。",
    primaryActionLabel: "查看连接器",
    iconName: "alert",
    iconChar: "⚠",
  },
  "reauthorize": {
    title: "邮箱需要重新授权",
    description: "OAuth token 已过期或被撤销。重新授权后,OpenBuddy 会自动恢复邮件读写能力。",
    primaryActionLabel: "重新授权",
    iconName: "key",
    iconChar: "🔑",
  },
};

/**
 * Empty State 主入口。被 EmailPanel 在以下条件渲染:
 *   - accounts.length === 0
 *   - 或 providerDiagnostic?.readiness === "unavailable" / "reauthorization-required"
 */
export function ConnectionBanner(props: ConnectionBannerProps): JSX.Element {
  const defaults = VARIANT_DEFAULTS[props.variant];
  const title = props.title ?? defaults.title;
  const description = props.description ?? defaults.description;
  const primaryActionLabel = props.primaryActionLabel ?? defaults.primaryActionLabel;
  const iconChar = props.iconName ? VARIANT_DEFAULTS[props.variant].iconChar : defaults.iconChar;

  const handlePrimary = useCallback(() => {
    props.onPrimaryAction?.();
  }, [props]);

  const handleSecondary = useCallback(() => {
    props.onSecondaryAction?.();
  }, [props]);

  const handleDismiss = useCallback(() => {
    props.onDismiss?.();
  }, [props]);

  return (
    <aside
      className={`wb-connection-banner wb-connection-banner--${props.variant}`}
      role="status"
      aria-live="polite"
      data-variant={props.variant}
    >
      <div className="wb-connection-banner__icon" aria-hidden="true">
        {iconChar}
      </div>
      <div className="wb-connection-banner__body">
        <h3 className="wb-connection-banner__title">{title}</h3>
        <p className="wb-connection-banner__description">{description}</p>
      </div>
      <div className="wb-connection-banner__actions">
        {props.onSecondaryAction && props.secondaryActionLabel && (
          <button
            type="button"
            className="wb-button wb-button--secondary wb-connection-banner__secondary"
            onClick={handleSecondary}
            aria-label={props.secondaryActionLabel}
          >
            {props.secondaryActionLabel}
          </button>
        )}
        <button
          type="button"
          className="wb-button wb-button--primary wb-connection-banner__primary"
          onClick={handlePrimary}
          autoFocus
          aria-label={primaryActionLabel}
        >
          {primaryActionLabel}
        </button>
        {props.onDismiss && (
          <button
            type="button"
            className="wb-button wb-button--ghost wb-connection-banner__dismiss"
            onClick={handleDismiss}
            aria-label="关闭提示"
            title="关闭提示"
          >
            ×
          </button>
        )}
      </div>
    </aside>
  );
}

/**
 * 是否应该显示 ConnectionBanner。
 * EmailPanel 在以下 3 种条件下渲染 banner:
 *   1. 完全无 provider
 *   2. provider 部分能力
 *   3. token 过期
 */
export function shouldShowConnectionBanner(input: {
  accountsLength: number;
  providerReadiness?: "ready" | "partial" | "reauthorization-required" | "unavailable";
}): ConnectionBannerVariant | null {
  if (input.accountsLength > 0) return null;
  if (input.providerReadiness === "reauthorization-required") return "reauthorize";
  if (input.providerReadiness === "partial") return "partial";
  // accountsLength === 0 + readiness undefined OR "unavailable" → no-provider
  return "no-provider";
}
