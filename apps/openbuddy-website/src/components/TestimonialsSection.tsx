import { Quote } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface TestimonialsSectionProps {
  dict: Dict;
}

const ACCENT_CLASS: Record<string, { bg: string; text: string; border: string }> = {
  brand: { bg: 'bg-brand-2', text: 'text-brand-10 dark:text-brand-8', border: 'border-brand-3' },
  amber: { bg: 'bg-amber-2', text: 'text-amber-10', border: 'border-amber-3' },
  rose: { bg: 'bg-rose-2', text: 'text-rose-10', border: 'border-rose-3' },
  sky: { bg: 'bg-sky-2', text: 'text-sky-10', border: 'border-sky-3' }
};

/**
 * TestimonialsSection —— 用户证言
 *
 * 设计要点：
 * - 3 张证言卡片，desktop 3 列，移动端 1 列
 * - 顶部装饰引号 (Quote icon) + 渐变背景
 * - 作者头像：initials + brand 色背景
 * - hover 轻微上浮
 */
export default function TestimonialsSection({ dict }: TestimonialsSectionProps) {
  return (
    <section className="relative bg-[var(--wb-bg-soft)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.testimonials.sectionLabel }
          title={ dict.testimonials.title }
          subtitle={ dict.testimonials.subtitle }
        />

        <div className="mt-16 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          { dict.testimonials.items.map((t, idx) => {
            const accent = ACCENT_CLASS[t.accent] ?? ACCENT_CLASS.brand;
            return (
              <figure
                key={ t.author }
                className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 transition-all hover:-translate-y-1 hover:shadow-wb-card-hover"
              >
                {/* Background glow on hover */}
                <div
                  className={ `absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity group-hover:opacity-50 ${accent.bg}` }
                />

                {/* Quote icon */}
                <Quote className={ `h-6 w-6 ${accent.text}` } />

                {/* Quote text */}
                <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-[var(--wb-fg)]">
                  "{ t.quote }"
                </blockquote>

                {/* Author */}
                <figcaption className="mt-6 flex items-center gap-3 border-t border-[var(--wb-border)] pt-5">
                  <div
                    className={ `flex h-10 w-10 items-center justify-center rounded-full font-mono text-[12px] font-semibold ${accent.bg} ${accent.text} border ${accent.border}` }
                  >
                    { t.initials }
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--wb-fg)]">{ t.author }</div>
                    <div className="text-[11px] text-[var(--wb-fg-muted)]">{ t.role }</div>
                  </div>
                </figcaption>

                {/* Index marker */}
                <span className="absolute right-3 top-3 font-mono text-[10px] text-[var(--wb-fg-muted)] opacity-30 transition-opacity group-hover:opacity-60">
                  { String(idx + 1).padStart(2, '0') }
                </span>
              </figure>
            );
          }) }
        </div>
      </div>
    </section>
  );
}