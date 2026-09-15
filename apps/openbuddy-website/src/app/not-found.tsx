import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getAllDocs } from '@/lib/docs-meta';

const POPULAR_DOCS = ['getting-started', 'architecture', 'plugin-development', 'comparison', 'roadmap'];

/**
 * 404 —— 让丢失的页面也能回到主路径。
 * 显示顶部"已搜热门文档"列表(直接从 docs-meta 抽),而不是空荡荡的"home"按钮。
 */
export default function NotFound() {
  const all = getAllDocs();
  const popular = POPULAR_DOCS
    .map((slug) => all.find((d) => d.slug === slug))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return (
    <main className="grid min-h-screen place-items-center px-4 py-20">
      <div className="mx-auto w-full max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-muted)]">
          404 · Not Found
        </p>
        <h1 className="mt-3 font-display-serif text-[clamp(40px,6vw,72px)] font-normal leading-[1.02] tracking-[-0.03em] text-[var(--wb-fg)]">
          This page doesn’t exist.
        </h1>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
          The docs moved, the URL was mistyped, or you’re chasing a link from
          an archived page. Try one of these popular destinations:
        </p>

        <ul className="mt-8 grid gap-2 sm:grid-cols-2">
          { popular.map((d) => (
            <li key={ d.slug }>
              <Link
                href={ `/en/docs/${ d.slug }` }
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
            href="/"
            className="cta-link cta-link-primary bg-[var(--wb-fg)] px-5 py-3 text-[var(--wb-bg)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Take me home</span>
          </Link>
          <Link
            href="/en/docs"
            className="cta-link border border-[var(--wb-border-strong)] px-5 py-3 text-[var(--wb-fg)]"
          >
            <span>Browse all docs</span>
          </Link>
          <a
            href="https://github.com/louloulin/OpenBuddy/issues"
            target="_blank"
            rel="noreferrer"
            className="cta-link px-2 py-3 text-[var(--wb-fg-muted)]"
          >
            <span>Report broken link</span>
            <span className="cta-link-arrow">↗</span>
          </a>
        </div>
      </div>
    </main>
  );
}
