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
  // 「用户自己滚过」才谈得上"没跟在末尾"。程序自身的跳转也会触发 scroll 事件,
  // 用"目标位置比对"把它排除(比"忽略下一次事件"稳:程序跳转不一定产生事件,
  // 标志会留到下一次真实滚动上,把用户操作误判成自己的)。
  const userScrolledRef = useRef(false);
  const programmaticScrollTopRef = useRef<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const autoScrollToBottom = (el: HTMLElement) => {
    programmaticScrollTopRef.current = el.scrollHeight;
    el.scrollTop = el.scrollHeight;
  };

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
    const recomputePinned = (cause: "initial" | "resize" | "scroll") => {
      // 只有**用户滚动**才算"用户滚过":初始布局与 ResizeObserver 回调都不是,
      // 程序自己的自动跳转也不是(ignoreNextScrollRef 标记的那次)。
      if (cause === "scroll") {
        const programmatic = programmaticScrollTopRef.current !== null
          && el.scrollTop === programmaticScrollTopRef.current;
        if (!programmatic) userScrolledRef.current = true;
        programmaticScrollTopRef.current = null;
      }
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD;
      if (pinnedRef.current) setUnreadCount(0);
    };
    const onScroll = () => recomputePinned("scroll");
    recomputePinned("initial");
    el.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recomputePinned("resize"));
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [scrollRef]);

  // 消息变化:若 pinned 则跳到底,否则累计 unread。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 没有真正溢出的内容(空会话/内容不足一屏)时"下面"并不存在新消息:
    // 既不该滚动也不该累计未读 —— 否则空会话会挂出一个无处可跳的「↓1」徽标
    // 并压住空状态卡片(2026-10-12 真实启动截图发现)。
    const scrollable = el.scrollHeight - el.clientHeight > PIN_THRESHOLD;
    if (!scrollable) {
      setUnreadCount(0);
      return;
    }
    if (pinnedRef.current || !userScrolledRef.current) {
      // 还跟在末尾 —— 或者用户压根没滚过(空会话/刚打开会话,布局尚未跳到底):
      // 这两种情况都不该冒出「↓1」徽标(2026-10-12 真实启动截图发现空会话挂着
      // 无处可跳的徽标并压住示例卡片)。用户滚过之后再离开末尾才累计未读。
      autoScrollToBottom(el);
      if (!userScrolledRef.current) setUnreadCount(0);
    } else {
      setUnreadCount((c) => c + 1);
    }
  }, [messages, scrollRef]);

  const handleJumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollToBottom(el);
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
