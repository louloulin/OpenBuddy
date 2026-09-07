import type { Metadata } from 'next';
import { CheckCircle2, Circle, ArrowRight, MapIcon } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What OpenBuddy has shipped, what is in progress, and what is up next.'
};

const STATUS_STYLES = {
  shipped: {
    bg: 'bg-brand-2',
    border: 'border-brand-3',
    text: 'text-brand-9',
    icon: CheckCircle2,
    label: 'Done'
  },
  inProgress: {
    bg: 'bg-amber-2',
    border: 'border-amber-3',
    text: 'text-amber-9',
    icon: Circle,
    label: 'WIP'
  },
  next: {
    bg: 'bg-sky-2',
    border: 'border-sky-3',
    text: 'text-sky-9',
    icon: ArrowRight,
    label: 'Next'
  }
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
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-40" />
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <MapIcon className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  { dict.roadmap.title }
                </span>
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { dict.roadmap.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[16px]">
                { dict.roadmap.subtitle }
              </p>
            </div>

            {/* 3 columns */}
            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              { groups.map((g, idx) => {
                const style = STATUS_STYLES[g.key];
                const Icon = style.icon;
                return (
                  <RevealOnScroll key={ g.key } delay={ idx * 100 }>
                    <article
                      className={ `group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-[var(--wb-bg)] p-6 transition-all hover:shadow-wb-card-hover ${style.border}` }
                    >
                      {/* Status header */}
                      <header className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={ `flex h-8 w-8 items-center justify-center rounded-lg ${style.bg} ${style.text}` }
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <h2 className="font-display text-[16px] font-semibold tracking-tight text-[var(--wb-fg)]">
                              { g.data.label }
                            </h2>
                            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--wb-fg-muted)]">
                              { style.label } · { g.data.items.length } { locale === 'zh-CN' ? '项' : 'items' }
                            </p>
                          </div>
                        </div>
                      </header>

                      {/* Item list */}
                      <ul className="mt-5 space-y-2.5">
                        { g.data.items.map((item, i) => (
                          <li
                            key={ i }
                            className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]"
                          >
                            <span className={ `mt-0.5 flex-shrink-0 ${style.text}` }>
                              { g.key === 'shipped' ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : g.key === 'inProgress' ? (
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
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