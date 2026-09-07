import type { Metadata } from 'next';
import { Calendar, Tag, GitCommit, Sparkles, Wrench, Bug, ExternalLink } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { getDictionary, type Locale } from '@/lib/i18n';
import Link from 'next/link';
import RevealOnScroll from '@/components/RevealOnScroll';
import BackToTop from '@/components/BackToTop';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Every OpenBuddy release — highlights, improvements, fixes. Subscribe to GitHub Releases for notifications.'
};

const TAG_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  stable: { bg: 'bg-brand-2', text: 'text-brand-10 dark:text-brand-8', border: 'border-brand-3' },
  beta: { bg: 'bg-amber-2', text: 'text-amber-10', border: 'border-amber-3' },
  alpha: { bg: 'bg-rose-2', text: 'text-rose-10', border: 'border-rose-3' },
  lts: { bg: 'bg-sky-2', text: 'text-sky-10', border: 'border-sky-3' }
};

export function ChangelogView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-40" />
          <div className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <GitCommit className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  { dict.changelog.title }
                </span>
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { dict.changelog.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)] sm:text-[16px]">
                { dict.changelog.subtitle }
              </p>
            </div>

            {/* Timeline */}
            <div className="relative mt-16">
              {/* Vertical line */}
              <div className="absolute left-[19px] top-2 bottom-2 hidden w-px bg-gradient-to-b from-brand-8 via-[var(--wb-border)] to-transparent sm:block" />

              <div className="space-y-10">
                { dict.changelog.releases.map((r, idx) => {
                  const tag = TAG_STYLES[r.tag] ?? TAG_STYLES.stable;
                  return (
                    <RevealOnScroll key={ r.version } delay={ idx * 80 }>
                      <article className="relative sm:pl-14">
                        {/* Timeline dot */}
                        <div
                          className={ `absolute left-0 top-4 hidden h-10 w-10 items-center justify-center rounded-full border-2 sm:flex ${tag.bg} ${tag.border}` }
                        >
                          <Tag className={ `h-3.5 w-3.5 ${tag.text}` } />
                        </div>

                        {/* Card */}
                        <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 transition-all hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover sm:p-8">
                          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-[var(--wb-border)] pb-5">
                            <div className="flex items-center gap-3">
                              <h2 className="font-display text-[24px] font-semibold tracking-tight text-[var(--wb-fg)] sm:text-[28px]">
                                { r.version }
                              </h2>
                              <span
                                className={ `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tag.bg} ${tag.text} ${tag.border}` }
                              >
                                { r.tag }
                              </span>
                            </div>
                            <div className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--wb-fg-muted)]">
                              <Calendar className="h-3.5 w-3.5" />
                              <span className="font-mono">{ r.date }</span>
                            </div>
                          </header>

                          <div className="mt-5 space-y-5">
                            <Block
                              icon={ Sparkles }
                              title={ locale === 'zh-CN' ? '亮点' : 'Highlights' }
                              items={ r.highlights }
                              accent="text-brand-9"
                            />
                            { r.improvements ? (
                              <Block
                                icon={ Wrench }
                                title={ locale === 'zh-CN' ? '改进' : 'Improvements' }
                                items={ r.improvements }
                                accent="text-amber-9"
                              />
                            ) : null }
                            { r.fixes ? (
                              <Block
                                icon={ Bug }
                                title={ locale === 'zh-CN' ? '修复' : 'Fixes' }
                                items={ r.fixes }
                                accent="text-sky-9"
                              />
                            ) : null }
                          </div>

                          <footer className="mt-6 border-t border-[var(--wb-border)] pt-4">
                            <a
                              href={ r.githubHref }
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-9 hover:underline"
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
  items,
  accent
}: {
  icon: typeof Sparkles;
  title: string;
  items: string[];
  accent: string;
}) {
  return (
    <div>
      <div className={ `mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${accent}` }>
        <Icon className="h-3.5 w-3.5" />
        <span>{ title }</span>
      </div>
      <ul className="space-y-1.5">
        { items.map((item, idx) => (
          <li key={ idx } className="flex items-start gap-2 text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">
            <span className="mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-current opacity-60" />
            <span>{ item }</span>
          </li>
        )) }
      </ul>
    </div>
  );
}