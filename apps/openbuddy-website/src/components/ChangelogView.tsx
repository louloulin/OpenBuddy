import type { Metadata } from 'next';
import { Calendar, Tag, GitCommit, Sparkles, Wrench, Bug, ExternalLink } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import SharedHeader from '@/components/SharedHeader';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Every OpenBuddy release — highlights, improvements, fixes. Subscribe to GitHub Releases for notifications.'
};

const TAG_STYLES: Record<string, { dot: string; chip: string }> = {
  stable: { dot: 'var(--wb-working)', chip: 'bg-[var(--wb-working-soft)] text-[var(--wb-working-fg)] border-[var(--wb-working-border)]' },
  beta: { dot: 'var(--wb-warning)', chip: 'bg-[var(--wb-warning-soft)] text-[var(--wb-warning)] border-[rgba(217,119,6,0.30)]' },
  alpha: { dot: 'var(--wb-blocked)', chip: 'bg-[var(--wb-blocked-soft)] text-[var(--wb-blocked)] border-[rgba(220,38,38,0.30)]' },
  lts: { dot: 'var(--wb-accent)', chip: 'bg-[rgba(79,70,229,0.10)] text-[var(--wb-accent)] border-[rgba(79,70,229,0.30)]' }
};

export function ChangelogView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative section-pad">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <SharedHeader
              label={ dict.changelog.title }
              number="01"
              title={ dict.changelog.title }
              subtitle={ dict.changelog.subtitle }
            />

            {/* Timeline */}
            <div className="relative">
              <div className="absolute left-[19px] top-2 bottom-2 hidden w-px bg-gradient-to-b from-[var(--wb-working)] via-[var(--wb-border)] to-transparent sm:block" />

              <div className="space-y-12">
                { dict.changelog.releases.map((r, idx) => {
                  const tag = TAG_STYLES[r.tag] ?? TAG_STYLES.stable;
                  return (
                    <RevealOnScroll key={ r.version } delay={ idx * 80 }>
                      <article className="relative sm:pl-14">
                        {/* Timeline dot */}
                        <div
                          className="absolute left-0 top-3 hidden h-10 w-10 items-center justify-center rounded-full border-2 bg-[var(--wb-bg-pure)] sm:flex"
                          style={ { borderColor: tag.dot } }
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={ { background: tag.dot } }
                          />
                        </div>

                        <div className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-6 transition-colors hover:border-[var(--wb-border-strong)] sm:p-7">
                          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-[var(--wb-border)] pb-5">
                            <div className="flex items-center gap-3">
                              <h2 className="font-display-serif text-[24px] leading-tight text-[var(--wb-fg)] sm:text-[28px]">
                                { r.version }
                              </h2>
                              <span
                                className={ `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tag.chip}` }
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={ { background: tag.dot } }
                                />
                                { r.tag }
                              </span>
                            </div>
                            <div className="ml-auto flex items-center gap-1.5 font-mono text-[12px] text-[var(--wb-fg-muted)]">
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{ r.date }</span>
                            </div>
                          </header>

                          <div className="mt-5 space-y-5">
                            <Block
                              icon={ Sparkles }
                              title={ locale === 'zh-CN' ? '亮点' : 'Highlights' }
                              items={ r.highlights }
                            />
                            { r.improvements ? (
                              <Block
                                icon={ Wrench }
                                title={ locale === 'zh-CN' ? '改进' : 'Improvements' }
                                items={ r.improvements }
                              />
                            ) : null }
                            { r.fixes ? (
                              <Block
                                icon={ Bug }
                                title={ locale === 'zh-CN' ? '修复' : 'Fixes' }
                                items={ r.fixes }
                              />
                            ) : null }
                          </div>

                          <footer className="mt-6 border-t border-[var(--wb-border)] pt-4">
                            <a
                              href={ r.githubHref }
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--wb-accent)] hover:underline"
                            >
                              { locale === 'zh-CN' ? '在 GitHub 查看完整发布说明' : 'View full release notes on GitHub' }
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </footer>
                        </div>
                      </article>
                    </RevealOnScroll>
                  );
                }) }
              </div>
            </div>

            <div className="mt-16 text-center">
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

function Block({
  icon: Icon,
  title,
  items
}: {
  icon: typeof Sparkles;
  title: string;
  items: string[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--wb-fg-faint)]">
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