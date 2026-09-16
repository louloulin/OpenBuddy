/**
 * 统一标签栏 —— 对齐 WorkBuddy `agent-sidebar-ui/ArtifactTabsBar`。
 *
 * 特性：
 *  - 按标签 kind 显示图标（file → 文件 emoji，preview → 🌐，artifact/changes → 文件 emoji）
 *  - 点击切换激活标签
 *  - 关闭按钮（×）与鼠标中键关闭
 *  - 指针拖拽排序（threshold 4px，FLIP 动画过渡）
 *  - 跟随激活标签滚入视野
 *  - 竖向滚轮在标签条上转成横向滚动（触控板 / 鼠标滚轮一致）
 *  - 标签超出条宽时在右端提供「查看全部标签」溢出菜单
 *
 * 所有新增能力都是 **增量** 的：新增 props 全部可选，未传时行为与旧版
 * 完全一致（溢出菜单只在真的溢出时出现，jsdom / 窄标签集下不渲染）。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { UnifiedTab } from "@/lib/ui/use-unified-tabs";
import { ChevronDownIcon } from "@openbuddy/ui-primitives/icons";
import { pickFileEmoji } from "./file-tab-icon";
import { cx } from "./cx";
import { IS_MACOS } from "@/lib/platform/platform";
import styles from "./ArtifactTabsBar.module.css";

const DRAG_START_THRESHOLD = 4;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 按 tab kind / label 选图标内容（emoji 字符串）。 */
function pickTabIcon(tab: UnifiedTab): string {
  if (tab.kind === "preview") return "🌐";
  // file / artifact / changes：用文件名后缀映射。
  const name =
    tab.kind === "file"
      ? (tab.filePath ?? tab.label)
      : tab.kind === "artifact"
        ? (tab.subtitle ?? tab.label)
        : tab.label;
  return pickFileEmoji(name);
}

function orderTabs(tabs: UnifiedTab[], orderedIds: string[] | null): UnifiedTab[] {
  if (!orderedIds) return tabs;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const ordered: UnifiedTab[] = [];
  orderedIds.forEach((id) => {
    const t = byId.get(id);
    if (t) ordered.push(t);
  });
  tabs.forEach((t) => {
    if (!ordered.some((x) => x.id === t.id)) ordered.push(t);
  });
  return ordered;
}

function moveIdByPointer(
  order: string[],
  draggedId: string,
  pointerX: number,
  tabRefs: Map<string, HTMLElement>,
): string[] {
  const withoutDragged = order.filter((id) => id !== draggedId);
  let insertIndex = withoutDragged.length;
  for (let i = 0; i < withoutDragged.length; i += 1) {
    const node = tabRefs.get(withoutDragged[i]);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    if (pointerX < rect.left + rect.width / 2) {
      insertIndex = i;
      break;
    }
  }
  const next = [...withoutDragged];
  next.splice(insertIndex, 0, draggedId);
  return next;
}

interface DragState {
  id: string;
  startX: number;
  startY: number;
  offsetX: number;
  top: number;
  width: number;
  height: number;
  minLeft: number;
  maxLeft: number;
  hasStarted: boolean;
  initialOrder: string[];
}

