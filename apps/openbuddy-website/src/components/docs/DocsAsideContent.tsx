import type { DocTocItem } from '@/lib/docs-server';
import TocScrollSpy from './TocScrollSpy';

interface DocsAsideContentProps {
  toc: DocTocItem[];
  onThisPage: string;
  editOnGitHub: string;
  editUrl: string;
  viewRaw: string;
  rawUrl: string;
  /** Set false when the caller renders the TOC label itself (mobile <summary>) */
  showTocLabel?: boolean;
}

/**
 * DocsAsideContent —— 文档右侧栏的内容(本页目录 + 源文件链接)。
 *
 * 抽出来是因为它现在渲染两次:lg 以上是 sticky 右侧栏,lg 以下是正文顶部的
 * 折叠面板。两处内容完全相同,只有外层容器不同,所以由调用方决定外层。
 */
export default function DocsAsideContent({
  toc,
  onThisPage,
  editOnGitHub,
  editUrl,
  viewRaw,
  rawUrl,
  showTocLabel = true
}: DocsAsideContentProps) {
  const hasToc = toc.length > 0;
  return (
    <>
      { hasToc ? (
        <TocScrollSpy toc={ toc } label={ onThisPage } showLabel={ showTocLabel } />
      ) : null }

      <div
        className={ `flex flex-col gap-2 text-[12px] ${
          hasToc ? 'mt-8 border-t border-[var(--wb-border)] pt-6' : ''
        }` }
      >
        <a
          href={ editUrl }
          target="_blank"
          rel="noreferrer"
          className="text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
        >
          { editOnGitHub } ↗
        </a>
        <a
          href={ rawUrl }
          target="_blank"
          rel="noreferrer"
          className="text-[var(--wb-fg-faint)] hover:text-[var(--wb-fg-muted)]"
        >
          { viewRaw } ↗
        </a>
      </div>
    </>
  );
}
