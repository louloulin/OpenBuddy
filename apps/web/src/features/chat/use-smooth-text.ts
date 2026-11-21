import { useEffect, useRef, useState } from "react";

/**
 * Characters per second at rest. The pace scales with the backlog, so a steady
 * stream is shown about MAX_LAG_S behind and a burst drains exponentially.
 */
const BASE_CPS = 80;
const MAX_LAG_S = 0.5;
/** Re-render at most ~30 times a second: markdown re-parses on every update. */
const FRAME_MS = 33;

function canAnimate(): boolean {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return false;
  try {
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** Do not cut a UTF-16 surrogate pair in half. */
function safeCut(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return Math.max(0, Math.min(end, text.length));
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end;
}

/**
 * Streamed text arrives in uneven bursts. While `live`, reveal it at a steady,
 * adaptive pace; when the stream ends (or the text is replaced rather than
 * extended) show everything at once.
 */
export function useSmoothText(target: string, live: boolean): string {
  const animate = live && canAnimate();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  // Not an extension of what is on screen (final snapshot, edit): jump.
  if (animate && !target.startsWith(shownRef.current)) shownRef.current = target;

  // Wakes the loop when new text arrives after it went idle.
  const wakeRef = useRef<(() => void) | null>(null);
  useEffect(() => { wakeRef.current?.(); }, [target]);

  useEffect(() => {
    if (!animate) {
      shownRef.current = targetRef.current;
      return;
    }
    let raf = 0;
    let idle = false;
    let last = performance.now();
    let carry = 0;
    wakeRef.current = () => {
      if (!idle) return;
      idle = false;
      last = performance.now();
      raf = window.requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      const elapsed = now - last;
      if (elapsed >= FRAME_MS) {
        last = now;
        const full = targetRef.current;
        const current = shownRef.current;
        if (current.length < full.length) {
          const backlog = full.length - current.length;
          const cps = Math.max(BASE_CPS, backlog / MAX_LAG_S);
          carry += (cps * elapsed) / 1000;
          const step = Math.floor(carry);
          if (step > 0) {
            carry -= step;
            const next = full.slice(0, safeCut(full, current.length + step));
            shownRef.current = next;
            setShown(next);
          }
        } else {
          // Caught up: stop the loop until more text arrives.
          carry = 0;
          idle = true;
          return;
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      wakeRef.current = null;
      window.cancelAnimationFrame(raf);
    };
  }, [animate]);

  if (!animate) return target;
  return shown.length <= target.length && target.startsWith(shown) ? shown : target;
}
