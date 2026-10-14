/**
 * useRowPanelNav —— Claude Desktop row-panel 范式的方向键导航(2026-10-14)。
 *
 * 对齐真值:REA 实测 Claude 的 `data-cds-row-toggle/row-navigate` 折叠行,
 * ↑/↓ 在相邻行之间移动焦点(容器级委托,行本身只响应 Enter/Space)。
 *
 * 实现:**原生事件委托** —— hook 在 containerRef 上 addEventListener,
 * 而不是让调用方在 JSX 挂 onKeyDown。原因:容器是纯委托元素(自己不可聚焦、
 * 不消费点击),挂 React handler 会触发 jsx-a11y 的
 * no-static-element-interactions(它无法知道 handler 只对行内焦点生效)。
 *
 * 行匹配 `rowSelector`,排除显式隐藏(虚拟化列表未挂载的行本来就不在 DOM,
 * 所以不需要 offsetParent —— jsdom 无布局它恒为 null)。
 * ↑/↓ 在行间移动焦点;Home/End 跳首/末;焦点不在行上时不拦截(列表正常滚动)。
 */
import { useEffect } from "react";
import type { RefObject } from "react";

export interface RowPanelNavOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** 行元素选择器(相对 container 查找)。 */
  rowSelector: string;
  enabled?: boolean;
}

export function useRowPanelNav({ containerRef, rowSelector, enabled = true }: RowPanelNavOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
      const rows = Array.from(container.querySelectorAll<HTMLElement>(rowSelector)).filter(
        (el) => !el.hidden && el.style.display !== "none" && el.closest("[hidden]") === null,
      );
      if (rows.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? rows.indexOf(active) : -1;
      // 焦点不在任何行上时不劫持方向键(让列表正常滚动);只处理行间移动。
      if (currentIndex < 0) return;
      event.preventDefault();
      let next: number;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = rows.length - 1;
      else if (event.key === "ArrowDown") next = Math.min(rows.length - 1, currentIndex + 1);
      else next = Math.max(0, currentIndex - 1);
      if (next !== currentIndex) rows[next]?.focus();
    };
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [containerRef, rowSelector, enabled]);
}
