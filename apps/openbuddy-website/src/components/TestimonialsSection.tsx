import { Quote } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SharedHeader } from './SharedHeader';

interface TestimonialsSectionProps {
  dict: Dict;
}

const ACCENT_CLASS: Record<string, string> = {
  brand: 'border-[var(--wb-working-border)] text-[var(--wb-working-fg)]',
  amber: 'border-[rgba(217,119,6,0.30)] text-[#D97706]',
  rose: 'border-[rgba(225,29,72,0.30)] text-[#e11d48]',
  sky: 'border-[rgba(14,165,233,0.30)] text-[#0ea5e9]'
};

/**
 * TestimonialsSection —— 3 张 quote 卡片 (tutti 严格对标)
 */
export default function TestimonialsSection({ dict }: TestimonialsSectionProps) {
  return (
    <section data-section-theme="light" className="relative section-pad bg-[var(--wb-bg)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="09"
          label={ dict.testimonials.sectionLabel }
          title={ dict.testimonials.title }
          subtitle={ dict.testimonials.subtitle }
        />

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          { dict.testimonials.items.map((t, idx) => {
            const accent = ACCENT_CLASS[t.accent] ?? ACCENT_CLASS.brand;
            return (
              <figure
                key={ t.author }
                className="group relative flex flex-col gap-4 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 transition-all hover:border-[var(--wb-border-strong)] hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">
                    { String(idx + 1).padStart(2, '0') }
                  </span>
                  <Quote className={ `h-4 w-4 ${accent.split(' ')[1]}` } />
                </div>

                <blockquote className="font-display-serif text-[20px] leading-snug text-[var(--wb-fg)]">
                  &ldquo;{ t.quote }&rdquo;
                </blockquote>

                <figcaption className="mt-auto flex items-center gap-3 border-t border-[var(--wb-border)] pt-4">
                  <div
                    className={ `flex h-10 w-10 items-center justify-center rounded-full border font-mono text-[11px] font-semibold ${accent} bg-[var(--wb-bg-soft)]` }
                  >
                    { t.initials }
                  </div>
                  <div>
                    <div className="text-[13.5px] font-semibold text-[var(--wb-fg)]">{ t.author }</div>
                    <div className="text-[11.5px] text-[var(--wb-fg-muted)]">{ t.role }</div>
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
