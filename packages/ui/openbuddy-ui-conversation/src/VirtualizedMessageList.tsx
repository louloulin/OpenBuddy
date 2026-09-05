/**
 * VirtualizedMessageList — R1.2 引入 @tanstack/react-virtual 的消息列表渲染器。
 *
 * 触发条件(由父组件 ChatView 判断):
 *   - localStorage `openbuddy.virtual-list=1`,或
 *   - 会话消息数 ≥ VIRTUAL_THRESHOLD(默认 50)。
 *
 * 设计要点(对齐 Cherry Studio `MessageVirtualList` / Jan `chat-virtualizer`):
 *   - 父级滚动容器(scrollRef)由 ChatView 提供;virtualizer 复用其 scrollElement,
 *     这样既保留原有的 CSS 滚动体验,又只挂载可见区域的消息。
 *   - estimateSize 动态估算:assistant 文本多时大,user 气泡小。简单用 200 作为
 *     默认值,实际测量后由 virtualizer 自我纠正(measureElement 触发后即准确)。
 *   - getItemKey 使用 node.key,确保 streaming 时按 message.id 复用同一 DOM 节点。
 *   - overscan=10,避免流式打字时上下边缘频繁 mount/unmount 抖动。
 *
 * P2-02 加深:
 *   - 动态尺寸估算(estimateNodeSize): assistant 代码块/工具调用节点给更高基线,
 *     user 气泡/分隔符给更低基线,减少虚拟列表初次 mount 时的"跳"。
 *   - scrollToBottom / scrollToIndex helpers: 通过 imperative 句柄暴露给 ChatView,
 *     避免 ChatView 假设滚动容器直接是 scrollRef.current。
 *   - follow-mode: 用户滚动到底部时自动跟随新消息;用户向上阅读历史时停止跟随,
 *     暴露 `isFollowing` 状态让 ChatView 渲染"跳到底部"按钮。
 *   - prefers-reduced-motion: smooth-scroll 在用户偏好减少动效时降级为 instant。
 *
 * 不破坏现有锚点行为:
 *   - streamingMessageId 由 ChatView 传入,若当前流式消息不在可见区域,
 *     ChatView 的 scrollRef effect 会把它滚到底部。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { TimelineNode } from "@/lib/ui/timeline-utils";

export const VIRTUAL_THRESHOLD = 50;
export const VIRTUAL_OVERSCAN = 10;
export const FOLLOW_TOLERANCE_PX = 64;
export const PIN_STICKY_THRESHOLD_PX = 12;

export type VirtualizedRenderItem = (args: {
  node: TimelineNode;
  index: number;
}) => ReactNode;

/**
 * Stable, kind-aware key extraction. Used both as the React `key`
 * and as `getItemKey` so that the virtualizer's row cache survives
 * streaming updates that mutate the trailing message in place.
 */
export function getTimelineKey(node: TimelineNode): string {
  if (node.kind === "message") return node.message.id;
  return node.key;
}

/**
 * Heuristic per-node size estimate. The virtualizer self-corrects after
 * the first real `measureElement` pass, so these only need to be in the
 * right ballpark — they're used to size the placeholder before the row
 * has been measured, which determines whether the first paint causes
 * a visible jump.
 */
export function estimateNodeSize(node: TimelineNode | undefined, fallback = 200): number {
  if (!node) return fallback;
  if (node.kind === "date-divider" || node.kind === "model-divider") return 28;
  if (node.kind === "message") {
    const msg = node.message;
    const base = msg.role === "user" ? 64 : 120;
    // Rough heuristic: every part adds ~64px; code/tool blocks add more.
    const parts = msg.parts?.length ?? 0;
    const hasHeavyPart = msg.parts?.some(
      (p: unknown) =>
        typeof p === "object" &&
        p !== null &&
        "kind" in p &&
        ((p as { kind: string }).kind === "code" || (p as { kind: string }).kind === "tool-call"),
    );
    const heavyAdj = hasHeavyPart ? 80 : 0;
    return base + parts * 64 + heavyAdj;
  }
  return fallback;
}

/**
 * Imperative handle exposed to ChatView so the parent can drive scroll
 * without reaching into the virtualizer or the scrollElement directly.
 */
export type VirtualizedHandle = {
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  scrollToIndex: (index: number, opts?: { smooth?: boolean; align?: "start" | "center" | "end" }) => void;
  isFollowing: () => boolean;
  /** Force the follow state, e.g. when the user clicks "jump to bottom". */
  setFollowing: (value: boolean) => void;
};

