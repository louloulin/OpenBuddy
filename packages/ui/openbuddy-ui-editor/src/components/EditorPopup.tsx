/**
 * EditorPopup —— 气泡菜单 / 悬浮菜单共用的浮层容器。
 *
 * 不用 `@tiptap/react/menus` 的原因:那两个组件把定位逻辑封在插件里,
 * 宿主无法换成插槽提供的菜单。这里只做"portal + fixed 定位"这一件事,
 * 菜单内容与显示条件完全由调用方决定。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { computePopupPosition, type RectLike } from "../lib/suggestion-popup";
import styles from "./EditorPopup.module.css";

export interface EditorPopupProps {
  visible: boolean;
  /** 锚点矩形(viewport 坐标)。 */
  rect: RectLike | null;
  children: ReactNode;
  className?: string;
  /** 无障碍角色,默认 toolbar。 */
  role?: string;
  ariaLabel?: string;
}

export function EditorPopup({
  visible,
  rect,
  children,
  className,
  role = "toolbar",
  ariaLabel = "格式工具栏",
}: EditorPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ left: 0, top: 0, placement: "bottom-start" });

  useLayoutEffect(() => {
    if (!visible) return;
    const measured = ref.current?.getBoundingClientRect();
    const viewport = {
      width: typeof window === "undefined" ? 1024 : window.innerWidth || 1024,
      height: typeof window === "undefined" ? 768 : window.innerHeight || 768,
    };
    setOffset(
      computePopupPosition(rect, {
        width: measured?.width || 280,
        height: measured?.height || 40,
      }, viewport),
    );
  }, [visible, rect]);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      data-placement={offset.placement}
      className={[styles.popup, className].filter(Boolean).join(" ")}
      style={{ left: offset.left, top: offset.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
