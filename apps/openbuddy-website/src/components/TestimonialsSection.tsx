import { Quote } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface TestimonialsSectionProps {
  dict: Dict;
}

const ACCENT_CLASS: Record<string, string> = {
  brand: 'border-[var(--wb-working-border)] text-[var(--wb-working-fg)]',
  amber: 'border-[rgba(217,119,6,0.30)] text-[var(--wb-warning)]',
  rose: 'border-[rgba(225,29,72,0.30)] text-[#e11d48]',
  sky: 'border-[rgba(14,165,233,0.30)] text-[#0ea5e9]'
};

/**
 * TestimonialsSection —— tutti 风格重做
 *
 * - 3 张简洁 quote 卡片
 * - 用 monospace 编号 + state 色边框
 * - 大字 serif 加重 quote 重点
 */
export default function TestimonialsSection({ dict }: TestimonialsSectionProps) {
  return (
    <section className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.testimonials.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">07</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.testimonials.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.testimonials.subtitle }
        </p>

        <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-2 lg:grid-cols-3">
          { dict.testimonials.items.map((t, idx) => {
            const accent = ACCENT_CLASS[t.accent] ?? ACCENT_CLASS.brand;
            return (
              <figure
                key={ t.author }
                className="group relative flex flex-col gap-4 bg-[var(--wb-bg-pure)] p-6 transition-colors hover:bg-[var(--wb-bg-soft)]"
              >
                {/* Top row */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <Quote className={ `h-3.5 w-3.5 ${accent.split(' ')[1]}` } />
                </div>

                {/* Quote */}
                <blockquote className="font-display-serif text-[17px] leading-snug text-[var(--wb-fg)]">
                  "{ t.quote }"
                </blockquote>

                {/* Author */}
                <figcaption className="mt-auto flex items-center gap-3 border-t border-[var(--wb-border)] pt-4">
                  <div
                    className={ `flex h-9 w-9 items-center justify-center rounded-full border font-mono text-[11px] font-semibold ${accent} bg-[var(--wb-bg-soft)]` }
                  >
                    { t.initials }
                  </div>
                  <div>
                    <div className="text-[12.5px] font-semibold text-[var(--wb-fg)]">{ t.author }</div>
                    <div className="text-[11px] text-[var(--wb-fg-muted)]">{ t.role }</div>
                  </div>
                </figcaption>
              </figure>
            );
          }) }
        </div>
      </div>
    </section>
  );
}