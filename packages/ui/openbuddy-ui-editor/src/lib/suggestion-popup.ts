/**
 * suggestion-popup —— 极小的浮层控制器(TipTap suggestion 与 React 的桥)。
 *
 * 为什么不用 `@tiptap/react` 的 `ReactRenderer`:它把"渲染什么"和
 * "什么时候销毁"绑在 suggestion 生命周期里,难以做插槽化(宿主想换菜单
 * 组件就得改扩展)。这里只保留最小职责——挂载一个 div、把位置算好、
 * 交给 React 渲染,菜单内容完全由调用方决定。
 *
 * 无框架依赖的 DOM 部分被单独抽出来,便于在 jsdom 里单测。
 */

import type { ReactNode } from "react";

/** 结构化矩形 —— `DOMRect` 与 TipTap 的 `coordsAtPos` 结果都可直接传入。 */
export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width?: number;
  height?: number;
}

export interface PopupPosition {
  /** viewport 坐标(fixed 定位)。 */
  left: number;
  top: number;
  /** 浮层应该向上翻时的标记,供 CSS 做动画方向。 */
  placement: "bottom-start" | "top-start";
}

const POPUP_MARGIN = 8;
const FLIP_THRESHOLD = 240;

/**
 * 根据锚点矩形计算浮层位置。锚点缺失(如 jsdom 的零矩形)时回退到左上角,
 * 保证浮层仍然可见而不是跑到屏幕外。
 */
export function computePopupPosition(
  rect: RectLike | null,
  size: { width: number; height: number } = { width: 320, height: FLIP_THRESHOLD },
  viewport: { width: number; height: number } = { width: 1024, height: 768 },
): PopupPosition {
  if (!rect) {
    return { left: POPUP_MARGIN, top: POPUP_MARGIN, placement: "bottom-start" };
  }
  const spaceBelow = viewport.height - rect.bottom;
  const placement: PopupPosition["placement"] =
    spaceBelow < size.height && rect.top > spaceBelow ? "top-start" : "bottom-start";
  const top = placement === "bottom-start" ? rect.bottom + 6 : Math.max(POPUP_MARGIN, rect.top - size.height - 6);
  const maxLeft = Math.max(POPUP_MARGIN, viewport.width - size.width - POPUP_MARGIN);
  return {
    left: Math.min(Math.max(rect.left, POPUP_MARGIN), maxLeft),
    top,
    placement,
  };
}

export interface SuggestionPopup {
  /** 浮层容器(已挂到 appendTo)。 */
  element: HTMLElement;
  /** 渲染 / 更新内容。 */
  render(node: ReactNode): void;
  /** 更新锚点位置。 */
  position(rect: RectLike | null): void;
  /** 卸载 React 树并移除容器。 */
  destroy(): void;
}

/**
 * 创建浮层。`renderer` 由调用方提供(通常是 `createRoot`),抽成参数是为了
 * 让单元测试可以注入一个不依赖 React 的假实现。
 */
export function createSuggestionPopup(deps: {
  createRenderer: (container: HTMLElement) => { render(node: ReactNode): void; unmount(): void };
  appendTo?: HTMLElement | null;
  className?: string;
}): SuggestionPopup {
  const container = document.createElement("div");
  container.className = deps.className ?? "ob-editor-suggestion-popup";
  container.setAttribute("data-ob-editor-popup", "true");
  container.style.position = "fixed";
  container.style.zIndex = "60";
  const host = deps.appendTo ?? document.body;
  host.appendChild(container);

  const renderer = deps.createRenderer(container);
  let destroyed = false;

  return {
    element: container,
    render(node) {
      if (destroyed) return;
      renderer.render(node);
    },
    position(rect) {
      if (destroyed) return;
      const measured = container.getBoundingClientRect();
      const pos = computePopupPosition(rect, {
        width: measured.width || 320,
        height: measured.height || FLIP_THRESHOLD,
      });
      container.dataset.placement = pos.placement;
      container.style.left = `${pos.left}px`;
      container.style.top = `${pos.top}px`;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      renderer.unmount();
      container.remove();
    },
  };
}
