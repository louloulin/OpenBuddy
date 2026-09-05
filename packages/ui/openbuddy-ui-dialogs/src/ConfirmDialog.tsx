import { useEffect } from "react";
import { ModalShell, ModalHead, ModalBody, ModalFooter, type ModalTone } from "./ModalShell";
import { ModalIcon } from "./ModalIcon";

export type ConfirmTone = ModalTone;

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 弹框语义:info=普通提示(brand)、warning=需要二次确认(warning)、danger=危险操作(error)、neutral=无强调。 */
  tone?: ConfirmTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 通用确认弹框 —— 套用 workbuddy `request-modal` 风格。
 *
 * 用来替代原生 `window.confirm` / `window.prompt`:
 * - 顶部居中 modal,带遮罩 + 进入动画;
 * - title/description/confirm/cancel 四段式;
 * - Esc 取消、Enter 确认、点击遮罩取消(忙时忽略);
 * - tone 控制图标颜色和确认按钮风格。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "info",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Enter to confirm. (Esc/backdrop handled by ModalShell.)
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (busy) return;
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, onConfirm]);

  const confirmClass =
    "btn " + (tone === "danger" ? "btn--danger" : "btn--primary");
  const eyebrowText =
    tone === "danger"
      ? "危险操作"
      : tone === "warning"
      ? "需要确认"
      : tone === "neutral"
      ? "提示"
      : "提示";

  return (
    <ModalShell
      open={open}
      tone={tone}
      size="sm"
      variant="prompt"
      role="alertdialog"
      className="request-modal--confirm"
      ariaLabel={title}
      busy={busy}
      onClose={onCancel}
    >
      <ModalHead
        icon={<ModalIcon tone={tone === "neutral" ? "info" : tone} />}
        eyebrow={eyebrowText}
        title={title}
      />
      {description ? (
        <ModalBody>
          <p className="request-modal__description">{description}</p>
        </ModalBody>
      ) : null}
      <ModalFooter hint="按 Esc 取消 · Enter 确认">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={confirmClass}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {confirmLabel}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
