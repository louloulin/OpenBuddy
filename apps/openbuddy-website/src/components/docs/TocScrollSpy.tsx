'use client';

import { useEffect, useState } from 'react';
import type { DocTocItem } from '@/lib/docs-server';

interface TocScrollSpyProps {
  toc: DocTocItem[];
  label: string;
}

/**
 * TocScrollSpy —— client component, IntersectionObserver 监听 md-prose 内 h2/h3 滚动,
 * 把当前 active 的 TOC item 加 brand 左边 border + 高亮。
 *
 * TOC 链接保持作为锚点导航(无 JS 也能用); 只在 JS 启用时增强 active 视觉。
 * 通过 data-toc-id 属性(由 docs-server.ts 的 heading renderer 注入)选取 headings,
 * 避开 marked 输出里其它任意 id 元素。
 */
export default function TocScrollSpy({ toc, label }: TocScrollSpyProps) {
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    if (typeof window === 'undefined' || toc.length === 0) return;

    const headings: HTMLElement[] = [];
    const seen = new Set<string>();
    document
      .querySelectorAll<HTMLElement>('article .md-prose [data-toc-id]')
      .forEach((el) => {
        const id = el.dataset.tocId;
        if (id && !seen.has(id)) {
          seen.add(id);
          headings.push(el);
        }
      });

    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const top = visible[0].target as HTMLElement;
          const id = top.dataset.tocId;
          if (id) setActiveId(id);
        }
      },
      {
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0
      }
    );

    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  if (toc.length === 0) return null;

  return (
    <>
      <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
        { label }
      </h3>
      <ul className="space-y-1.5 border-l border-[var(--wb-border)]">
        { toc.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li
              key={ `${ item.id }-${ item.text }` }
              style={ { paddingLeft: `${ (item.level - 1) * 12 + 12 }px` } }
              className={ `-ml-px border-l-2 transition-colors ${
                isActive ? 'border-[var(--wb-brand)]' : 'border-transparent'
              }` }
            >
              <a
                href={ `#${ item.id }` }
                className={ `block py-0.5 text-[12.5px] leading-snug transition-colors ${
                  isActive
                    ? 'font-medium text-[var(--wb-fg)]'
                    : 'text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]'
                }` }
              >
                { item.text }
              </a>
            </li>
          );
        }) }
      </ul>
    </>
  );
}
