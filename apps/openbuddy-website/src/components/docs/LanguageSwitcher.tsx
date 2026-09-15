import Link from 'next/link';
import type { DocContent, DocLocaleStatus } from '@/lib/docs-server';
import type { Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface LanguageSwitcherProps {
  current: DocContent;
  currentLocale: Locale;
  slug: string;
  label: string;
  /** If true, the current page is rendered in fallback mode (no native file) */
  isFallback: boolean;
  missingLabel: string;
  missingHint: string;
  switchToLabelPrefix: string;
}

const LOCALE_DISPLAY: Record<Locale, { native: string; english: string }> = {
  en: { native: 'English', english: 'English' },
  'zh-CN': { native: '简体中文', english: 'Chinese' }
};

/**
 * LanguageSwitcher —— 服务端组件。在 doc 顶部以 pill 形式展示当前语言
 * + 提供切换到另一种语言的链接(若该 doc 有另一种语言版本)。
 *
 * 没有 alternate locale 时,显示一个 "English only / 仅英文" 的标记。
 */
export default function LanguageSwitcher({
  current,
  currentLocale,
  slug,
  label,
  isFallback,
  missingLabel,
  missingHint,
  switchToLabelPrefix
}: LanguageSwitcherProps) {
  const preferredNative = LOCALE_DISPLAY[currentLocale].native;
  const otherLoc: Locale = currentLocale === 'zh-CN' ? 'en' : 'zh-CN';
  // When the content fell back to the other locale, show that as the actually-rendered
  // language so users aren't misled.
  const actualLocale: Locale = isFallback ? otherLoc : currentLocale;
  const actualNative = LOCALE_DISPLAY[actualLocale].native;
  const otherStatus: DocLocaleStatus | undefined = current.available.find(
    (a) => a.locale === otherLoc && a.isNative
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
        { label }
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2.5 py-1 font-mono text-[11.5px] font-medium text-[var(--wb-fg)]"
        title={
          isFallback
            ? `${actualNative} (content) · ${preferredNative} (URL)`
            : undefined
        }
      >
        <span className="size-1.5 rounded-full bg-[var(--wb-brand)]" />
        { actualNative }
        { isFallback ? (
          <span className="text-[var(--wb-fg-faint)]" title={ missingHint }>
            · { missingLabel }
          </span>
        ) : null }
      </span>
      { otherStatus && !isFallback ? (
        // Show the alternate-locale link only when the user is currently on their
        // preferred locale; on fallback the link would just be a duplicate English URL.
        <Link
          href={ localizedPath(`/docs/${slug}`, otherLoc) }
          aria-label={ `${switchToLabelPrefix} ${LOCALE_DISPLAY[otherLoc].native}` }
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--wb-border)] bg-transparent px-2.5 py-1 font-mono text-[11.5px] text-[var(--wb-fg-muted)] transition-colors hover:border-[var(--wb-brand)] hover:text-[var(--wb-fg)]"
        >
          <span className="size-1.5 rounded-full bg-[var(--wb-fg-faint)]" />
          { LOCALE_DISPLAY[otherLoc].native }
          <span className="text-[var(--wb-fg-faint)]">↗</span>
        </Link>
      ) : null }
    </div>
  );
}
