/**
 * useChatViewStreaming —— 未读计数只在"真的有内容溢出、用户又没跟在末尾"时才累加。
 *
 * 2026-10-12 真实启动截图发现:空会话(内容不足一屏)里挂着一个「↓1」跳转徽标,
 * 压住空状态卡片。根因是这个 effect 只判断 pinned,不判断容器是否可滚动。
 * 下面是 mutation 可杀的三条:去掉 scrollable 判断,第一条立刻红。
 */
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChatViewStreaming } from "../useChatViewStreaming";

function scroller(scrollHeight: number, clientHeight: number, scrollTop = 0) {
  const listeners: Array<() => void> = [];
  const el = {
    scrollTop,
    scrollHeight,
    clientHeight,
    addEventListener: (_type: string, handler: () => void) => {
      listeners.push(handler);
    },
    removeEventListener: () => {},
  };
  return {
    ref: { current: el } as unknown as React.RefObject<HTMLDivElement | null>,
    /** 模拟用户滚动:改位置并触发监听器(与真实滚动事件同形)。 */
    userScrollTo: (next: number) => {
      el.scrollTop = next;
      for (const handler of listeners) handler();
    },
    el,
  };
}

const message = { id: "m1" };

function mount(scrollRef: React.RefObject<HTMLDivElement | null>) {
  return renderHook(
    ({ messages }: { messages: unknown[] }) =>
      useChatViewStreaming({ streaming: false, streamingMessageId: null, scrollRef, messages }),
    { initialProps: { messages: [] as unknown[] } },
  );
}

describe("useChatViewStreaming 未读计数", () => {
  it("内容不足一屏(空会话)时,消息变化不累计未读", () => {
    const { ref } = scroller(400, 400);
    const { result, rerender } = mount(ref);
    act(() => rerender({ messages: [message] }));
    expect(result.current.unreadCount).toBe(0);
  });

  it("空会话里来了新消息也不累计未读(用户根本没滚过)", () => {
    const { ref } = scroller(900, 400, 0);
    const { result, rerender } = mount(ref);
    act(() => rerender({ messages: [message] }));
    expect(result.current.unreadCount).toBe(0);
  });

  it("用户滚上去之后,新消息才累计未读", () => {
    const { ref, userScrollTo } = scroller(1200, 400, 800);
    const { result, rerender } = mount(ref);
    act(() => userScrollTo(0));
    const before = result.current.unreadCount;
    act(() => rerender({ messages: [message] }));
    expect(result.current.unreadCount).toBe(before + 1);
  });

  it("用户滚过又回到末尾时不累计未读", () => {
    const { ref, userScrollTo } = scroller(1200, 400, 400);
    const { result, rerender } = mount(ref);
    act(() => userScrollTo(0));
    act(() => userScrollTo(800));
    act(() => rerender({ messages: [message] }));
    expect(result.current.unreadCount).toBe(0);
  });

  // 20261031 Phase 2.4
  it("流式更新同一条消息不累计未读(按消息条数,不按渲染次数)", () => {
    const { ref, userScrollTo } = scroller(1200, 400, 800);
    const { result, rerender } = mount(ref);
    act(() => userScrollTo(0));
    act(() => rerender({ messages: [message] }));
    const afterNew = result.current.unreadCount;
    // 同一条消息的内容在流式中变化:数组变了,长度没变。
    act(() => rerender({ messages: [{ ...message, text: "more" }] }));
    act(() => rerender({ messages: [{ ...message, text: "even more" }] }));
    expect(result.current.unreadCount).toBe(afterNew);
  });

  it("用户离开底部后即显示回到底部(无新消息也显示),跳回后隐藏", () => {
    const { ref, userScrollTo } = scroller(1200, 400, 800);
    const { result } = mount(ref);
    expect(result.current.awayFromBottom).toBe(false);
    act(() => userScrollTo(0));
    expect(result.current.awayFromBottom).toBe(true);
    act(() => result.current.handleJumpToBottom());
    expect(result.current.awayFromBottom).toBe(false);
  });

  it("用户滚上去后又发了一条消息:回到末尾,不挂「↓」(§21)", () => {
    const { ref, userScrollTo, el } = scroller(1200, 400, 800);
    const { result, rerender } = mount(ref);
    act(() => userScrollTo(0));
    expect(result.current.awayFromBottom).toBe(true);
    act(() => rerender({ messages: [{ id: "u1", role: "user" }] }));
    expect(el.scrollTop).toBe(1200);
    expect(result.current.awayFromBottom).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });
});

