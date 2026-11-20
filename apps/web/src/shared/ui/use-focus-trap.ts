/**
 * 焦点陷阱 (B4): while a modal is open, Tab / Shift+Tab cycle inside it and closing restores
 * focus to the element that opened it. Used by 设备码授权、分享、技能详情、链接导入.
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hadTabIndex = node.hasAttribute("tabindex");
    if (!hadTabIndex) node.setAttribute("tabindex", "-1");

    const items = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true")
        .filter((element) => element.offsetParent !== null || element === document.activeElement);

    const first = items()[0];
    (first ?? node).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = items();
      if (focusable.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const head = focusable[0];
      const tail = focusable[focusable.length - 1];
      const current = document.activeElement;
      const outside = !(current instanceof Node) || !node.contains(current);
      if (event.shiftKey && (outside || current === head)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && (outside || current === tail)) {
        event.preventDefault();
        head.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      if (!hadTabIndex) node.removeAttribute("tabindex");
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
