'use client';

/**
 * Reveal — scroll-triggered entrance for a block of content.
 *
 * Merged from the FadeInUp / ScaleIn / SlideInRight trio in
 * packages/ui/openbuddy-ui-motion, reduced to the two variants this site
 * actually uses. Both map onto keyframes that already exist in
 * tailwind.config.ts (`fade-up`, `fade-in`); the upstream `ob-*` presets
 * pointed at keyframes that are defined nowhere, so they were dropped.
 */

import {
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { useInView } from '@/lib/motion/useInView';

type Variant = 'fade-up' | 'fade-in';

const VARIANT_CLASS: Record<Variant, string> = {
  'fade-up': 'animate-fade-up',
  'fade-in': 'animate-fade-in'
};

export interface RevealProps {
  children: ReactNode;
  /** Stagger offset in ms. Pass `index * step` to cascade a list. */
  delay?: number;
  variant?: Variant;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article' | 'li' | 'header' | 'footer' | 'span';
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function Reveal({
  children,
  delay = 0,
  variant = 'fade-up',
  className,
  style,
  as = 'div'
}: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>({ once: true, rootMargin: '0px 0px -8% 0px' });
  // `pending`: hidden and waiting to be scrolled into view.
  // `playing`: the entrance animation is running.
  const [pending, setPending] = useState(false);
  const [playing, setPlaying] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Checked synchronously rather than through useReducedMotion: the hook
    // settles after hydration, which is too late — by then a reduced-motion
    // user's below-the-fold content would already be hidden.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Already on screen at mount (above the fold, or a short page). Show it as
    // is. Hiding it here would make the content blink out and fade back in on
    // every load, which is worse than not animating at all.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setPending(true);
  }, [ref]);

  useEffect(() => {
    if (!pending || !inView) return;
    setPending(false);
    setPlaying(true);
  }, [pending, inView]);

  const motionClass = pending ? 'opacity-0' : playing ? VARIANT_CLASS[variant] : '';

  return createElement(
    as,
    {
      ref,
      className: [motionClass, className].filter(Boolean).join(' '),
      style: { animationDelay: `${delay}ms`, ...style }
    },
    children
  );
}
