/**
 * useRowPanelNav —— Claude row-panel 方向键导航的单元测试。
 *
 * mutation 可杀:删掉 offsetParent 过滤(隐藏行用例红)、删掉 rows[next].focus
 * (移动用例红)、删掉"焦点不在行上不拦截"(最后一个用例红)。
 */
// @vitest-environment jsdom
import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useRowPanelNav } from "../useRowPanelNav";

function Harness({ rows, hiddenIndex }: { rows: number; hiddenIndex?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useRowPanelNav({ containerRef, rowSelector: "[data-row]" });
  return (
    <div ref={containerRef}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          data-row=""
          role="option"
          aria-selected={false}
          tabIndex={0}
          style={i === hiddenIndex ? { display: "none" } : undefined}
        >
          row-{i}
        </div>
      ))}
    </div>
  );
}

function mount(rows: number, hiddenIndex?: number) {
  const view = render(<Harness rows={rows} hiddenIndex={hiddenIndex} />);
  const container = view.container.firstElementChild as HTMLElement;
  const rowEls = Array.from(container.querySelectorAll<HTMLElement>("[data-row]"));
  return { view, container, rowEls };
}

function key(container: HTMLElement, keyName: string) {
  act(() => {
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }),
    );
  });
}

describe("useRowPanelNav", () => {
  it("ArrowDown / ArrowUp 在相邻行之间移动焦点", () => {
    const { container, rowEls } = mount(3);
    act(() => rowEls[0].focus());
    key(container, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("row-1");
    key(container, "ArrowUp");
    expect(document.activeElement?.textContent).toBe("row-0");
  });

  it("Home 跳第一行,End 跳最后一行", () => {
    const { container, rowEls } = mount(3);
    act(() => rowEls[1].focus());
    key(container, "Home");
    expect(document.activeElement?.textContent).toBe("row-0");
    key(container, "End");
    expect(document.activeElement?.textContent).toBe("row-2");
  });

  it("隐藏行(display:none)被跳过", () => {
    const { container, rowEls } = mount(3, 1);
    act(() => rowEls[0].focus());
    key(container, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("row-2");
  });

  it("焦点不在任何行上时不拦截方向键(容器可正常滚动)", () => {
    const { container } = mount(2);
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
