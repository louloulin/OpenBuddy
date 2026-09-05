import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Tones are only painted when `variant === "pill"`. Mirrors the
   * `PillTone` vocabulary so consumers can replace dedicated `<Pill/>`
   * usage with `<Button variant="pill" tone="info" />`.
   */
  tone?: ButtonTone;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  tone,
  leadingIcon,
  trailingIcon,
  loading,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [styles.btn, styles[`v_${variant}`], styles[`s_${size}`], className].filter(Boolean).join(" ");
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      data-tone={variant === "pill" ? tone ?? "neutral" : undefined}
      className={classes}
    >
      {leadingIcon ? <span className={styles.icon}>{leadingIcon}</span> : null}
      <span>{children}</span>
      {trailingIcon ? <span className={styles.icon}>{trailingIcon}</span> : null}
      {loading ? <span className={styles.spinner} aria-hidden /> : null}
    </button>
  );
}
