/**
 * useFindScroll — scroll the active find hit into view.
 *
 * In a virtualized timeline a hit outside the rendered window has no DOM
 * node yet, so `querySelector` alone silently did nothing. Fall back to the
 * virtualizer: scroll its row into range, then center the rendered message.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { TimelineNode } from "@/lib/ui/timeline-utils";
import type { VirtualizedHandle } from "../VirtualizedMessageList";

export function useFindScroll({
  scrollRef,
  virtualHandleRef,
  timeline,
  findCurrent,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  virtualHandleRef: RefObject<VirtualizedHandle | null>;
  timeline: readonly TimelineNode[];
  findCurrent: string | null;
}): void {
  // Read through a ref: streaming deltas rebuild the timeline and must not
  // re-scroll to the current hit.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  useEffect(() => {
    if (!findCurrent) return;
    const selector = `[data-msg-id="${findCurrent}"]`;
    const center = () => {
      const node = scrollRef.current?.querySelector(selector);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      return Boolean(node);
    };
    if (center()) return;
    const index = timelineRef.current.findIndex(
      (node) => node.kind === "message" && node.message.id === findCurrent,
    );
    if (index < 0 || !virtualHandleRef.current) return;
    virtualHandleRef.current.scrollToIndex(index, { align: "center" });
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(center);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [findCurrent, scrollRef, virtualHandleRef]);
}
