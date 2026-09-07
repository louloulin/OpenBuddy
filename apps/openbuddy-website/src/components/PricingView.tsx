import type { Metadata } from 'next';
import { Check, X, Tag, CreditCard, Sparkles, Building2, Github } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
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
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-40" />
          <div className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <CreditCard className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  { dict.pricing.title }
                </span>
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { dict.pricing.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[16px]">
                { dict.pricing.subtitle }
              </p>
              <p className="mt-2 text-[12px] text-[var(--wb-fg-faint)]">{ dict.pricing.note }</p>
            </div>

            {/* Tier grid */}
            <div className="mt-14 grid gap-6 md:grid-cols-3">
              { dict.pricing.tiers.map((tier, idx) => {
                const Icon = TIER_ICONS[idx] ?? Tag;
                return (
                  <RevealOnScroll key={ tier.name } delay={ idx * 100 }>
                    <article
                      className={ `group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-[var(--wb-bg)] p-7 transition-all hover:shadow-wb-card-hover ${
                        tier.popular
                          ? 'border-brand shadow-wb-glow-brand'
                          : 'border-[var(--wb-border)]'
                      }` }
                    >
                      { tier.popular ? (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                          { locale === 'zh-CN' ? '最受欢迎' : 'Most popular' }
                        </span>
                      ) : null }

                      {/* Icon + Name */}
                      <div className="flex items-center gap-3">
                        <div
                          className={ `flex h-10 w-10 items-center justify-center rounded-lg ${
                            tier.popular
                              ? 'bg-brand text-white'
                              : 'bg-brand-soft text-brand-deep'
                          }` }
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <h2 className="font-display text-[20px] font-semibold tracking-tight text-[var(--wb-fg)]">
                          { tier.name }
                        </h2>
                      </div>

                      {/* Price */}
                      <div className="mt-6 flex items-baseline gap-1">
                        <span className="font-display text-[44px] font-semibold leading-none tracking-tight text-[var(--wb-fg)] sm:text-[52px]">
                          { tier.price }
                        </span>
                        <span className="ml-1 text-[12px] text-[var(--wb-fg-muted)]">
                          / { tier.cadence }
                        </span>
                      </div>

                      {/* Description */}
                      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
                        { tier.description }
                      </p>

                      {/* Features */}
                      <ul className="mt-6 flex-1 space-y-2.5 border-t border-[var(--wb-border)] pt-5">
                        { tier.features.map((feature) => (
                          <li
                            key={ feature }
                            className="flex items-start gap-2 text-[13.5px] leading-snug text-[var(--wb-fg-muted)]"
                          >
                            <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand" />
                            <span>{ feature }</span>
                          </li>
                        )) }
                      </ul>

                      {/* CTA */}
                      <Link
                        href={ tier.href }
                        target={ tier.href.startsWith('http') || tier.href.startsWith('mailto') ? '_blank' : undefined }
                        rel={ tier.href.startsWith('http') ? 'noreferrer' : undefined }
                        className={ `mt-7 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[14px] font-semibold transition-all ${
                          tier.popular
                            ? 'bg-brand text-white hover:opacity-90'
                            : 'border border-[var(--wb-border)] bg-[var(--wb-bg)] text-[var(--wb-fg)] hover:bg-[var(--wb-bg-soft-2)]'
                        }` }
                      >
                        <span>{ tier.cta }</span>
                        { tier.href.startsWith('mailto') ? null : (
                          <span aria-hidden="true">→</span>
                        ) }
                      </Link>
                    </article>
                  </RevealOnScroll>
                );
              }) }
            </div>
          </div>
        </section>

        {/* Compare table */}
        <section className="relative py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="font-display text-display-sm text-balance text-[var(--wb-fg)]">
                { dict.pricing.compareTitle }
              </h2>
              <p className="mt-3 text-pretty text-[14px] text-[var(--wb-fg-muted)]">
                { dict.pricing.compareSubtitle }
              </p>
            </div>

            <div className="mt-10 overflow-x-auto rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] shadow-wb-card">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
                    <th className="px-4 py-3 font-medium text-[var(--wb-fg-muted)] sm:px-6">
                      { locale === 'zh-CN' ? '功能' : 'Feature' }
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-[var(--wb-fg-muted)] sm:px-6">Community</th>
                    <th className="px-4 py-3 text-center font-medium text-[var(--wb-fg-muted)] sm:px-6">Pro</th>
                    <th className="px-4 py-3 text-center font-medium text-[var(--wb-fg-muted)] sm:px-6">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  { dict.pricing.compare.map((row, idx) => (
                    <tr
                      key={ row.feature }
                      className={ `border-b border-[var(--wb-border)] last:border-b-0 ${
                        idx % 2 === 0 ? 'bg-[var(--wb-bg)]' : 'bg-[var(--wb-bg-soft)]/40'
                      }` }
                    >
                      <td className="px-4 py-3 font-medium text-[var(--wb-fg)] sm:px-6">{ row.feature }</td>
                      <td className="px-4 py-3 text-center text-[var(--wb-fg-muted)] sm:px-6">
                        { row.community === '✓' ? (
                          <Check className="mx-auto h-4 w-4 text-brand" />
                        ) : row.community === '—' || row.community === '-' ? (
                          <X className="mx-auto h-3.5 w-3.5 text-[var(--wb-fg-faint)]" />
                        ) : (
                          row.community
                        ) }
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--wb-fg-muted)] sm:px-6">
                        { row.pro === '✓' ? (
                          <Check className="mx-auto h-4 w-4 text-brand" />
                        ) : row.pro === '—' || row.pro === '-' ? (
                          <X className="mx-auto h-3.5 w-3.5 text-[var(--wb-fg-faint)]" />
                        ) : (
                          row.pro
                        ) }
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--wb-fg-muted)] sm:px-6">
                        { row.enterprise === '✓' ? (
                          <Check className="mx-auto h-4 w-4 text-brand" />
                        ) : row.enterprise === '—' || row.enterprise === '-' ? (
                          <X className="mx-auto h-3.5 w-3.5 text-[var(--wb-fg-faint)]" />
                        ) : (
                          row.enterprise
                        ) }
                      </td>
                    </tr>
                  )) }
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Pricing FAQ */}
        <FAQSection
          dict={ { ...dict, faq: { ...dict.faq, sectionLabel: dict.pricing.faqTitle, title: dict.pricing.faqTitle, subtitle: '', items: dict.pricing.faq } } }
        />

        {/* Back link */}
        <div className="pb-12 text-center">
          <Link
            href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
            className="inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            ← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }
          </Link>
        </div>
      </main>
      <SiteFooter dict={ dict } />
      <BackToTop />
    </>
  );
}