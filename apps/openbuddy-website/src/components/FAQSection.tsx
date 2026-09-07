'use client';

import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface FAQSectionProps {
  dict: Dict;
}

/**
 * FAQSection —— accordion 列表 (tutti 严格对标)
 */
export default function FAQSection({ dict }: FAQSectionProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section data-section-theme="light" className="relative section-pad bg-[var(--wb-bg)]">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          label={ dict.faq.sectionLabel }
          number="10"
          title={ dict.faq.title }
          subtitle={ dict.faq.subtitle }
        />

        <div className="mt-12 space-y-px overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-border)]">
          { dict.faq.items.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div key={ item.q } className="bg-[var(--wb-bg-pure)]">
                <button
                  type="button"
                  onClick={ () => setOpenIdx(isOpen ? null : idx) }
                  aria-expanded={ isOpen }
                  className="flex w-full items-center gap-5 px-6 py-5 text-left transition-colors hover:bg-[var(--wb-bg-soft)]"
                >
                  <span className="font-mono text-[11px] font-medium text-[var(--wb-fg-faint)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <span className="flex-1 text-[15.5px] font-medium text-[var(--wb-fg)]">
                    { item.q }
                  </span>
                  <span
                    className={ `flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isOpen
                        ? 'border-[var(--wb-accent)] bg-[var(--wb-accent)] text-white'
                        : 'border-[var(--wb-border)] text-[var(--wb-fg-muted)]'
                    }` }
                  >
                    { isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" /> }
                  </span>
                </button>
                <div
                  className={ `grid overflow-hidden transition-all duration-300 ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }` }
                >
                  <div className="min-h-0">
                    <p className="px-6 pb-5 pl-16 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
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
