import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** 无 title 时给 `role="dialog"` 的可访问名称。默认「对话框」。 */
  ariaLabel?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, footer, children, ariaLabel = "对话框" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 打开时把焦点移进对话框，关闭时还给触发元素 —— `aria-modal` 只有配上
  // 这两步才成立：读屏用户进入后知道自己在弹窗里，Esc 之后焦点也不会丢在
  // 一个已经被卸载的节点上。
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
    };
  }, [open]);

  // Tab 循环：焦点不能从弹窗里跑到背后的页面上去。挂在 dialog 节点上
  // 而不是 React 的 onKeyDown —— role="dialog" 在读屏里不是可交互角色，
  // 交互键由内部真正的 button / input 承担。
  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.backdrop}>
      {/* 遮罩是一个真正的 button，而不是「带 onClick 的 div」。
          tabIndex={-1}：鼠标用户点它关闭；键盘用户走 Esc 或弹窗内的关闭按钮，
          不必在 Tab 序列里多停一个看不见的全屏控件。 */}
      {onClose ? (
        <button
          type="button"
          aria-label="关闭对话框"
          tabIndex={-1}
          onClick={onClose}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "default",
          }}
        />
      ) : null}
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        style={{ position: "relative", zIndex: 1 }}
      >
        {title ? <header className={styles.header} id={titleId}>{title}</header> : null}
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </div>
    </div>
  );
}