'use client';

import { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * BackToTop —— 滚动后右下角浮出的"回到顶部"按钮
 *
 * 触发条件：window.scrollY > 600
 * 缓动：smooth scroll-behavior (CSS)
 * 渐入/渐出：opacity + translate 过渡
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleClick = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={ handleClick }
      className={ `fixed bottom-6 right-6 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg)] text-[var(--wb-fg-muted)] shadow-wb-card transition-all hover:border-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] hover:shadow-wb-card-hover ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      }` }
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}