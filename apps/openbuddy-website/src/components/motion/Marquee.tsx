'use client';

/**
 * Marquee — seamless horizontal scroller for a row of small badges.
 *
 * Zero dependencies. The track holds two identical copies of the list and
 * translates by -50%, so the moment the first copy leaves the viewport the
 * second is exactly where the first began — no gap, no snap.
 *
 * Fallbacks, in order of what the user asked for:
 *   - narrow viewports (< md): the track wraps and the duplicate is hidden.
 *     A marquee that scrolls past a phone's edge is worse than a wrapped list.
 *   - prefers-reduced-motion: same static wrap. globals.css would zero the
 *     animation anyway, but that would strand the track at -50% and show only
 *     the duplicate; branching here keeps the real list in the flow.
 *
 * The duplicate carries aria-hidden so assistive tech reads the list once. That
 * is only safe while the items are not focusable — do not put links or buttons
 * in a Marquee.
 */

import { useReducedMotion } from '@/lib/motion/useReducedMotion';
import type { ReactNode } from 'react';

export interface MarqueeProps {
  /** The list items (`<li>` elements). */
  children: ReactNode;
  /** Applied to the element that wraps the whole marquee. */
  className?: string;
}

export default function Marquee({ children, className }: MarqueeProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={className}>
        <ul className="flex flex-wrap items-center justify-center gap-3">{children}</ul>
      </div>
    );
  }

  return (
    <div className={[className, 'md:overflow-hidden'].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-center justify-center gap-3 md:w-max md:flex-nowrap md:animate-marquee md:hover:[animation-play-state:paused]">
        <ul className="flex flex-wrap items-center justify-center gap-3 md:flex-nowrap md:gap-4">
          {children}
        </ul>
        <ul
          aria-hidden
          className="hidden md:flex md:flex-nowrap md:items-center md:gap-4 md:pl-4"
        >
          {children}
        </ul>
      </div>
    </div>
  );
}
