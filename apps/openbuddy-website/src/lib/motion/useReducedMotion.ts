/**
 * useReducedMotion — reports whether the user asked for reduced motion.
 *
 * Ported from packages/ui/openbuddy-ui-motion/src/useReducedMotion.ts.
 *
 * Initialised to `false` rather than reading matchMedia during the first
 * render: the server has no matchMedia, so a client initialiser would produce
 * a className that disagrees with the server HTML and trigger a hydration
 * mismatch. The value settles in the effect below instead.
 *
 * This is a second line of defence — globals.css already zeroes every
 * animation and transition under `prefers-reduced-motion: reduce` regardless
 * of what JS decides.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
