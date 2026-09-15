import Link from 'next/link';
import { getAdjacentDocs } from '@/lib/docs-meta';
import type { DocContent } from '@/lib/docs-server';
import type { Locale } from '@/lib/i18n';
import { getDictionary, localizedPath } from '@/lib/i18n';
import LanguageSwitcher from './LanguageSwitcher';
import MDCodeEnhancer from './MDCodeEnhancer';
import MermaidEnhancer from './MermaidEnhancer';
import DocsAsideContent from './DocsAsideContent';

interface DocArticleProps {
  content: DocContent;
  locale: Locale;
}

/**
 * DocArticle —— 渲染单篇文档:左主内容 + 右 TOC + 底部分页。
 * 顶部含语言切换、阅读时长、最近更新,所有元数据来自 docs-server.ts。
 */
export default function DocArticle({ content, locale }: DocArticleProps) {
  const dict = getDictionary(locale);
  const copy = dict.docsPage;
  const { meta, html, toc, githubEditUrl, sourceFile, lastUpdated, readingMinutes, isNative } = content;
  const { prev, next } = getAdjacentDocs(meta.slug);
  const rawUrl = `https://github.com/louloulin/OpenBuddy/blob/main/docs/${ sourceFile }`;

  return (
    <article className="grid gap-12 lg:grid-cols-[1fr_220px]">
      <MDCodeEnhancer />
      <MermaidEnhancer />
      {/* min-w-0: grid 子项默认 min-width:auto,会被宽代码块撑到 min-content 宽度,
          整个页面随之横向滚动。 */}
      <div className="min-w-0">
        <header className="mb-8 border-b border-[var(--wb-border)] pb-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px]">
            <LanguageSwitcher
              current={ content }
              currentLocale={ locale }
              slug={ meta.slug }
              label={ copy.langSwitchLabel }
              isFallback={ !isNative }
              missingLabel={ copy.translationMissing }
              missingHint={ copy.translationMissingHint }
              switchToLabelPrefix={ copy.langSwitchToPrefix }
            />
          </div>
          <h1 className="font-display-serif text-[clamp(32px,4.5vw,52px)] font-normal leading-[1.05] tracking-[-0.025em] text-[var(--wb-fg)]">
            { meta.title }
          </h1>
          { meta.description ? (
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
              { meta.description }
            </p>
          ) : null }
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--wb-fg-faint)]">
            <span>
              { copy.sourceFile }: <code className="text-[var(--wb-fg-muted)]">{ sourceFile }</code>
            </span>
            { readingMinutes > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{ readingMinutes <= 1 && locale === 'en' ? `1 ${copy.readingTimeUnit}` : `${readingMinutes} ${copy.readingTimeUnit}` }</span>
              </>
            ) : null }
            { lastUpdated ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{ copy.lastUpdatedPrefix } { lastUpdated }</span>
              </>
            ) : null }
          </div>
        </header>

        {/* lg 以下右侧栏不存在,把目录 + 源文件链接收进正文顶部的折叠面板 */}
        <details className="group mb-8 rounded-xl border border-[var(--wb-border)] lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-muted)] [&::-webkit-details-marker]:hidden">
            <span>{ copy.onThisPage }</span>
            <span aria-hidden className="text-[10px] transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="border-t border-[var(--wb-border)] px-4 py-4">
            <DocsAsideContent
              toc={ toc }
              onThisPage={ copy.onThisPage }
              editOnGitHub={ copy.editOnGitHub }
              editUrl={ githubEditUrl }
              viewRaw={ copy.viewRaw }
              rawUrl={ rawUrl }
              showTocLabel={ false }
            />
          </div>
        </details>

        <div
          className="md-prose"
          dangerouslySetInnerHTML={ { __html: html } }
        />

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

      <aside className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          <DocsAsideContent
            toc={ toc }
            onThisPage={ copy.onThisPage }
            editOnGitHub={ copy.editOnGitHub }
            editUrl={ githubEditUrl }
            viewRaw={ copy.viewRaw }
            rawUrl={ rawUrl }
          />
        </div>
      </aside>
    </article>
  );
}