interface DragSnapshot {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ArtifactTabsBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onReorder,
  overflowMenu = true,
}: {
  tabs: UnifiedTab[];
  activeTabId?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  /**
   * 标签条溢出时是否在右端显示「查看全部标签」菜单。默认开启；
   * 传 false 可完全关闭（例如宿主自己实现了溢出策略）。
   */
  overflowMenu?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const dragStateRef = useRef<DragState | null>(null);
  const visualOrderRef = useRef<string[] | null>(null);
  const previousRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const removeDragListenersRef = useRef<null | (() => void)>(null);
  const suppressNextClickRef = useRef(false);
  const [visualOrder, setVisualOrder] = useState<string[] | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<DragSnapshot | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // 无标签时组件整体返回 null（listRef 为空），用这个布尔量驱动
  // 「监听挂载 / 卸载」的副作用重新执行。
  const isEmpty = tabs.length === 0;

  const tabsById = useMemo(
    () => new Map(tabs.map((t) => [t.id, t])),
    [tabs],
  );
  const renderedTabs = useMemo(
    () => orderTabs(tabs, visualOrder),
    [tabs, visualOrder],
  );
  const draggedTab = dragSnapshot ? tabsById.get(dragSnapshot.id) : undefined;
  const activeTabIdForRender = visualOrder
    ? (dragStateRef.current?.id ?? activeTabId)
    : activeTabId;

  // 无拖拽时清理 visual order。
  useEffect(() => {
    if (!dragStateRef.current) {
      setVisualOrder(null);
      visualOrderRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  // 激活标签滚入视野。
  useEffect(() => {
    if (!activeTabId || dragStateRef.current) return;
    const node = tabRefs.current.get(activeTabId);
    if (!node) return;
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs]);

  const setOrderedIds = useCallback((nextOrder: string[]) => {
    const current = visualOrderRef.current;
    if (
      current &&
      current.length === nextOrder.length &&
      current.every((id, i) => id === nextOrder[i])
    )
      return;
    previousRectsRef.current = new Map();
    tabRefs.current.forEach((node, id) => {
      previousRectsRef.current?.set(id, node.getBoundingClientRect());
    });
    visualOrderRef.current = nextOrder;
    setVisualOrder(nextOrder);
  }, []);

  // FLIP 动画：记录旧位置 → 重排 → 计算位移 → 过渡归零。
  useLayoutEffect(() => {
    const previousRects = previousRectsRef.current;
    previousRectsRef.current = null;
    if (!previousRects || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const draggedId = dragStateRef.current?.id;
    const frameIds: number[] = [];
    tabRefs.current.forEach((node, id) => {
      if (id === draggedId) return;
      const prev = previousRects.get(id);
      if (!prev) return;
      const cur = node.getBoundingClientRect();
      const deltaX = prev.left - cur.left;
      if (Math.abs(deltaX) < 0.5) return;
      node.style.transition = "none";
      node.style.transform = `translate3d(${deltaX}px, 0, 0)`;
      frameIds.push(
        window.requestAnimationFrame(() => {
          node.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
          node.style.transform = "";
        }),
      );
    });
    return () => {
      frameIds.forEach((fid) => window.cancelAnimationFrame(fid));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualOrder]);

  const registerTabRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) tabRefs.current.set(id, node);
    else tabRefs.current.delete(id);
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      onSelect(id);
    },
    [onSelect],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onClose(id);
    },
    [onClose],
  );

  const clearDrag = useCallback(() => {
    dragStateRef.current = null;
    setDragSnapshot(null);
  }, []);

  const removeDragListeners = useCallback(() => {
    removeDragListenersRef.current?.();
    removeDragListenersRef.current = null;
  }, []);

  const finishDrag = useCallback(() => {
    const ds = dragStateRef.current;
    if (!ds) return;
    if (ds.hasStarted) {
      const finalOrder = visualOrderRef.current ?? ds.initialOrder;
      const changed =
        finalOrder.length !== ds.initialOrder.length ||
        finalOrder.some((id, i) => id !== ds.initialOrder[i]);
      onReorder?.(finalOrder);
      if (!changed) {
        visualOrderRef.current = null;
        setVisualOrder(null);
      }
      onSelect(ds.id);
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
    }
    removeDragListeners();
    clearDrag();
  }, [clearDrag, onReorder, onSelect, removeDragListeners]);

  const beginDragIfNeeded = useCallback((clientX: number, clientY: number) => {
    const ds = dragStateRef.current;
    if (!ds || ds.hasStarted) return ds?.hasStarted ?? false;
    const dx = clientX - ds.startX;
    const dy = clientY - ds.startY;
    if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) return false;
    ds.hasStarted = true;
    suppressNextClickRef.current = true;
    visualOrderRef.current = ds.initialOrder;
    setVisualOrder(ds.initialOrder);
    return true;
  }, []);

  const updateDrag = useCallback(
    (clientX: number, clientY: number) => {
      const ds = dragStateRef.current;
      if (!ds) return false;
      if (!beginDragIfNeeded(clientX, clientY)) return false;
      setDragSnapshot({
        id: ds.id,
        left: clamp(clientX - ds.offsetX, ds.minLeft, ds.maxLeft),
        top: ds.top,
        width: ds.width,
        height: ds.height,
      });
      setOrderedIds(
        moveIdByPointer(
          visualOrderRef.current ?? ds.initialOrder,
          ds.id,
          clientX,
          tabRefs.current,
        ),
      );
      return true;
    },
    [beginDragIfNeeded, setOrderedIds],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      if (!onReorder || tabs.length < 2 || e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".artifact-tab__close")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const listRect = listRef.current?.getBoundingClientRect();
      const listStyle = listRef.current
        ? window.getComputedStyle(listRef.current)
        : null;
      const paddingLeft = listStyle ? Number.parseFloat(listStyle.paddingLeft) || 0 : 0;
      const paddingRight = listStyle ? Number.parseFloat(listStyle.paddingRight) || 0 : 0;
      const minLeft = (listRect?.left ?? rect.left) + paddingLeft;
      const maxLeft = (listRect?.right ?? rect.right) - paddingRight - rect.width;
      dragStateRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        minLeft,
        maxLeft,
        hasStarted: false,
        initialOrder: tabs.map((t) => t.id),
      };
      removeDragListeners();
      const pointerId = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (updateDrag(ev.clientX, ev.clientY)) ev.preventDefault();
      };
      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finishDrag();
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      removeDragListenersRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
    },
    [finishDrag, onReorder, removeDragListeners, tabs, updateDrag],
  );

  // 卸载时移除拖拽监听。
  useEffect(() => () => removeDragListeners(), [removeDragListeners]);

  // 溢出检测：条宽 < 内容宽时（真的还有标签被裁掉）才显示溢出菜单。
  // jsdom 下 scrollWidth / clientWidth 恒为 0，因此不会误触发。
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const measure = () => setOverflowing(node.scrollWidth - node.clientWidth > 1);
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isEmpty, tabs]);

  // 竖向滚轮在标签条上转成横向滚动。必须用原生非 passive 监听：
  // React 的 onWheel 在根节点上是 passive 的，preventDefault 会被忽略。
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const maxScroll = node.scrollWidth - node.clientWidth;
      if (maxScroll <= 0) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (delta === 0) return;
      const next = clamp(node.scrollLeft + delta, 0, maxScroll);
      if (next === node.scrollLeft) return;
      event.preventDefault();
      node.scrollLeft = next;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [isEmpty]);

  // 溢出菜单：点击外部 / Esc 关闭（与 ViewerToolbar 的更多菜单同一约定）。
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".artifact-tabs__overflow")) return;
      setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen]);

  const showOverflow = overflowMenu && overflowing && tabs.length > 1;

  if (tabs.length === 0) return null;

  return (
    // macOS：标签条贴窗口顶边（Overlay 标题栏），容器与最后一个标签右侧的
    // 空白区标记为拖拽区（拖动窗口 / 双击缩放）。tab 子元素不是拖拽目标，
    // 点击切换 / 指针拖拽排序不受影响。
    <div
      className="artifact-tabs"
      role="tablist"
      {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}
    >
      <div
        ref={listRef}
        className={
          "artifact-tabs__list" +
          (visualOrder ? " artifact-tabs__list--dragging" : "")
        }
        {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}
      >
        {renderedTabs.map((tab) => (
          <div
            key={tab.id}
            ref={(node) => registerTabRef(tab.id, node)}
            className={
              "artifact-tab" +
              (tab.id === activeTabIdForRender ? " artifact-tab--active" : "") +
              (onReorder && tabs.length > 1 ? " artifact-tab--draggable" : "") +
              (dragSnapshot?.id === tab.id ? " artifact-tab--drag-placeholder" : "")
            }
            onClick={() => handleSelect(tab.id)}
            onPointerDown={(e) => handlePointerDown(e, tab.id)}
            onMouseDown={(e) => {
              // 中键：阻止 Chromium 的自动滚动光标，并交给 onAuxClick 关闭。
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) handleClose(e, tab.id);
            }}
            role="tab"
            aria-selected={tab.id === activeTabIdForRender}
            title={tab.subtitle ?? tab.label}
          >
            <span className="artifact-tab__icon">{pickTabIcon(tab)}</span>
            <span className="artifact-tab__name">{tab.label}</span>
            <button
              type="button"
              className="artifact-tab__close"
              onClick={(e) => handleClose(e, tab.id)}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="关闭标签"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {showOverflow ? (
        <div
          className={cx("artifact-tabs__overflow", styles.overflow)}
          data-openbuddy-nodrag
        >
          {/* macOS：标签条本身是窗口拖拽区（data-openbuddy-drag），交互元素
              必须显式退出拖拽区（data-openbuddy-nodrag），否则点击会被窗口拖拽吞掉。 */}
          <button
            type="button"
            className={styles.overflowButton}
            aria-label="查看全部标签"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            title="查看全部标签"
            data-tip="查看全部标签"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <ChevronDownIcon size="sm" />
          </button>
          {overflowOpen ? (
            <div
              className={styles.overflowMenu}
              role="menu"
              aria-label="全部标签"
            >
              {renderedTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className={cx(
                    styles.overflowItem,
                    tab.id === activeTabIdForRender && styles.overflowItemActive,
                  )}
                  title={tab.subtitle ?? tab.label}
                  onClick={() => {
                    setOverflowOpen(false);
                    onSelect(tab.id);
                  }}
                >
                  <span className={styles.overflowIcon}>{pickTabIcon(tab)}</span>
                  <span className={styles.overflowLabel}>{tab.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {dragSnapshot && draggedTab &&
        createPortal(
          <div
            className={
              "artifact-tab artifact-tab--drag-clone" +
              (draggedTab.id === activeTabIdForRender
                ? " artifact-tab--active"
                : "")
            }
            style={{
              width: dragSnapshot.width,
              height: dragSnapshot.height,
              transform: `translate3d(${dragSnapshot.left}px, ${dragSnapshot.top}px, 0)`,
            }}
          >
            <span className="artifact-tab__icon">{pickTabIcon(draggedTab)}</span>
            <span className="artifact-tab__name">{draggedTab.label}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
