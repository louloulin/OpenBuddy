/**
 * useChatViewStreaming — 流式 / 自动滚动 / 未读计数 hook。
 *
 * 抽出 ChatView 内联的所有流式副作用:
 *   - turnStartRef:当前会话首次 wall-clock 时刻(per-message 元信息用)
 *   - scrollRef + pinnedRef:用户是否在底部(pinned=true)
 *   - unreadCount:用户向上滚时累计 delta 数
 *   - handleJumpToBottom:跳到底 + pinnedRef=true + 清未读
 *   - 滚动监听:scroll + ResizeObserver 重新计算 pinnedRef
 *   - 流式监听:消息变化时若 pinned 就跳到底,否则累计 unread
 *
 * 该 hook 把"什么时候跟随流"的状态抽出来,
 * 简化 ChatView 主干,使滚动行为可独立验证。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const PIN_THRESHOLD = 32; // px — roughly one line of body text

export type UseChatViewStreamingParams = {
  streaming: boolean;
  /** 流式消息的 id(每条唯一);用于切换 session 时重置 pinned/unread。 */
  streamingMessageId: string | null;
  /** 滚动容器 ref(由父组件提供并挂到 DOM)。 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * 当消息列表变化时,触发"是否自动滚动"决策。
   * 传 `messages`(或消息引用数组)即可。
   */
  messages: unknown;
};

export type UseChatViewStreamingResult = {
  turnStartRef: RefObject<number | null>;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  pinnedRef: RefObject<boolean>;
  handleJumpToBottom: () => void;
};

export function useChatViewStreaming({
  streaming,
  streamingMessageId,
  scrollRef,
  messages,
}: UseChatViewStreamingParams): UseChatViewStreamingResult {
  const turnStartRef = useRef<number | null>(null);
  const pinnedRef = useRef(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // turnStartRef:per-message 流式时长基准。
  useEffect(() => {
    if (streaming) {
      if (turnStartRef.current === null) turnStartRef.current = Date.now();
    } else {
      turnStartRef.current = null;
    }
  }, [streaming]);

  // 流式消息切换时,假设用户想看新消息(强制 pinned=true)。
  useEffect(() => {
    if (streamingMessageId) {
      pinnedRef.current = true;
      setUnreadCount(0);
    }
  }, [streamingMessageId]);

  // 滚动 / ResizeObserver:重新计算 pinnedRef;若已 pinned,清未读。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recomputePinned = () => {
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
      if (pinnedRef.current) setUnreadCount(0);
    };
    recomputePinned();
    el.addEventListener("scroll", recomputePinned, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recomputePinned());
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", recomputePinned);
      ro?.disconnect();
    };
  }, [scrollRef]);

  // 消息变化:若 pinned 则跳到底,否则累计 unread。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setUnreadCount((c) => c + 1);
    }
  }, [messages, scrollRef]);

  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setUnreadCount(0);
  }, [scrollRef]);

  return {
    turnStartRef,
    unreadCount,
    setUnreadCount,
    pinnedRef,
    handleJumpToBottom,
  };
}
