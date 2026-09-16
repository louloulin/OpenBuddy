/**
 * suggestion-popup 单测 —— 定位算法 + 浮层生命周期(用假 renderer,不依赖 React)。
 */
import { describe, expect, it, vi } from "vitest";
import { computePopupPosition, createSuggestionPopup } from "../lib/suggestion-popup";

function rect(top: number, bottom: number, left: number, right: number) {
  return { top, bottom, left, right };
}

describe("computePopupPosition", () => {
  it("锚点缺失时回退到左上角,不跑出屏幕", () => {
    expect(computePopupPosition(null)).toEqual({
      left: 8,
      top: 8,
      placement: "bottom-start",
    });
  });

  it("下方空间足够时向下展开", () => {
    const pos = computePopupPosition(rect(100, 120, 40, 80), { width: 200, height: 100 }, { width: 1000, height: 800 });
    expect(pos.placement).toBe("bottom-start");
    expect(pos.top).toBe(126);
    expect(pos.left).toBe(40);
  });

  it("下方空间不足且上方更宽裕时向上翻转", () => {
    const pos = computePopupPosition(rect(700, 780, 40, 80), { width: 200, height: 300 }, { width: 1000, height: 800 });
    expect(pos.placement).toBe("top-start");
    expect(pos.top).toBe(700 - 300 - 6);
  });

  it("左侧越界被夹到边距", () => {
    const pos = computePopupPosition(rect(100, 120, -50, 10), { width: 200, height: 100 }, { width: 1000, height: 800 });
    expect(pos.left).toBe(8);
  });

  it("右侧越界被夹回视口内", () => {
    const pos = computePopupPosition(rect(100, 120, 900, 980), { width: 200, height: 100 }, { width: 1000, height: 800 });
    expect(pos.left).toBe(792);
  });
});

describe("createSuggestionPopup", () => {
  function makeDeps() {
    const rendered: unknown[] = [];
    const unmount = vi.fn();
    const createRenderer = () => ({
      render: (node: unknown) => rendered.push(node),
      unmount,
    });
    return { rendered, unmount, createRenderer };
  }

  it("挂到 document.body 并带 data 标记", () => {
    const deps = makeDeps();
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer });
    expect(document.body.contains(popup.element)).toBe(true);
    expect(popup.element.getAttribute("data-ob-editor-popup")).toBe("true");
    popup.destroy();
  });

  it("render 转发给 renderer", () => {
    const deps = makeDeps();
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer });
    popup.render("hello" as never);
    expect(deps.rendered).toEqual(["hello"]);
    popup.destroy();
  });

  it("position 写入 left/top/placement", () => {
    const deps = makeDeps();
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer });
    popup.position(rect(100, 120, 30, 60));
    expect(popup.element.style.left).toBe("30px");
    expect(["bottom-start", "top-start"]).toContain(popup.element.dataset.placement);
    popup.destroy();
  });

  it("destroy 卸载 React 树并移除节点,且幂等", () => {
    const deps = makeDeps();
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer });
    popup.destroy();
    popup.destroy();
    expect(deps.unmount).toHaveBeenCalledTimes(1);
    expect(document.body.contains(popup.element)).toBe(false);
  });

  it("destroy 之后 render / position 是 no-op", () => {
    const deps = makeDeps();
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer });
    popup.destroy();
    popup.render("x" as never);
    popup.position(rect(1, 2, 3, 4));
    expect(deps.rendered).toEqual([]);
  });

  it("可挂到自定义容器", () => {
    const deps = makeDeps();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const popup = createSuggestionPopup({ createRenderer: deps.createRenderer, appendTo: host });
    expect(host.contains(popup.element)).toBe(true);
    popup.destroy();
  });
});
