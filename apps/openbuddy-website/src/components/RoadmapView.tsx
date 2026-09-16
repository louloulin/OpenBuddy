import { CheckCircle2, ArrowRight } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Reveal from '@/components/motion/Reveal';
import { PageHeader, SectionHeader } from '@/components/PageHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import Link from 'next/link';

const STATUS = {
  shipped: { dot: 'var(--wb-working)', label: 'Shipped' },
  inProgress: { dot: 'var(--wb-warning)', label: 'In progress' },
  next: { dot: 'var(--wb-brand)', label: 'Up next' }
} as const;

export function RoadmapView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const groups = [
    { key: 'shipped' as const, data: dict.roadmap.shipped },
    { key: 'inProgress' as const, data: dict.roadmap.inProgress },
    { key: 'next' as const, data: dict.roadmap.next }
  ];
  const isZh = locale === 'zh-CN';

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow={ isZh ? '路线图' : 'Roadmap' }
              title={ dict.roadmap.title }
              subtitle={ dict.roadmap.subtitle }
              compact={ isZh }
            />

            <div className="mt-16 grid gap-5 md:grid-cols-3">
              { groups.map((g, idx) => {
                const status = STATUS[g.key];
                return (
                  <Reveal
                    key={ g.key }
                    as="article"
                    delay={ idx * 90 }
                    className={ `flex h-full flex-col gap-5 rounded-2xl border p-6 transition-all ${
                      idx === 1
                        ? 'border-[var(--wb-brand)] bg-[var(--wb-bg-pure)] shadow-[0_0_0_4px_var(--wb-brand-soft)]'
                        : 'border-[var(--wb-border)] bg-[var(--wb-bg-pure)]'
                    }` }
                  >
                    <header className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
                      <div className="flex items-center gap-2.5">
                        <span className={ `h-2 w-2 rounded-full ${g.key === 'inProgress' ? 'animate-pulse' : ''}` } style={ { background: status.dot } } />
                        <h2 className="font-display-serif text-[20px] leading-tight text-[var(--wb-fg)]">{ g.data.label }</h2>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
                        { String(g.data.items.length).padStart(2, '0') } { isZh ? '项' : 'items' }
                      </span>
                    </header>

                    <ul className="space-y-3">
                      { g.data.items.map((item, i) => (
                        <li key={ i } className="flex items-start gap-3 text-[13.5px] leading-snug text-[var(--wb-fg)]">
                          <span className="mt-0.5 flex-shrink-0" style={ { color: status.dot } }>
                            { g.key === 'shipped' ? <CheckCircle2 className="h-4 w-4" /> : g.key === 'inProgress' ? <span className="inline-block h-1.5 w-1.5 mt-1.5 animate-pulse rounded-full bg-current" /> : <ArrowRight className="h-4 w-4" /> }
                          </span>
                          <span>{ item }</span>
                        </li>
                      )) }
                    </ul>
                  </Reveal>
                );
              }) }
            </div>

            <div className="mt-20 rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 sm:p-8">
              <SectionHeader
                eyebrow={ isZh ? '参与' : 'Contribute' }
                title={ isZh ? '想影响路线图?' : 'Want to influence the roadmap?' }
                subtitle={ isZh ? '在 GitHub Discussions 中开启以 roadmap: 标签的讨论,或在 Issue 中提案。' : 'Open a discussion with the roadmap: label, or file an issue with a proposal.' }
              />
              <div className="flex flex-wrap items-center gap-3">
                <a href="https://github.com/louloulin/OpenBuddy/discussions" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-[var(--wb-fg)] px-5 py-2.5 text-[13.5px] font-medium text-[var(--wb-bg)] transition-opacity hover:opacity-90">
                  <span>{ isZh ? '开启讨论' : 'Open a discussion' }</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
                <a href="https://github.com/louloulin/OpenBuddy/blob/main/TODO.md" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-5 py-2.5 text-[13.5px] font-medium text-[var(--wb-fg)] transition-colors hover:border-[var(--wb-border-strong)]">
                  <span>{ isZh ? '查看完整 TODO.md' : 'View full TODO.md' }</span>
                </a>
              </div>
            </div>

            <div className="mt-12">
              <Link href={ localizedPath('/', locale) } className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] text-[14px]">
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
