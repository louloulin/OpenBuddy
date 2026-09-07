import type { Metadata } from 'next';
import { Check, X, CreditCard, Tag, Sparkles, Building2 } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SharedHeader from '@/components/SharedHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';
import FAQSection from '@/components/FAQSection';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'OpenBuddy is free, MIT-licensed, forever. Pro is a convenience for power users. Enterprise is self-hosted with SLAs.'
};

const TIER_ICONS = [Tag, Sparkles, Building2];

export function PricingView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SharedHeader
              label="Pricing"
              number="01"
              title={ dict.pricing.title }
              subtitle={ dict.pricing.subtitle }
            />
            <p className="-mt-12 mb-12 font-mono text-[12px] text-[var(--wb-fg-faint)]">{ dict.pricing.note }</p>

            {/* Tier grid — list style */}
            <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-3">
              { dict.pricing.tiers.map((tier, idx) => {
                const Icon = TIER_ICONS[idx] ?? Tag;
                const accent = tier.popular ? 'var(--wb-accent)' : 'var(--wb-fg-faint)';
                return (
                  <RevealOnScroll key={ tier.name } delay={ idx * 100 }>
                    <article className="group relative flex h-full flex-col gap-4 bg-[var(--wb-bg-pure)] p-7 transition-colors hover:bg-[var(--wb-bg-soft)]">
                      { tier.popular ? (
                        <span className="absolute right-4 top-4 rounded-full bg-[var(--wb-accent)] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
                          popular
                        </span>
                      ) : null }

                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">
                          { String(idx + 1).padStart(2, '0') }
                        </span>
                        <Icon className="h-4 w-4" style={ { color: accent } } />
                        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--wb-fg)]">
                          { tier.name }
                        </span>
                      </div>

                      {/* Price — serif */}
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="font-display-serif text-[44px] leading-none tracking-tight text-[var(--wb-fg)] sm:text-[52px]">
                          { tier.price }
                        </span>
                        <span className="ml-1 font-mono text-[11px] text-[var(--wb-fg-muted)]">
                          / { tier.cadence }
                        </span>
                      </div>

                      {/* Description */}
                      <p className="text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                        { tier.description }
                      </p>

                      {/* Features */}
                      <ul className="mt-4 flex-1 space-y-2.5 border-t border-[var(--wb-border)] pt-5">
                        { tier.features.map((feature) => (
                          <li
                            key={ feature }
                            className="flex items-start gap-2 text-[13px] leading-snug text-[var(--wb-fg-muted)]"
                          >
                            <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--wb-working)]" />
                            <span>{ feature }</span>
                          </li>
                        )) }
                      </ul>

                      {/* CTA */}
                      <Link
                        href={ tier.href }
                        target={ tier.href.startsWith('http') || tier.href.startsWith('mailto') ? '_blank' : undefined }
                        rel={ tier.href.startsWith('http') ? 'noreferrer' : undefined }
                        className={ `mt-6 inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${
                          tier.popular
                            ? 'bg-[var(--wb-accent)] text-white hover:bg-[var(--wb-accent-hover)]'
                            : 'border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] text-[var(--wb-fg)] hover:bg-[var(--wb-bg-soft)]'
                        }` }
                      >
                        <span>{ tier.cta }</span>
                        { !tier.href.startsWith('mailto') ? <span aria-hidden="true">→</span> : null }
                      </Link>
                    </article>
                  </RevealOnScroll>
                );
              }) }
            </div>

            {/* Compare table */}
            <div className="mt-20">
              <SharedHeader
                label="Compare"
                number="02"
                title={ dict.pricing.compareTitle }
                subtitle={ dict.pricing.compareSubtitle }
              />

              <div className="overflow-x-auto rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-pure)]">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
                      <th className="px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)] sm:px-6">
                        { locale === 'zh-CN' ? '功能' : 'Feature' }
                      </th>
                      <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)] sm:px-6">Community</th>
                      <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)] sm:px-6">Pro</th>
                      <th className="px-4 py-3 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)] sm:px-6">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    { dict.pricing.compare.map((row, idx) => (
                      <tr
                        key={ row.feature }
                        className="border-b border-[var(--wb-border)] last:border-b-0"
                      >
                        <td className="px-4 py-3 font-medium text-[var(--wb-fg)] sm:px-6">{ row.feature }</td>
                        { [row.community, row.pro, row.enterprise].map((v, i) => (
                          <td key={ i } className="px-4 py-3 text-center text-[var(--wb-fg-muted)] sm:px-6">
                            { v === '✓' ? (
                              <Check className="mx-auto h-3.5 w-3.5 text-[var(--wb-working)]" />
                            ) : v === '—' || v === '-' ? (
                              <X className="mx-auto h-3 w-3 text-[var(--wb-fg-faint)]" />
                            ) : (
                              <span className="font-mono text-[11.5px]">{ v }</span>
                            ) }
                          </td>
                        )) }
                      </tr>
                    )) }
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pricing FAQ */}
            <div className="mt-20">
              <FAQSection
                dict={ { ...dict, faq: { ...dict.faq, sectionLabel: dict.pricing.faqTitle, title: dict.pricing.faqTitle, subtitle: '', items: dict.pricing.faq } } }
              />
            </div>

            {/* Back link */}
            <div className="mt-12 text-center">
              <Link
                href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
                className="inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
              >
                ← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
      <BackToTop />
    </>
  );
}