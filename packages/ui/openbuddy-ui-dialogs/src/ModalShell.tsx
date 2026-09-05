import { useEffect } from "react";

export type ModalTone = "info" | "warning" | "danger" | "neutral";

export interface ModalShellProps {
  open: boolean;
  /**
   * Visual tone that drives:
   * - icon block color (when paired with ModalHead + ModalIcon)
   * - tone-aware border glow (`box-shadow`)
   * - default confirm button tone
   */
  tone?: ModalTone;
  /**
   * Width preset. `sm` is suited for confirm/prompt, `md` for form dialogs,
   * `lg`/`xl` for content-rich dialogs like help panels. The shell always
   * caps at `100vw - 32px`.
   */
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * Variant hint that influences internal padding/spacing defaults.
   * - `default`: balanced layout
   * - `prompt`: tighter body padding (single field focused)
   * - `wide`: large content area with breathing room
   */
  variant?: "default" | "prompt" | "wide";
  /** Optional accessible label; falls back to children's title text. */
  ariaLabel?: string;
  /** ARIA role. Confirmations should use "alertdialog"; generic dialogs "dialog". */
  role?: "dialog" | "alertdialog";
  /** Extra class appended to the request-modal shell (e.g. request-modal--confirm). */
  className?: string;
  /** Close on Esc. Default true. */
  closeOnEsc?: boolean;
  /** Close on backdrop click. Default true. Set false for irreversible dialogs. */
  closeOnBackdrop?: boolean;
  /** When true, disables Esc + backdrop close (e.g. while busy). */
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Foundation modal component for the entire openbuddy UI.
 *
 * Responsibilities:
 * - Fullscreen overlay with `backdrop-filter: blur(...)` and animated entry
 * - Toned card border glow (info / warning / danger / neutral)
 * - Esc + backdrop close behavior with busy guard
 * - Body scroll lock while open
 * - ARIA: `role="dialog"` + `aria-modal` + `aria-label`
 *
 * Used by ConfirmDialog, PromptDialog, and inline dialogs in feature
 * panels (EmailPanel, etc). Layout is intentionally flexible so each
 * dialog can compose its own head/body/footer.
 */
export function ModalShell({
  open,
  tone = "info",
  size = "md",
  variant = "default",
  ariaLabel,
  role = "dialog",
  className,
  closeOnEsc = true,
  closeOnBackdrop = true,
  busy = false,
  onClose,
  children,
}: ModalShellProps) {
  useEffect(() => {
    if (!open || (!closeOnEsc && !closeOnBackdrop)) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (busy) return;
      if (event.key === "Escape" && closeOnEsc) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, closeOnEsc, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const shellClass = [
    "request-modal",
    `request-modal--${tone}`,
    `request-modal--${size}`,
    variant === "prompt" ? "request-modal--prompt" : "",
    variant === "wide" ? "request-modal--wide" : "",
    className ? className : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="request-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (!closeOnBackdrop || busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={shellClass}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}

export interface ModalHeadProps {
  icon?: React.ReactNode;
  /** Small uppercase eyebrow text above the title (e.g. "提示" / "需要确认"). */
  eyebrow?: React.ReactNode;
  /** Main title rendered as an h2. */
  title: React.ReactNode;
  /** Optional secondary badge/pill rendered right after the title row. */
  badge?: React.ReactNode;
  /** Optional meta rendered top-right of the head (badges, kind, step labels). */
  meta?: React.ReactNode;
  /** Optional close button. */
  onClose?: () => void;
}

/**
 * Head section of a workbuddy-style dialog. Renders the icon block,
 * eyebrow + title hierarchy, optional badge/meta and close button.
 */
export function ModalHead({
  icon,
  eyebrow,
  title,
  badge,
  meta,
  onClose,
}: ModalHeadProps) {
  return (
    <div className="request-modal__head">
      <div className="request-modal__identity">
        {icon ? (
          <span className="request-modal__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="request-modal__heading">
          {eyebrow ? <span className="request-modal__eyebrow">{eyebrow}</span> : null}
          <div className="request-modal__title-row">
            <h2 className="request-modal__title">{title}</h2>
            {badge ? <span className="request-modal__badge">{badge}</span> : null}
          </div>
        </div>
      </div>
      <div className="request-modal__head-meta">
        {meta}
        {onClose ? (
          <button
            type="button"
            className="request-modal__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6 L18 18" />
              <path d="M18 6 L6 18" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Body section of a workbuddy-style dialog. Use as the scrollable middle
 * region. Optional `divided` flag adds a top border between the body and
 * adjacent content (useful for stacked sections like help grids).
 */
export function ModalBody({
  divided,
  padded = true,
  className,
  children,
}: {
  divided?: boolean;
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = [
    "request-modal__body",
    padded ? "" : "request-modal__body--flush",
    divided ? "request-modal__body--divided" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}

/**
 * Footer section of a workbuddy-style dialog. Renders hint text on the
 * left and action buttons on the right. Buttons are passed as children so
 * the caller can choose tone (primary / danger / ghost).
 */
export function ModalFooter({
  hint,
  className,
  children,
}: {
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = ["request-modal__footer", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {hint ? <span className="request-modal__hint">{hint}</span> : <span />}
      <div className="request-modal__actions">{children}</div>
    </div>
  );
}
