import { useEffect, useState } from "react";

export function ProjectInputDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "确定",
  onCancel,
  onConfirm,
}: {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter" && !event.isComposing && value.trim()) {
        event.preventDefault();
        onConfirm(value.trim());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onConfirm, value]);

  return (
    <div className="modal-overlay project-dialog-overlay" onClick={onCancel}>
      <div className="create-colleague-dialog project-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="create-colleague-header">
          <h3>{title}</h3>
          <button type="button" className="create-colleague-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <div className="create-colleague-body">
          <label className="create-colleague-field">
            {label && <span className="create-colleague-label">{label}</span>}
            <input
              className="create-colleague-input"
              value={value}
              placeholder={placeholder}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        </div>
        <div className="create-colleague-footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn--primary" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function ProjectConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay project-dialog-overlay" onClick={onCancel}>
      <div className="create-colleague-dialog project-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="create-colleague-header">
          <h3>{title}</h3>
          <button type="button" className="create-colleague-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>
        <div className="create-colleague-body project-dialog__message">{message}</div>
        <div className="create-colleague-footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn--primary" onClick={onConfirm}>确定</button>
        </div>
      </div>
    </div>
  );
}
