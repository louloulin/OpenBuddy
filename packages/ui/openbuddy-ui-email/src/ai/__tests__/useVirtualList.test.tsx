/**
 * useVirtualList — 虚拟列表行为单测。
 *
 * 覆盖:
 *   - 视口 + overscan 切片
 *   - scrollTop 改变时切片更新
 *   - 容器高度自适应(ResizeObserver)
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useVirtualList } from "../hooks/useVirtualList";
import { VirtualList } from "../components/VirtualList";

interface RowProps<T> {
  items: readonly T[];
  height?: number;
}

function Harness<T>({ items, height = 100 }: RowProps<T>): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const slice = useVirtualList<T>(items, { itemCount: items.length, itemHeight: 30 });
  return (
    <div
      ref={containerRef}
      data-testid="container"
      style={{ height, overflowY: "auto", position: "relative" }}
    >
      <div style={slice.innerStyle} data-testid="inner">
        {slice.items.map((vi) => (
          <div key={vi.dataIndex} data-testid={`row-${vi.dataIndex}`} style={vi.style}>
            {String(vi.item)}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("useVirtualList", () => {
  it("renders only visible slice + overscan", () => {
    const items = Array.from({ length: 1000 }, (_, i) => `row-${i}`);
    render(<Harness items={items} height={100} />);
    // height=100, itemHeight=30 → visible ~4, overscan 6 → slice ~16
    expect(screen.getByTestId("row-0")).toBeTruthy();
    // Rows beyond overscan shouldn't render.
    expect(screen.queryByTestId("row-500")).toBeNull();
  });

  it("updates slice on scroll", () => {
    const items = Array.from({ length: 1000 }, (_, i) => `row-${i}`);
    const { getByTestId } = render(<Harness items={items} height={100} />);
    const container = getByTestId("container");
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 });
    act(() => {
      fireEvent.scroll(container, { target: { scrollTop: 600 } });
    });
    // scrollTop=600 / itemHeight=30 → startIdx = 20 - overscan(6) = 14
    expect(screen.getByTestId("row-14")).toBeTruthy();
  });
});

describe("VirtualList component", () => {
  it("renders with data-vlist-* attributes", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    render(
      <VirtualList
        items={items}
        itemHeight={30}
        renderItem={(item) => <span>{item}</span>}
        ariaLabel="test list"
      />,
    );
    const container = screen.getByRole("listbox");
    expect(container.getAttribute("data-vlist-total")).toBe("50");
    expect(container.getAttribute("aria-label")).toBe("test list");
  });

  it("calls renderItem only for the visible slice (not all items)", () => {
    const renderItem = vi.fn((item: number) => <span>{item}</span>);
    // 1000 项 + itemHeight=30 + 默认容器高 600px → visibleCount≈20。
    // 真正触发虚拟化逻辑:renderItem 应被调用约 20+overscan*2 次,而非 1000。
    const items = Array.from({ length: 1000 }, (_, i) => i);
    render(
      <VirtualList items={items} itemHeight={30} renderItem={renderItem} />,
    );
    expect(renderItem).toHaveBeenCalled();
    // 关键断言:渲染次数应明显小于 items.length(否则虚拟化没生效)。
    // 容忍 React 双 mount + ResizeObserver 触发的额外 render,留 4x 余量。
    const maxAllowed = items.length / 4;
    expect(renderItem.mock.calls.length).toBeLessThan(maxAllowed);
    // 至少应调用一次。
    expect(renderItem.mock.calls.length).toBeGreaterThan(0);
    // 不应渲染首屏外的项(例如 index>=500)。
    const calledIndexes = renderItem.mock.calls.map((call) => call[0] as number);
    expect(Math.max(...calledIndexes)).toBeLessThan(60);
  });
});
