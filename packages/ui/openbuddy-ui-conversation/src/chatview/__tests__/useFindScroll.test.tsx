/**
 * 20261031 Phase 2.4 — 查找命中位于虚拟化窗口之外时,先让虚拟列表滚到该行。
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFindScroll } from "../useFindScroll";
import type { TimelineNode } from "@/lib/ui/timeline-utils";

const timeline = [
  { kind: "message", message: { id: "m1" } },
  { kind: "message", message: { id: "m2" } },
] as unknown as TimelineNode[];

function setup(rendered: string[]) {
  const scroller = document.createElement("div");
  for (const id of rendered) {
    const el = document.createElement("div");
    el.setAttribute("data-msg-id", id);
    el.scrollIntoView = vi.fn();
    scroller.appendChild(el);
  }
  const handle = { scrollToIndex: vi.fn(), scrollToBottom: vi.fn(), isFollowing: () => false, setFollowing: vi.fn() };
  return { scrollRef: { current: scroller }, virtualHandleRef: { current: handle }, handle, scroller };
}

describe("useFindScroll", () => {
  it("已渲染的命中直接居中,不动虚拟列表", () => {
    const { scrollRef, virtualHandleRef, handle, scroller } = setup(["m2"]);
    renderHook(() => useFindScroll({ scrollRef, virtualHandleRef, timeline, findCurrent: "m2" }));
    const el = scroller.querySelector("[data-msg-id=m2]") as HTMLElement;
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });

  it("未渲染的命中:虚拟列表滚到对应行", () => {
    const { scrollRef, virtualHandleRef, handle } = setup([]);
    renderHook(() => useFindScroll({ scrollRef, virtualHandleRef, timeline, findCurrent: "m2" }));
    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("时间线随流式更新时不重复滚动", () => {
    const { scrollRef, virtualHandleRef, handle } = setup([]);
    const { rerender } = renderHook(
      ({ tl }) => useFindScroll({ scrollRef, virtualHandleRef, timeline: tl, findCurrent: "m1" }),
      { initialProps: { tl: timeline } },
    );
    rerender({ tl: [...timeline] });
    expect(handle.scrollToIndex).toHaveBeenCalledTimes(1);
  });
});
