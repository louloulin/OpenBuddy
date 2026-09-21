/**
 * useFocusTrap — Tab cycling within a focus-trapped container.
 *
 * 设计目标:
 *     - 把 Tab / Shift+Tab 在 ref 内部的 focusable element 之间循环,首尾相接。
 *     - 不接管原始 focus(调用方自己 ref.current?.focus())。
 *     - 自动在 mount 时启用,在 unmount 时移除 listener,无副作用。
 *
 * 这是 email AI 闭环面板的 a11y 兜底 — AiCommandBar / ReceiptToast 在
 * 模态/浮层出现时需要把 Tab 锁定在内部。
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export interface UseFocusTrapArgs {
  enabled?: boolean;
}

export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T>,
  { enabled = true }: UseFocusTrapArgs = {},
): void {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("aria-hidden"));
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [enabled, containerRef]);
}
