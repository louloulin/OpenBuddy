/**
 * @openbuddy/ui-mcp/InstallPreflightDialog — 安装前的「会发生什么」确认框。
 *
 * 只做展示 + 两个回调(取消 / 继续安装),不自己发 IPC —— 这样面板、插件注册的
 * 替换实现、未来的 CLI 都能复用同一份文案(判断在 `install-preflight.ts`)。
 *
 * 与内核 `ConfirmDialog` 的关系:那个是"一句话 + 两个按钮"的通用确认;这里要
 * 摊开一列事实与风险(来源、版本、hooks、能力接管),所以自带一个面板 —— 但
 * 视觉 token、Esc 关闭、role="alertdialog" 都沿用同一套约定。
 */
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { InstallPreflight, PreflightItem, PreflightLevel } from "./install-preflight";
import styles from "./InstallPreflightDialog.module.css";

const LEVEL_CLASS: Record<PreflightLevel, string> = {
  info: styles.itemInfo,
  warning: styles.itemWarning,
  danger: styles.itemDanger,
};

const ACTION_LABEL: Record<InstallPreflight["action"], string> = {
  install: "全新安装",
  upgrade: "升级",
  reinstall: "重新安装",
};

function PreflightItems({ items }: { items: PreflightItem[] }) {
  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.item} ${LEVEL_CLASS[item.level]}`}
          data-testid={`preflight-item-${item.id}`}
          data-level={item.level}
        >
          <span className={styles.itemLabel}>{item.label}</span>
          <span className={styles.itemDetail}>{item.detail}</span>
        </div>
      ))}
    </>
  );
}

export interface InstallPreflightDialogProps {
  open: boolean;
  plan: InstallPreflight | null;
  onCancel(): void;
  /** 用户确认后调用;阻断项存在时按钮不可点,所以这里不会被调用。 */
  onConfirm(): void;
}

export function InstallPreflightDialog({ open, plan, onCancel, onConfirm }: InstallPreflightDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  // 焦点落在主按钮上(与内核 ConfirmDialog 一致),回车即可确认。
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  const stopPropagation = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);

  if (!open || !plan) return null;

  const blocked = plan.blockers.length > 0;
  const target = `${plan.pluginName}${plan.version ? ` v${plan.version}` : ""}`;

  return createPortal(
    <div className={styles.overlay} data-testid="install-preflight" onClick={onCancel}>
      <div
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={`安装 ${target}`}
        onClick={stopPropagation}
      >
        <div>
          <p className={styles.eyebrow}>安装预检 · {ACTION_LABEL[plan.action]}</p>
          <h2 className={styles.title}>{target}</h2>
          <p className={styles.subtitle}>
            来自 {plan.sourceName}({plan.sourceKind === "remote" ? "远程源" : plan.sourceKind === "local" ? "本机目录" : "未知来源"})
            {plan.takeover ? ` · 安装后接管「${plan.takeover.capabilityLabel}」` : ""}
          </p>
        </div>
        <div className={styles.body}>
          {blocked && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>无法安装</span>
              <PreflightItems items={plan.blockers} />
            </div>
          )}
          {plan.risks.length > 0 && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>请先确认({plan.risks.length})</span>
              <PreflightItems items={plan.risks} />
            </div>
          )}
          <div className={styles.group}>
            <span className={styles.groupLabel}>这次会发生什么</span>
            <PreflightItems items={plan.facts} />
          </div>
        </div>
        <div className={styles.footer}>
          <span className={styles.hint}>按 Esc 取消</span>
          <button type="button" className={styles.cancel} onClick={onCancel} data-testid="install-preflight-cancel">
            取消
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`${styles.confirm}${plan.risks.some((risk) => risk.level === "danger") ? ` ${styles.confirmDanger}` : ""}`}
            onClick={onConfirm}
            disabled={blocked}
            data-testid="install-preflight-confirm"
          >
            {blocked ? "无法安装" : plan.action === "upgrade" ? "升级" : plan.action === "reinstall" ? "重新安装" : "安装"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
