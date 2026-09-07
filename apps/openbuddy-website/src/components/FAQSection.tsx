'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface FAQSectionProps {
  dict: Dict;
}

/**
 * FAQSection —— 常见问题
 *
 * 设计要点：
 * - <details>/<summary> 风格的可展开项，键盘可访问
 * - 一次只展开一项 (accordion 行为)
 * - 左侧:序号 + 渐变文字
 * - 平滑展开/收起动画
 */
export default function FAQSection({ dict }: FAQSectionProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.faq.sectionLabel }
          title={ dict.faq.title }
          subtitle={ dict.faq.subtitle }
        />

        <div className="mt-12 space-y-2">
          { dict.faq.items.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={ item.q }
                className={ `overflow-hidden rounded-xl border transition-colors ${
                  isOpen
                    ? 'border-[var(--wb-fg-muted)] bg-[var(--wb-bg)] shadow-wb-card'
                    : 'border-[var(--wb-border)] bg-[var(--wb-bg)] hover:border-[var(--wb-fg-muted)]'
                }` }
              >
                <button
                  type="button"
                  onClick={ () => setOpenIdx(isOpen ? null : idx) }
                  aria-expanded={ isOpen }
                  aria-controls={ `faq-panel-${idx}` }
                  className="flex w-full items-start gap-4 px-5 py-4 text-left"
                >
                  <span className="font-mono text-[11px] font-semibold text-[var(--wb-fg-muted)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <span className="flex-1 text-[15px] font-semibold text-[var(--wb-fg)]">
                    { item.q }
                  </span>
                  <span
                    className={ `flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition-all ${
                      isOpen
                        ? 'border-brand-8 bg-brand-8 text-white'
                        : 'border-[var(--wb-border)] bg-transparent text-[var(--wb-fg-muted)]'
                    }` }
                  >
                    { isOpen ? <ChevronDown className="h-3 w-3" /> : <Plus className="h-3 w-3" /> }
                  </span>
                </button>
                <div
                  id={ `faq-panel-${idx}` }
                  className={ `grid overflow-hidden transition-all duration-300 ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }` }
                >
                  <div className="min-h-0">
                    <p className="px-5 pb-5 pl-12 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
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