export const VirtualizedMessageList = memo(function VirtualizedMessageList({
  timeline,
  scrollRef,
  renderItem,
  estimateSize = 200,
  overscan = VIRTUAL_OVERSCAN,
  handleRef,
}: {
  timeline: TimelineNode[];
  scrollRef: React.RefObject<HTMLElement>;
  renderItem: VirtualizedRenderItem;
  /** Average row height. Adjust for code-heavy or text-heavy transcripts. */
  estimateSize?: number;
  /** Number of items to render above/below the visible viewport. */
  overscan?: number;
  /** Optional imperative handle for ChatView to drive scroll + follow state. */
  handleRef?: React.MutableRefObject<VirtualizedHandle | null>;
}) {
  const virtualizer = useVirtualizer({
    count: timeline.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateNodeSize(timeline[index], estimateSize),
    overscan,
    getItemKey: (index) =>
      getTimelineKey(
        timeline[index] ?? { kind: "date-divider", label: "", key: String(index) },
      ),
  });

  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();

  // ---- follow-mode tracking ----------------------------------------------
  //
  // "Following" = the last row is within FOLLOW_TOLERANCE_PX of the scroll
  // container's bottom edge. When following, every timeline update pushes
  // the viewport to the bottom; when not following, we let the user read
  // history without interruption.
  const followingRef = useRef(true);
  const [, forceRender] = useState(0);
  const setFollowing = useCallback((value: boolean) => {
    if (followingRef.current === value) return;
    followingRef.current = value;
    forceRender((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      const isAtBottom = distance <= FOLLOW_TOLERANCE_PX;
      if (followingRef.current !== isAtBottom) {
        followingRef.current = isAtBottom;
        forceRender((n) => n + 1);
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef]);

  // ---- smooth-scroll preference ------------------------------------------
  const prefersReducedMotion = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion.current = mq.matches;
    const listener = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const smooth = useCallback(
    (requested?: boolean) => requested !== false && !prefersReducedMotion.current,
    [],
  );

  // ---- imperative handle --------------------------------------------------
  const lastIndexRef = useRef(0);
  useEffect(() => {
    lastIndexRef.current = Math.max(0, timeline.length - 1);
  }, [timeline.length]);

  const scrollToBottom = useCallback(
    (opts?: { smooth?: boolean }) => {
      const el = scrollRef.current;
      if (!el) return;
      virtualizer.scrollToIndex(lastIndexRef.current, {
        align: "end",
        behavior: smooth(opts?.smooth) ? "smooth" : "auto",
      });
      setFollowing(true);
    },
    [scrollRef, virtualizer, smooth, setFollowing],
  );

  const scrollToIndex = useCallback(
    (
      index: number,
      opts?: { smooth?: boolean; align?: "start" | "center" | "end" },
    ) => {
      const el = scrollRef.current;
      if (!el) return;
      virtualizer.scrollToIndex(index, {
        align: opts?.align ?? "start",
        behavior: smooth(opts?.smooth) ? "smooth" : "auto",
      });
    },
    [scrollRef, virtualizer, smooth],
  );

  const isFollowing = useCallback(() => followingRef.current, []);

  const handle: VirtualizedHandle = useMemo(
    () => ({ scrollToBottom, scrollToIndex, isFollowing, setFollowing }),
    [scrollToBottom, scrollToIndex, isFollowing, setFollowing],
  );

  useImperativeHandle(handleRef, () => handle, [handle]);

  // ---- render -------------------------------------------------------------
  const containerStyle: CSSProperties = {
    height: `${totalSize}px`,
    width: "100%",
    position: "relative",
  };

  return (
    <div className="chatview__inner chatview__inner--virtualized" style={containerStyle}>
      {items.map((vi) => {
        const node = timeline[vi.index];
        if (!node) return null;
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            data-following={followingRef.current ? "true" : "false"}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {renderItem({ node, index: vi.index })}
          </div>
        );
      })}
    </div>
  );
});
// P1-02: default shallow equality is fine — when ChatView passes the same
// `renderItem` (kept stable via useCallback) and the same `scrollRef`, the
// virtualizer reuses its row cache and the visible DOM stays put. Streaming
// deltas mutate `timeline` (last message's text grows) which DOES trigger a
// re-render, but the visible row for that message is already the one in the
// viewport — react-virtual swaps textContent in place rather than unmount.

// P2-02: handleRef re-export so ChatView can `useRef<VirtualizedHandle>(null)`
// without importing the type from a separate module path.
export type { VirtualizedHandle as VirtualizedHandleType };

/**
 * Feature gate — opt-in for the virtualized renderer.
 * Returning false keeps the existing flat timeline.map path so the
 * default UX is unchanged and zero-risk.
 *
 * Override chain:
 *   1. localStorage["openbuddy.virtual-list"] === "1" → always on
 *   2. localStorage["openbuddy.virtual-list"] === "0" → always off
 *   3. otherwise → on when messageCount ≥ VIRTUAL_THRESHOLD
 */
export function shouldUseVirtualList(messageCount: number): boolean {
  if (typeof localStorage !== "undefined") {
    try {
      const flag = localStorage.getItem("openbuddy.virtual-list");
      if (flag === "1") return true;
      if (flag === "0") return false;
    } catch {
      /* localStorage may throw in SSR / private mode */
    }
  }
  return messageCount >= VIRTUAL_THRESHOLD;
}