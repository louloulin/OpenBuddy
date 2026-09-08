'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealOnScrollProps {
  children: ReactNode;
  /** 动画延迟 (ms) */
  delay?: number;
  /** 触发阈值 (0-1) */
  threshold?: number;
  /** 一次性触发还是反复 */
  once?: boolean;
  className?: string;
}

/**
 * RevealOnScroll —— 滚动进入视口时触发淡入上移动画
 *
 * 使用 IntersectionObserver (轻量 + 零依赖)。
 * 默认只在客户端渲染后激活 (避免 SSR 触发)。
 */
export default function RevealOnScroll({
  children,
  delay = 0,
  threshold = 0.1,
  once = true,
  className = ''
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold, rootMargin: '0px 0px -10% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);

  return (
    <div
      ref={ ref }
      style={ { transitionDelay: `${delay}ms` } }
      className={ `transition-all duration-700 ease-out ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      } ${className}` }
    >
      { children }
    </div>
  );
}