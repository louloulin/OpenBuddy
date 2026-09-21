/**
 * useVirtualList — 极简虚拟列表(无依赖,P3-3)。
 *
 * 设计目标:
 *   - 平替 AiInboxShell 的 `<ul>`,支持 10k+ 线程滚动 60fps。
 *   - 仅渲染视口 + overscan 范围内的行,其它保留占位高度。
 *   - 不依赖 react-window / tanstack-virtual — 自己写 ~80 行,免去 lockfile 改动。
 *
 * 行为:
 *   - 容器高度自管理(scrollHeight = items.length * itemHeight)。
 *   - 滚动事件触发 startIndex / endIndex 重算。
 *   - itemHeight 必须固定 — 不同高度需求暂未覆盖(邮件列表通常固定行高)。
 *
 * 边界:
 *   - 容器没有滚动时不返回 only visible — 渲染全部(列表短时,避免额外开销)。
 *   - scrollTop=0 时,startIndex=0。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export interface UseVirtualListArgs {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

export interface VirtualItem<T> {
  index: number;
  item: T;
  style: CSSProperties;
  /** data-attr 方便测试 */
  dataIndex: number;
}

export interface VirtualListSlice<T> {
  containerRef: React.RefObject<HTMLDivElement>;
  innerStyle: CSSProperties;
  items: Array<VirtualItem<T>>;
  /** 当前视口起止 index,用于外部 a11y 标签。 */
  startIndex: number;
  endIndex: number;
  /** 容器实际滚动高度 — 用于 CSS layout。 */
  totalHeight: number;
}

const DEFAULT_OVERSCAN = 6;
const DEFAULT_VIEWPORT_FALLBACK = 600;

export function useVirtualList<T>(items: readonly T[], {
  itemCount,
  itemHeight,
  overscan = DEFAULT_OVERSCAN,
}: UseVirtualListArgs): VirtualListSlice<T> {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // 默认容器高度 — 视口模式启用前用 600 估算,避免在 jsdom / SSR 下渲染全部 10000+ 项。
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const handleScroll = () => setScrollTop(container.scrollTop);
    const handleResize = () => {
      const h = container.clientHeight;
      // jsdom 下 clientHeight 始终是 0 — 此时保持 null(沿用默认估算),不要
      // 退化到"渲染全部"分支,否则 10k 列表会瞬间回退到无虚拟化状态。
      if (h > 0) setMeasuredHeight(h);
    };
    handleResize();
    container.addEventListener("scroll", handleScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    if (ro) ro.observe(container);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      ro?.disconnect();
    };
  }, []);

  const totalHeight = itemCount * itemHeight;

  // 视口 + overscan 范围。
  // measuredHeight 未到位(jsdom/SSR 测量失败)时用 DEFAULT_VIEWPORT_FALLBACK,
  // 绝不允许退化成"渲染 itemCount 全部"。
  const effectiveHeight = measuredHeight ?? DEFAULT_VIEWPORT_FALLBACK;
  const visibleCount = Math.min(itemCount, Math.ceil(effectiveHeight / itemHeight));
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(itemCount, startIndex + visibleCount + overscan * 2);

  const slice = useMemo(() => {
    const out: Array<VirtualItem<T>> = [];
    for (let i = startIndex; i < endIndex; i++) {
      out.push({
        index: i,
        item: items[i] as T,
        style: {
          position: "absolute",
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        },
        dataIndex: i,
      });
    }
    return out;
  }, [items, startIndex, endIndex, itemHeight]);

  const innerStyle: CSSProperties = useMemo(() => ({
    position: "relative",
    height: totalHeight,
  }), [totalHeight]);

  return {
    containerRef,
    innerStyle,
    items: slice,
    startIndex,
    endIndex,
    totalHeight,
  };
}
