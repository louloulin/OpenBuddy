/**
 * ToolbarButton —— 工具栏 / 气泡菜单共用的原子按钮。
 *
 * 统一处理:active 态、disabled 态、tooltip(data-tip 走宿主的全局样式)、
 * 鼠标按下不抢焦点(否则选区会丢,气泡菜单直接消失)。
 */
import { forwardRef, type ReactNode } from "react";
import styles from "./ToolbarButton.module.css";

export interface ToolbarButtonProps {
  label: string;
  /** 展示内容(通常是一个字符或图标)。 */
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** 快捷键提示(展示在 tooltip 里)。 */
  shortcut?: string;
  className?: string;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { label, children, active, disabled, onClick, shortcut, className },
    ref,
  ) {
    const tip = shortcut ? `${label} (${shortcut})` : label;
    return (
      <button
        ref={ref}
        type="button"
        className={[styles.button, active ? styles.active : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-label={label}
        aria-pressed={active}
        data-tip={tip}
        title={tip}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </button>
    );
  },
);
