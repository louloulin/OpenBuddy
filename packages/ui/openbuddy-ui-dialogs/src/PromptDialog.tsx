import { useEffect, useState } from "react";
import type { ConfirmTone } from "./ConfirmDialog";
import { ModalShell, ModalHead, ModalBody, ModalFooter } from "./ModalShell";
import { ModalIcon } from "./ModalIcon";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, render a multi-line textarea instead of a single-line input. */
  multiline?: boolean;
  placeholder?: string;
  defaultValue?: string;
  /** Validate user input. Return an error message to show inline and block confirm; return null/undefined to allow. */
  validate?: (value: string) => string | null | undefined;
  /** Hint shown below the input (e.g. format example). */
  hint?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Workbuddy-style prompt dialog used to replace the ugly native
 * `window.prompt`. Mirrors {@link ConfirmDialog}'s modal shell so the
 * visual language stays consistent across confirm + prompt surfaces.
 *
 * Features:
 * - single line / multi-line textarea
 * - default value + placeholder + hint
 * - inline validation error
 * - Esc 取消、Enter 确认 (Cmd/Ctrl+Enter 在多行模式)
 * - tone 控制图标与确认按钮颜色
 */
export function PromptDialog({
  open,
  title,
  description,
  tone = "info",
  busy = false,
  confirmLabel = "确定",
  cancelLabel = "取消",
  multiline = false,
  placeholder,
  defaultValue = "",
  validate,
  hint,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (busy) return;
      if (event.key === "Enter" && !event.isComposing) {
        // Allow newline inside textareas via plain Enter; confirm on Cmd/Ctrl+Enter.
        if (multiline && !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        const reason = validate?.(value) ?? null;
        if (reason) { setError(reason); return; }
        onConfirm(value);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, multiline, value, validate, onCancel, onConfirm]);

  if (!open) return null;

  const submit = () => {
    const reason = validate?.(value) ?? null;
    if (reason) { setError(reason); return; }
    onConfirm(value);
  };

  const inputClass = `request-modal__input${multiline ? " request-modal__input--multiline" : ""}`;
  const eyebrowText =
    tone === "danger"
      ? "危险操作"
      : tone === "warning"
      ? "需要确认"
      : tone === "neutral"
      ? "请输入"
      : "请输入";

  return (
    <ModalShell
      open={open}
      tone={tone}
      size="sm"
      variant="prompt"
      ariaLabel={title}
      busy={busy}
      onClose={onCancel}
    >
      <ModalHead
        icon={<ModalIcon tone={tone === "neutral" ? "info" : tone} />}
        eyebrow={eyebrowText}
        title={title}
      />
      <ModalBody>
        {description ? <p className="request-modal__description">{description}</p> : null}
        {multiline ? (
          <textarea
            className={inputClass}
            value={value}
            placeholder={placeholder}
            autoFocus
            disabled={busy}
            onChange={(event) => { setValue(event.target.value); if (error) setError(null); }}
            rows={4}
          />
        ) : (
          <input
            type="text"
            className={inputClass}
            value={value}
            placeholder={placeholder}
            autoFocus
            disabled={busy}
            onChange={(event) => { setValue(event.target.value); if (error) setError(null); }}
          />
        )}
        {(hint || error) && (
          <p className={`request-modal__hint-inline${error ? " request-modal__hint-inline--error" : ""}`}>
            {error ?? hint}
          </p>
        )}
      </ModalBody>
      <ModalFooter hint={multiline ? "Shift+Enter 换行 · Cmd/Ctrl+Enter 确认" : "按 Esc 取消 · Enter 确认"}>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${tone === "danger" ? "btn--danger" : "btn--primary"}`}
          onClick={submit}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
