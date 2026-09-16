/**
 * TooltipButton.tsx — shared icon-only button with hover/focus tooltip.
 *
 * R8.11 — replaces the text-based `msg__action-btn` cells with a
 * consistent icon-only affordance across the conversation package. Used
 * by MessageItem's hover actions (复制 / MD / 重试 / 编辑 / 删除 /
 * 赞踩 / 上/下一版), ChatView's session-level controls, and anywhere
 * else a button needs:
 *
 *   1. Compact 26×26 hit area (matches PI-Desktop's `.copy-btn.icon`).
 *   2. Visible label that only appears on hover/focus (CSS pseudo tooltip
 *      — no React portal / overlay stack).
 *   3. Accessible name via `aria-label`.
 *   4. Native <button type="button"> semantics so Enter / Space activate.
 *
 * Why CSS-only tooltip: the existing OpenBuddy message-action bar lives
 * inside a streaming message row that's frequently re-rendered by the
 * agent loop. Mounting an extra portal + floating overlay per button
 * adds DOM churn that costs us 60fps. A CSS ::after with `position:absolute`
 * keeps the hit-test on the same element as the trigger and avoids any
 * extra render budget.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface TooltipButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Accessible name; also shown as the hover/focus tooltip. */
  tooltip: string;
  /** Whether to place the tooltip above (default) or below the button. */
  tooltipSide?: "top" | "bottom";
  /** Render variant; "danger" tints hover color red for destructive ops. */
  variant?: "default" | "primary" | "danger";
  /** The icon (or any node) to render inside the button. */
  children: ReactNode;
}

export const TooltipButton = forwardRef<HTMLButtonElement, TooltipButtonProps>(
  function TooltipButton(
    {
      tooltip,
      tooltipSide = "top",
      variant = "default",
      className,
      children,
      type = "button",
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    const side = tooltipSide === "bottom" ? "tt-btn--bottom" : "tt-btn--top";
    const variantCls = variant !== "default" ? ` tt-btn--${variant}` : "";
    return (
      <button
        ref={ref}
        type={type}
        className={`tt-btn ${side}${variantCls}${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel ?? tooltip}
        data-tooltip={tooltip}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export default TooltipButton;
