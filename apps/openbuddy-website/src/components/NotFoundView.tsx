import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { DocMeta } from '@/lib/docs-meta';
import type { Locale } from '@/lib/i18n';

const POPULAR_DOCS = ['getting-started', 'architecture', 'plugin-development', 'comparison', 'roadmap'];

const COPY: Record<Locale, {
  eyebrow: string;
  heading: string;
  body: string;
  home: string;
  browse: string;
  report: string;
}> = {
  en: {
    eyebrow: '404 · Not Found',
    heading: 'This page doesn’t exist.',
    body: 'The docs moved, the URL was mistyped, or you’re chasing a link from an archived page. Try one of these popular destinations:',
    home: 'Take me home',
    browse: 'Browse all docs',
    report: 'Report broken link'
  },
  'zh-CN': {
    eyebrow: '404 · 页面不存在',
    heading: '这个页面不存在。',
    body: '文档可能已经迁移,链接可能拼错了,或者你点的是某个归档页面里的链接。试试下面这些常用入口:',
    home: '回到首页',
    browse: '浏览全部文档',
    report: '报告失效链接'
  }
};

/**
 * NotFoundView —— 404 的内容主体。
 *
 * `app/not-found.tsx` 和 `app/[locale]/not-found.tsx` 共用这一份,避免两处各写
 * 一遍(根目录那份的中文用户此前拿到的是全英文页面,且链接写死 /en)。
 */
export default function NotFoundView({ locale, docs }: { locale: Locale; docs: DocMeta[] }) {
  const copy = COPY[locale];
  const popular = POPULAR_DOCS
    .map((slug) => docs.find((d) => d.slug === slug))
    .filter((d): d is DocMeta => Boolean(d));

  return (
    <main className="grid min-h-screen place-items-center px-4 py-20">
      <div className="mx-auto w-full max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-muted)]">
          { copy.eyebrow }
        </p>
        <h1 className="mt-3 font-display-serif text-[clamp(40px,6vw,72px)] font-normal leading-[1.02] tracking-[-0.03em] text-[var(--wb-fg)]">
          { copy.heading }
        </h1>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
          { copy.body }
        </p>

        <ul className="mt-8 grid gap-2 sm:grid-cols-2">
          { popular.map((d) => (
            <li key={ d.slug }>
              <Link
                href={ `/${ locale }/docs/${ d.slug }` }
                className="wb-card group block"
              >
                <h2 className="font-display-serif text-[17px] leading-snug text-[var(--wb-fg)]">
                  { d.title }
                </h2>
                <p className="mt-1 text-[12.5px] leading-snug text-[var(--wb-fg-muted)]">
                  { d.description }
                </p>
              </Link>
            </li>
          )) }
        </ul>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href={ `/${ locale }` }
            className="cta-link cta-link-primary bg-[var(--wb-fg)] px-5 py-3 text-[var(--wb-bg)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{ copy.home }</span>
          </Link>
          <Link
            href={ `/${ locale }/docs` }
            className="cta-link border border-[var(--wb-border-strong)] px-5 py-3 text-[var(--wb-fg)]"
          >
            <span>{ copy.browse }</span>
          </Link>
          <a
            href="https://github.com/louloulin/OpenBuddy/issues"
            target="_blank"
            rel="noreferrer"
            className="cta-link px-2 py-3 text-[var(--wb-fg-muted)]"
          >
            <span>{ copy.report }</span>
            <span className="cta-link-arrow">↗</span>
          </a>
        </div>
      </div>
    </main>
  );
}
