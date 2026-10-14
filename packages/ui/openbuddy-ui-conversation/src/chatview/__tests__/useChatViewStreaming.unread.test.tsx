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
});
