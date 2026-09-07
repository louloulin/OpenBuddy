import type { Metadata } from 'next';
import { CheckCircle2, ArrowRight, MapIcon } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SharedHeader from '@/components/SharedHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What OpenBuddy has shipped, what is in progress, and what is up next.'
};

const STATUS = {
  shipped: { dot: 'var(--wb-working)', label: 'Shipped' },
  inProgress: { dot: 'var(--wb-warning)', label: 'In progress' },
  next: { dot: 'var(--wb-accent)', label: 'Up next' }
} as const;

export function RoadmapView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const groups = [
    { key: 'shipped' as const, data: dict.roadmap.shipped },
    { key: 'inProgress' as const, data: dict.roadmap.inProgress },
    { key: 'next' as const, data: dict.roadmap.next }
  ];

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SharedHeader
              label={ dict.roadmap.title }
              number="01"
              title={ dict.roadmap.title }
              subtitle={ dict.roadmap.subtitle }
            />

            <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-3">
              { groups.map((g, idx) => {
                const status = STATUS[g.key];
                return (
                  <RevealOnScroll key={ g.key } delay={ idx * 100 }>
                    <article className="group flex h-full flex-col gap-4 bg-[var(--wb-bg-pure)] p-6 transition-colors hover:bg-[var(--wb-bg-soft)]">
                      <header className="flex items-center justify-between border-b border-[var(--wb-border)] pb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={ { background: status.dot } }
                          />
                          <h2 className="font-display-serif text-[18px] leading-tight text-[var(--wb-fg)]">
                            { g.data.label }
                          </h2>
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                          { String(g.data.items.length).padStart(2, '0') }
                        </span>
                      </header>

                      <ul className="space-y-2">
                        { g.data.items.map((item, i) => (
                          <li
                            key={ i }
                            className="flex items-start gap-2 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]"
                          >
                            <span
                              className="mt-1 flex-shrink-0"
                              style={ { color: status.dot } }
                            >
                              { g.key === 'shipped' ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : g.key === 'inProgress' ? (
                                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                              ) : (
                                <ArrowRight className="h-3.5 w-3.5" />
                              ) }
                            </span>
                            <span>{ item }</span>
                          </li>
                        )) }
                      </ul>
                    </article>
                  </RevealOnScroll>
                );
              }) }
            </div>

            <div className="mt-12 text-center">
              <p className="text-[13px] text-[var(--wb-fg-muted)]">
                { locale === 'zh-CN'
                  ? '想影响路线图?在 Discussions 中以 '
                  : 'Want to influence the roadmap? Open an issue with the ' }
                <code className="rounded bg-[var(--wb-bg-soft-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--wb-fg)]">
                  roadmap:
                </code>
                { locale === 'zh-CN' ? ' 标签开启讨论' : ' label in Discussions.' }
              </p>
              <Link
                href={ locale === 'zh-CN' ? '/zh-CN' : '/' }
                className="mt-6 inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
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