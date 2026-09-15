'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import DocsSidebar from './DocsSidebar';
import type { Locale } from '@/lib/i18n';

interface DocsMobileNavProps {
  locale: Locale;
  label: string;
}

/**
 * DocsMobileNav —— lg 以下的文档导航入口。
 *
 * 左侧 sidebar 在 lg 以下设为 hidden,手机用户因此完全无法在文档间跳转。
 * 这里把同一个 DocsSidebar 收进一个折叠面板,点链接后自动收起。
 * DocsSidebar 自己用 usePathname 判断 active,所以不需要再传 activeSlug。
 */
export default function DocsMobileNav({ locale, label }: DocsMobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-8 lg:hidden">
      <button
        type="button"
        aria-expanded={ open }
        aria-controls="docs-mobile-nav"
        onClick={ () => setOpen((o) => !o) }
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-soft)]/40 px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
      >
        <span>{ label }</span>
        <ChevronDown
          aria-hidden
          className={ `h-4 w-4 transition-transform ${ open ? 'rotate-180' : '' }` }
        />
      </button>

      { open ? (
        <div
          id="docs-mobile-nav"
          className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--wb-border)] p-4"
        >
          <DocsSidebar
            locale={ locale }
            variant="inline"
            onNavigate={ () => setOpen(false) }
          />
        </div>
      ) : null }
    </div>
  );
}
