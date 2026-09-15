/**
 * useInView — IntersectionObserver-based hook for "enter viewport" animations.
 * Returns [ref, isInView]. Use with CSS classes to drive reveal animations.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

export interface UseInViewOptions {
  /** Trigger once and stay true (default: false) */
  once?: boolean;
  /** Root margin override */
  rootMargin?: string;
  /** Threshold override */
  threshold?: number | number[];
}

export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): [RefObject<T>, boolean] {
  const { once = false, rootMargin = "0px", threshold = 0.1 } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { rootMargin, threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [once, rootMargin, JSON.stringify(threshold)]);

  return [ref, inView];
}
