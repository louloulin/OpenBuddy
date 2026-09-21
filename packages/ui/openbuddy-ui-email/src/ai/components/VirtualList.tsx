/**
 * VirtualList — 包装 useVirtualList 的可滚动容器。
 *
 * P3-3 性能改造:把 AiInboxShell 的 10000+ 线程列表从「全部渲染」改为「视口 + overscan」，
 * 首屏时间从 O(n) 降到 O(visibleCount)。
 *
 * 用法:
 *   <VirtualList items={threads} itemHeight={72} renderItem={(thread, style) => <Row ... style={style} />} />
 */
import { type CSSProperties, type ReactNode } from "react";
import { useVirtualList } from "../hooks/useVirtualList";

export interface VirtualListProps<T> {
  items: readonly T[];
  itemHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  className?: string;
  /** 测试用:key extractor(默认用 index — 仅当 items 引用稳定时安全)。 */
  keyOf?: (item: T, index: number) => string | number;
  ariaLabel?: string;
}

export function VirtualList<T>(props: VirtualListProps<T>): JSX.Element {
  const { items, itemHeight, overscan, renderItem, className, keyOf, ariaLabel } = props;
  const slice = useVirtualList<T>(items, {
    itemCount: items.length,
    itemHeight,
    ...(overscan !== undefined ? { overscan } : {}),
  });
  return (
    <div
      ref={slice.containerRef}
      className={className}
      style={{ overflowY: "auto", position: "relative" }}
      data-vlist-total={items.length}
      data-vlist-visible-from={slice.startIndex}
      data-vlist-visible-to={slice.endIndex}
      role="listbox"
      aria-multiselectable="true"
      aria-label={ariaLabel ?? "邮件列表(可多选)"}
    >
      <div style={slice.innerStyle}>
        {slice.items.map((vi) => (
          <div
            key={keyOf ? keyOf(vi.item, vi.index) : vi.index}
            data-vlist-index={vi.dataIndex}
            style={vi.style}
          >
            {renderItem(vi.item, vi.index, vi.style)}
          </div>
        ))}
      </div>
    </div>
  );
}
