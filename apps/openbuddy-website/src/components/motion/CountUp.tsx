'use client';

/**
 * CountUp — animates a numeric stat from 0 to its value the first time it
 * scrolls into view. Zero dependencies: rAF plus the shared useInView hook.
 *
 * The number is never the source of truth — `value` is a display string that
 * already holds the real figure, and this only animates the approach to it.
 * Parsing keeps any prefix/suffix and thousands separators, so a string like
 * "1,886" counts up grouped and "≈1.4s" is left alone (it has no leading
 * integer to animate, and is rendered verbatim).
 *
 * SSR renders the final value so crawlers and no-JS readers get the real
 * figure; the counter is armed after hydration, below the fold, where the
 * reset to 0 cannot be seen.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInView } from '@/lib/motion/useInView';

interface Parsed {
  prefix: string;
  target: number;
  suffix: string;
  decimals: number;
  grouped: boolean;
}

function parseValue(raw: string): Parsed | null {
  const m = raw.match(/^([^\d]*)([\d,]*\d(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const [, prefix, numStr, suffix] = m;
  const target = Number(numStr.replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;
  return { prefix, target, suffix, decimals, grouped: numStr.includes(',') };
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const DURATION = 900;
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export interface CountUpProps {
  /** Display string holding the real value, e.g. "469" or "1,886". */
  value: string;
  className?: string;
  duration?: number;
}

export default function CountUp({ value, className, duration = DURATION }: CountUpProps) {
  const parsed = parseValue(value);
  const [ref, inView] = useInView<HTMLSpanElement>({ once: true, rootMargin: '0px 0px -8% 0px' });
  // `armed` means: below the fold, so it is safe to show 0 and count when it
  // scrolls in. Until armed the real value is shown.
  const [armed, setArmed] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const rafRef = useRef<number>();

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || !parsed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setArmed(true);
  }, [ref, parsed]);

  useEffect(() => {
    if (!armed || !inView || !parsed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setCurrent(parsed.target * easeOutExpo(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Safety net. rAF can be throttled to a full stop (backgrounded tab, some
    // low-power modes), which would leave the stat parked at a partial value
    // with the loop never resuming — so the page would read "7" where the real
    // figure is "63". Timers keep firing under those conditions; this lands the
    // true number no matter what the rAF loop does.
    const settle = setTimeout(() => setCurrent(parsed.target), duration + 120);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      clearTimeout(settle);
    };
  }, [armed, inView, parsed, duration]);

  if (!parsed) {
    // Nothing numeric to animate (e.g. "≈1.4s", "MIT") — render as-is.
    return <span className={className}>{value}</span>;
  }

  const shown = armed && current !== null ? current : parsed.target;
  const body = parsed.grouped
    ? shown.toLocaleString('en-US', {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals
      })
    : shown.toFixed(parsed.decimals);

  return (
    <span ref={ref} className={className}>
      {parsed.prefix}
      {body}
      {parsed.suffix}
    </span>
  );
}
