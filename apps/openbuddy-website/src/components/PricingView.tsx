import { Check } from 'lucide-react';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Reveal from '@/components/motion/Reveal';
import { PageHeader, SectionHeader } from '@/components/PageHeader';
import { getDictionary, localizedPath, type Locale } from '@/lib/i18n';

export function PricingView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const tiers = dict.pricing.tiers;
  const isZh = locale === 'zh-CN';

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow={ isZh ? '定价' : 'Pricing' }
              title={ dict.pricing.title }
              subtitle={ dict.pricing.subtitle }
              note={ dict.pricing.note }
              compact={ isZh }
            />

            <div className="mt-16 grid gap-5 md:grid-cols-3">
              { tiers.map((tier, tierIndex) => (
                <Reveal
                  key={ tier.name }
                  as="article"
                  delay={ tierIndex * 90 }
                  className={ `relative flex flex-col gap-6 rounded-2xl border p-7 transition-all ${
                    tier.popular
                      ? 'border-[var(--wb-brand)] bg-[var(--wb-bg-pure)] shadow-[0_0_0_4px_var(--wb-brand-soft)]'
                      : 'border-[var(--wb-border)] bg-[var(--wb-bg-pure)]'
                  }` }
                >
                  { tier.popular ? (
                    <span className="absolute right-6 top-6 rounded-full bg-brand-10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-brand-8 dark:text-[var(--wb-bg)]">
                      { isZh ? '推荐' : 'Popular' }
                    </span>
                  ) : null }

                  <div>
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--wb-fg-muted)]">
                      { tier.name }
                    </span>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-display-serif text-[44px] leading-none tracking-[-0.02em] text-[var(--wb-fg)]">
                        { tier.price }
                      </span>
                      <span className="ml-1 font-mono text-[11px] text-[var(--wb-fg-muted)]">
                        / { tier.cadence }
                      </span>
                    </div>
                    <p className="mt-3 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
                      { tier.description }
                    </p>
                  </div>

                  <ul className="flex-1 space-y-2.5 border-t border-[var(--wb-border)] pt-5">
                    { tier.features.map((feature) => (
                      <li key={ feature } className="flex items-start gap-3 text-[13.5px] leading-snug text-[var(--wb-fg)]">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--wb-working)]" />
                        <span>{ feature }</span>
                      </li>
                    )) }
                  </ul>

                  <Link
                    href={ tier.href }
                    target={ tier.href.startsWith('http') || tier.href.startsWith('mailto') ? '_blank' : undefined }
                    rel={ tier.href.startsWith('http') ? 'noreferrer' : undefined }
                    className={ `cta-link text-[14px] ${
                      tier.popular
                        ? 'text-[var(--wb-fg)]'
                        : 'text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]'
                    }` }
                  >
                    <span>{ tier.cta }</span>
                    <span className="cta-link-arrow">→</span>
                  </Link>
                </Reveal>
              )) }
            </div>

            <div className="mt-24">
              <SectionHeader
                eyebrow={ isZh ? '功能对比' : 'Compare' }
                title={ dict.pricing.compareTitle }
                subtitle={ dict.pricing.compareSubtitle }
              />

              <div className="overflow-x-auto rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)]">
                <table className="w-full text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-[var(--wb-border)]">
                      <th className="px-6 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                        { isZh ? '功能' : 'Feature' }
                      </th>
                      { tiers.map((t) => (
                        <th key={ t.name } className="px-6 py-4 text-center font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                          { t.name }
                        </th>
                      )) }
                    </tr>
                  </thead>
                  <tbody>
                    { dict.pricing.compare.map((row, idx) => (
                      <tr
                        key={ row.feature }
                        className={ `border-b border-[var(--wb-border)] last:border-b-0 ${
                          idx % 2 === 1 ? 'bg-[var(--wb-bg-soft)]/40' : ''
                        }` }
                      >
                        <td className="px-6 py-3.5 font-medium text-[var(--wb-fg)]">{ row.feature }</td>
                        <td className="px-6 py-3.5 text-center text-[var(--wb-fg-muted)]">{ renderCell(row.community) }</td>
                        <td className="px-6 py-3.5 text-center text-[var(--wb-fg-muted)]">{ renderCell(row.pro) }</td>
                        <td className="px-6 py-3.5 text-center text-[var(--wb-fg-muted)]">{ renderCell(row.enterprise) }</td>
                      </tr>
                    )) }
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-24">
              <SectionHeader
                eyebrow="FAQ"
                title={ dict.pricing.faqTitle }
              />

              <div className="space-y-3">
                { dict.pricing.faq.map((item, idx) => (
                  <details
                    key={ item.q }
                    className="group rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] transition-colors hover:border-[var(--wb-border-strong)]"
                    { ...(idx === 0 ? { open: true } : {}) }
                  >
                    <summary className="flex w-full cursor-pointer items-center gap-5 px-6 py-5 text-left">
                      <span className="font-mono text-[11px] font-medium text-[var(--wb-fg-faint)]">
                        { String(idx + 1).padStart(2, '0') }
                      </span>
                      <span className="flex-1 text-[15.5px] font-medium text-[var(--wb-fg)]">
                        { item.q }
                      </span>
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--wb-border)] text-[var(--wb-fg-muted)] transition-colors group-open:border-brand-10 group-open:bg-brand-10 group-open:text-white dark:group-open:border-brand-8 dark:group-open:bg-brand-8 dark:group-open:text-[var(--wb-bg)]">
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

            <div className="mt-16">
              <Link
                href={ localizedPath('/', locale) }
                className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] text-[14px]"
              >
                <span>← { isZh ? '返回首页' : 'Back to home' }</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } locale={ locale } />
    </>
  );
}

function renderCell(value: string) {
  if (value === '✓') return <Check className="mx-auto h-4 w-4 text-[var(--wb-working)]" />;
  if (value === '✗') return <span className="font-mono text-[12px] text-[var(--wb-fg-faint)]">—</span>;
  return <span className="font-mono text-[12px]">{ value }</span>;
}
