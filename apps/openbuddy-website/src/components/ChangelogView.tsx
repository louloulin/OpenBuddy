import type { Metadata } from 'next';
import { Calendar, Sparkles, Wrench, Bug, ExternalLink } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { PageHeader } from '@/components/PageHeader';
import type { ChangelogRelease } from '@/lib/changelog-server';
import { getDictionary, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Every OpenBuddy release — highlights, improvements, fixes. Subscribe to GitHub Releases for notifications.'
};

const TAG_STYLES: Record<string, { dot: string; chip: string }> = {
  stable: { dot: 'var(--wb-working)', chip: 'bg-[var(--wb-working-soft)] text-[var(--wb-working-fg)] border-[var(--wb-working-border)]' },
  beta: { dot: 'var(--wb-warning)', chip: 'bg-[var(--wb-warning-soft)] text-[var(--wb-warning)] border-[rgba(217,119,6,0.30)]' },
  alpha: { dot: 'var(--wb-blocked)', chip: 'bg-[var(--wb-blocked-soft)] text-[var(--wb-blocked)] border-[rgba(220,38,38,0.30)]' },
  lts: { dot: 'var(--wb-brand)', chip: 'bg-[var(--wb-brand-soft)] text-[var(--wb-brand)] border-[var(--wb-brand-border)]' }
};

export function ChangelogView({ locale, releases }: { locale: Locale; releases: ChangelogRelease[] }) {
  const dict = getDictionary(locale);
  const isZh = locale === 'zh-CN';

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow={ isZh ? '更新日志' : 'Changelog' }
              title={ dict.changelog.title }
              subtitle={ dict.changelog.subtitle }
              compact={ isZh }
            />

            <div className="relative mt-16">
              <div className="absolute left-[19px] top-2 bottom-2 hidden w-px bg-gradient-to-b from-[var(--wb-working)] via-[var(--wb-border)] to-transparent sm:block" />

              <div className="space-y-10">
                { releases.length === 0 ? (
                  <p className="text-[var(--wb-fg-muted)]">{ isZh ? '暂无更新日志。' : 'No releases published yet.' }</p>
                ) : releases.map((r) => {
                  const tag = TAG_STYLES[r.tag] ?? TAG_STYLES.stable;
                  return (
                    <article key={ r.version } className="relative sm:pl-14">
                      <div className="absolute left-0 top-3 hidden h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--wb-bg-pure)] sm:flex" style={ { borderColor: tag.dot } }>
                        <span className="h-2 w-2 rounded-full" style={ { background: tag.dot } } />
                      </div>

                      <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-6 transition-colors hover:border-[var(--wb-border-strong)] sm:p-7">
                        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-[var(--wb-border)] pb-5">
                          <div className="flex items-center gap-3">
                            <h2 className="font-display-serif text-[26px] leading-tight tracking-[-0.02em] text-[var(--wb-fg)] sm:text-[30px]">{ r.version }</h2>
                            <span className={ `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tag.chip}` }>
                              <span className="h-1.5 w-1.5 rounded-full" style={ { background: tag.dot } } />
                              { r.tag }
                            </span>
                          </div>
                          <div className="ml-auto flex items-center gap-1.5 font-mono text-[12px] text-[var(--wb-fg-muted)]">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{ r.date }</span>
                          </div>
                        </header>

                        <div className="mt-5 space-y-5">
                          <Block icon={ Sparkles } title={ isZh ? '亮点' : 'Highlights' } items={ r.highlights } />
                          { r.improvements ? <Block icon={ Wrench } title={ isZh ? '改进' : 'Improvements' } items={ r.improvements } /> : null }
                          { r.fixes ? <Block icon={ Bug } title={ isZh ? '修复' : 'Fixes' } items={ r.fixes } /> : null }
                        </div>

                        <footer className="mt-6 border-t border-[var(--wb-border)] pt-4">
                          <a href={ r.githubHref } target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--wb-brand)] hover:underline">
                            { isZh ? '在 GitHub 查看完整发布说明' : 'View full release notes on GitHub' }
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </footer>
                      </div>
                    </article>
                  );
                }) }
              </div>
            </div>

            <div className="mt-16">
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

function Block({ icon: Icon, title, items }: { icon: typeof Sparkles; title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
        <Icon className="h-3.5 w-3.5" />
        <span>{ title }</span>
      </div>
      <ul className="space-y-1.5">
        { items.map((item, idx) => (
          <li key={ idx } className="flex items-start gap-2 text-[13.5px] leading-relaxed text-[var(--wb-fg-muted)]">
            <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-[var(--wb-fg-faint)]" />
            <span>{ item }</span>
          </li>
        )) }
      </ul>
    </div>
  );
}
