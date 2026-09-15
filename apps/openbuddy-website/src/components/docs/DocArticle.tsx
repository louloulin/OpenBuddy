import Link from 'next/link';
import { getAdjacentDocs } from '@/lib/docs-meta';
import type { DocContent } from '@/lib/docs-server';
import type { Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface DocArticleProps {
  content: DocContent;
  locale: Locale;
}

const COPY = {
  en: {
    onThisPage: 'On this page',
    editOnGitHub: 'Edit on GitHub',
    viewRaw: 'View raw markdown',
    previous: 'Previous',
    next: 'Next',
    lastUpdated: 'Source file',
    notFound: 'Document not found'
  },
  'zh-CN': {
    onThisPage: '本页目录',
    editOnGitHub: '在 GitHub 编辑',
    viewRaw: '查看原始 Markdown',
    previous: '上一篇',
    next: '下一篇',
    lastUpdated: '源文件',
    notFound: '未找到文档'
  }
} as const;

/**
 * DocArticle —— 渲染单篇文档:左主内容 + 右 TOC + 底部分页。
 */
export default function DocArticle({ content, locale }: DocArticleProps) {
  const copy = COPY[locale];
  const { meta, html, toc, githubEditUrl, sourceFile } = content;
  const { prev, next } = getAdjacentDocs(meta.slug);

  return (
    <article className="grid gap-12 lg:grid-cols-[1fr_220px]">
      {/* Main content */}
      <div>
        <header className="mb-8 border-b border-[var(--wb-border)] pb-6">
          <h1 className="font-display-serif text-[40px] leading-[1.05] tracking-[-0.02em] text-[var(--wb-fg)] md:text-[48px]">
            { meta.title }
          </h1>
          { meta.description ? (
            <p className="mt-4 text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
              { meta.description }
            </p>
          ) : null }
          <p className="mt-4 font-mono text-[11px] text-[var(--wb-fg-faint)]">
            { copy.lastUpdated }: <code>{ sourceFile }</code>
          </p>
        </header>

        <div
          className="md-prose"
          dangerouslySetInnerHTML={ { __html: html } }
        />

        {/* Prev / next */}
        <nav className="mt-16 grid gap-4 border-t border-[var(--wb-border)] pt-8 sm:grid-cols-2">
          { prev ? (
            <Link
              href={ localizedPath(`/docs/${ prev.slug }`, locale) }
              className="wb-card group flex flex-col gap-1"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                ← { copy.previous }
              </span>
              <span className="font-display-serif text-[16px] text-[var(--wb-fg)]">
                { prev.title }
              </span>
            </Link>
          ) : (
            <span />
          ) }
          { next ? (
            <Link
              href={ localizedPath(`/docs/${ next.slug }`, locale) }
              className="wb-card group flex flex-col gap-1 text-right"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--wb-fg-faint)]">
                { copy.next } →
              </span>
              <span className="font-display-serif text-[16px] text-[var(--wb-fg)]">
                { next.title }
              </span>
            </Link>
          ) : (
            <span />
          ) }
        </nav>
      </div>

      {/* Right rail — TOC + edit link */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          { toc.length > 0 ? (
            <>
              <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                { copy.onThisPage }
              </h3>
              <ul className="space-y-1.5 border-l border-[var(--wb-border)]">
                { toc.map((item) => (
                  <li
                    key={ `${ item.id }-${ item.text }` }
                    style={ { paddingLeft: `${ (item.level - 1) * 12 + 12 }px` } }
                  >
                    <a
                      href={ `#${ item.id }` }
                      className="block text-[12.5px] leading-snug text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
                    >
                      { item.text }
                    </a>
                  </li>
                )) }
              </ul>
            </>
          ) : null }

          <div className="mt-8 flex flex-col gap-2 border-t border-[var(--wb-border)] pt-6 text-[12px]">
            <a
              href={ githubEditUrl }
              target="_blank"
              rel="noreferrer"
              className="text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
            >
              { copy.editOnGitHub } ↗
            </a>
            <a
              href={ `https://github.com/louloulin/OpenBuddy/blob/main/docs/${ sourceFile }` }
              target="_blank"
              rel="noreferrer"
              className="text-[var(--wb-fg-faint)] hover:text-[var(--wb-fg-muted)]"
            >
              { copy.viewRaw } ↗
            </a>
          </div>
        </div>
      </aside>
    </article>
  );
}