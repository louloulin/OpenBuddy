'use client';

import { useState } from 'react';
import { Plus, Check } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface FAQSectionProps {
  dict: Dict;
}

/**
 * FAQSection —— tutti 风格
 *
 * - accordion (一次只展开一个)
 * - 编号 + 简洁答案
 * - 状态色 ✓ (绿) 标记
 */
export default function FAQSection({ dict }: FAQSectionProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="relative section-pad">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.faq.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">08</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.faq.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.faq.subtitle }
        </p>

        <div className="mt-12 space-y-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)]">
          { dict.faq.items.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div key={ item.q } className="bg-[var(--wb-bg-pure)]">
                <button
                  type="button"
                  onClick={ () => setOpenIdx(isOpen ? null : idx) }
                  aria-expanded={ isOpen }
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--wb-bg-soft)]"
                >
                  <span className="font-mono text-[11px] font-medium text-[var(--wb-fg-faint)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <span className="flex-1 text-[15px] font-semibold text-[var(--wb-fg)]">
                    { item.q }
                  </span>
                  <span
                    className={ `flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-all ${
                      isOpen
                        ? 'bg-[var(--wb-accent)] text-white'
                        : 'border border-[var(--wb-border)] text-[var(--wb-fg-faint)]'
                    }` }
                  >
                    { isOpen ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" /> }
                  </span>
                </button>
                <div
                  className={ `grid overflow-hidden transition-all duration-300 ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }` }
                >
                  <div className="min-h-0">
                    <p className="px-5 pb-5 pl-12 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                      { item.a }
                    </p>
                  </div>
                </div>
              </div>
            );
          }) }
        </div>
      </div>
    </section>
  );
}