import Link from 'next/link';
import Logo from '@/components/icons/Logo';
import CopyButton from '@/components/CopyButton';
import { localizedPath, type Locale } from '@/lib/i18n';

interface InstallBlockProps {
  locale: Locale;
  dict: {
    installLabel: string;
    installHint: string;
    platform: 'macOS' | 'Windows' | 'Linux';
    installCommand: string;
    brewTab: string;
    curlTab: string;
    noteLabel: string;
    note: string;
  };
}

/**
 * InstallBlock —— Hero 内的"立即安装"块。3 个 tab 切换不同平台命令,
 * 命令区带"复制"按钮,底部一行小字提示最小依赖。
 */
export default function InstallBlock({ locale, dict }: InstallBlockProps) {
  const platform = dict.platform;
  return (
    <div className="wb-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--wb-border)] px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--wb-fg-faint)]">
          <Logo size={ 12 } showWordmark={ false } />
          <span>{ dict.installLabel }</span>
        </div>
        <span className="rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--wb-fg-muted)]">
          { platform }
        </span>
      </div>

      {/* Decorative only — there is one install command, so these are labels,
          not a widget. Announcing them as a tablist promised screen-reader
          users two selectable tabs that do nothing. */}
      <div className="flex border-b border-[var(--wb-border)] bg-[var(--wb-bg-soft)]">
        <span className="flex-1 border-b-2 border-[var(--wb-brand)] px-4 py-2 font-mono text-[12px] font-medium text-[var(--wb-fg)]">
          { dict.brewTab }
        </span>
        <span className="flex-1 border-b-2 border-transparent px-4 py-2 font-mono text-[12px] text-[var(--wb-fg-faint)]">
          { dict.curlTab }
        </span>
      </div>

      <div className="relative bg-[var(--wb-code-bg)] px-4 py-3.5 font-mono text-[12.5px] text-[var(--wb-code-fg)]">
        <code className="block overflow-x-auto whitespace-pre">
          <span className="select-none text-[var(--wb-fg-faint)]">$ </span>
          { dict.installCommand }
        </code>
        <div className="absolute right-2 top-2">
          <CopyButton text={ dict.installCommand } />
        </div>
      </div>

      <div className="flex items-start gap-2 border-t border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-4 py-2 text-[11.5px] text-[var(--wb-fg-faint)]">
        <span className="font-mono uppercase tracking-[0.12em] text-[var(--wb-fg-muted)]">
          { dict.noteLabel }
        </span>
        <span>{ dict.note }</span>
      </div>

      <div className="px-4 py-2.5 text-[11px]">
        <Link
          href={ localizedPath('/docs/getting-started', locale) }
          className="font-mono text-[var(--wb-fg-muted)] underline-offset-4 hover:text-[var(--wb-fg)] hover:underline"
        >
          { dict.installHint }
        </Link>
      </div>
    </div>
  );
}
