'use client';

/**
 * SpotlightCard — a card with a soft radial highlight that follows the cursor.
 *
 * Zero dependencies. `pointermove` writes the cursor position into `--mx`/`--my`
 * on the card element; an overlay layer paints a radial gradient centred on
 * those coordinates. Non-mouse pointers are ignored: a touch device has no
 * hover, so there is nothing to track and the gradient would only ever sit at
 * its default position.
 */

import { createElement, useRef, type CSSProperties, type ReactNode } from 'react';

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'article' | 'li' | 'section';
}

export default function SpotlightCard({
  children,
  className,
  style,
  as = 'div'
}: SpotlightCardProps) {
  const ref = useRef<HTMLElement>(null);

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }

  return createElement(
    as,
    {
      ref,
      onPointerMove,
      className: ['group/spotlight relative isolate', className].filter(Boolean).join(' '),
      style
    },
    <>
      {/* Sits at z-0 so it paints under the content wrapper at z-10; both live
          inside the `isolate` stacking context so neither escapes the card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-[var(--wb-duration-medium)] group-hover/spotlight:opacity-100"
        style={{
          background:
            'radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), var(--wb-spotlight), transparent 72%)'
        }}
      />
      <div className="relative z-10">{children}</div>
    </>
  );
}
