import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'OpenBuddy is free, MIT-licensed, forever. Enterprise is self-hosted with SLAs.'
};

export function PricingView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);

  const tiers = [
    {
      name: dict.pricing.tiers[0]?.name ?? 'Community',
      price: '$0',
      cadence: dict.pricing.tiers[0]?.cadence ?? 'forever',
      description: dict.pricing.tiers[0]?.description ?? '',
      features: dict.pricing.tiers[0]?.features ?? [],
      cta: dict.pricing.tiers[0]?.cta ?? 'Download',
      href: dict.pricing.tiers[0]?.href ?? '/download',
      popular: false
    },
    {
      name: dict.pricing.tiers[2]?.name ?? 'Enterprise',
      price: dict.pricing.tiers[2]?.price ?? 'Custom',
      cadence: dict.pricing.tiers[2]?.cadence ?? 'self-hosted',
      description: dict.pricing.tiers[2]?.description ?? '',
      features: dict.pricing.tiers[2]?.features ?? [],
      cta: dict.pricing.tiers[2]?.cta ?? 'Contact',
      href: dict.pricing.tiers[2]?.href ?? 'mailto:business@openbuddy.dev',
      popular: true
    }
  ];

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <header className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
                  § 01
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                  Pricing
                </span>
              </div>
              <h1 className="text-display-xl text-[var(--wb-fg)] text-balance">
                { dict.pricing.title }
              </h1>
            </header>
            <p className="mt-6 max-w-2xl text-body-lg text-[var(--wb-fg-muted)] text-pretty md:ml-[120px]">
              { dict.pricing.subtitle }
            </p>
            <p className="mt-3 max-w-2xl font-mono text-[12px] text-[var(--wb-fg-faint)] md:ml-[120px]">
              { dict.pricing.note }
            </p>

            {/* 2 tier — tutti 极简风格 */}
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              { tiers.map((tier) => (
                <article
                  key={ tier.name }
                  className={ `group relative flex flex-col gap-6 rounded-xl p-8 transition-all hover:-translate-y-0.5 ${
                    tier.popular
                      ? 'border border-[var(--wb-accent)]/30 bg-[var(--wb-bg-pure)] shadow-[0_0_0_4px_rgba(82,102,232,0.08)]'
                      : 'border border-[var(--wb-border)] bg-[var(--wb-bg-pure)]'
                  }` }
                >
                  { tier.popular ? (
                    <span className="absolute right-6 top-6 rounded-full bg-[var(--wb-accent)] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
                      for teams
                    </span>
                  ) : null }

                  <div>
                    <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--wb-fg-muted)]">
                      { tier.name }
                    </span>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-display-serif text-[56px] leading-none tracking-tight text-[var(--wb-fg)]">
                        { tier.price }
                      </span>
                      <span className="ml-1 font-mono text-[12px] text-[var(--wb-fg-muted)]">
                        / { tier.cadence }
                      </span>
                    </div>
                    <p className="mt-3 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                      { tier.description }
                    </p>
                  </div>

                  <ul className="flex-1 space-y-3 border-t border-[var(--wb-border)] pt-6">
                    { tier.features.map((feature) => (
                      <li
                        key={ feature }
                        className="flex items-start gap-3 text-[14px] leading-snug text-[var(--wb-fg-muted)]"
                      >
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--wb-working)]" />
                        <span>{ feature }</span>
                      </li>
                    )) }
                  </ul>

                  <Link
                    href={ tier.href }
                    target={ tier.href.startsWith('http') || tier.href.startsWith('mailto') ? '_blank' : undefined }
                    rel={ tier.href.startsWith('http') ? 'noreferrer' : undefined }
                    className={ `cta-link text-[15px] ${
                      tier.popular
                        ? 'text-[var(--wb-accent)]'
                        : 'text-[var(--wb-fg)]'
                    }` }
                  >
                    <span>{ tier.cta }</span>
                    <span className="cta-link-arrow">→</span>
                  </Link>
                </article>
              )) }
            </div>

            {/* Compare table */}
            <div className="mt-24">
              <header className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
                    § 02
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                    Compare
                  </span>
                </div>
                <h2 className="text-display-lg text-[var(--wb-fg)] text-balance">
                  { dict.pricing.compareTitle }
                </h2>
              </header>
              <p className="mt-6 max-w-2xl text-body-lg text-[var(--wb-fg-muted)] text-pretty md:ml-[120px]">
                { dict.pricing.compareSubtitle }
              </p>

              <div className="mt-12 overflow-x-auto rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)]">
                <table className="w-full text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
                      <th className="px-6 py-4 font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)]">
                        { locale === 'zh-CN' ? '功能' : 'Feature' }
                      </th>
                      <th className="px-6 py-4 text-center font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)]">Community</th>
                      <th className="px-6 py-4 text-center font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--wb-fg-faint)]">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    { dict.pricing.compare.map((row, idx) => (
                      <tr
                        key={ row.feature }
                        className="border-b border-[var(--wb-border)] last:border-b-0"
                      >
                        <td className="px-6 py-3.5 font-medium text-[var(--wb-fg)]">{ row.feature }</td>
                        <td className="px-6 py-3.5 text-center text-[var(--wb-fg-muted)]">
                          { row.community === '✓' ? (
                            <Check className="mx-auto h-4 w-4 text-[var(--wb-working)]" />
                          ) : (
                            <span className="font-mono text-[12px]">{ row.community }</span>
                          ) }
                        </td>
                        <td className="px-6 py-3.5 text-center text-[var(--wb-fg-muted)]">
                          { row.enterprise === '✓' ? (
                            <Check className="mx-auto h-4 w-4 text-[var(--wb-working)]" />
                          ) : (
                            <span className="font-mono text-[12px]">{ row.enterprise }</span>
                          ) }
                        </td>
                      </tr>
                    )) }
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pricing FAQ */}
            <div className="mt-24">
              <header className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
                    § 03
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                    FAQ
                  </span>
                </div>
                <h2 className="text-display-lg text-[var(--wb-fg)] text-balance">
                  { dict.pricing.faqTitle }
                </h2>
              </header>

              <div className="mt-12 space-y-px overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-border)]">
                { dict.pricing.faq.map((item, idx) => (
                  <details
                    key={ item.q }
                    className="group bg-[var(--wb-bg-pure)]"
                    { ...(idx === 0 ? { open: true } : {}) }
                  >
                    <summary className="flex w-full cursor-pointer items-center gap-5 px-6 py-5 text-left transition-colors hover:bg-[var(--wb-bg-soft)]">
                      <span className="font-mono text-[11px] font-medium text-[var(--wb-fg-faint)]">
                        { String(idx + 1).padStart(2, '0') }
                      </span>
                      <span className="flex-1 text-[15.5px] font-medium text-[var(--wb-fg)]">
                        { item.q }
                      </span>
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--wb-border)] text-[var(--wb-fg-muted)] transition-colors group-open:border-[var(--wb-accent)] group-open:bg-[var(--wb-accent)] group-open:text-white">
                        <span className="block text-[18px] leading-none">+</span>
                      </span>
                    </summary>
                    <p className="px-6 pb-5 pl-16 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                      { item.a }
                    </p>
                  </details>
                )) }
              </div>
            </div>

            <div className="mt-16 text-center">
              <Link
                href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
                className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] text-[14px]"
              >
                <span>← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}
