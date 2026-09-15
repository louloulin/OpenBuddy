'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORY_LABELS, type DocCategory, type DocMeta, getDocsByCategory } from '@/lib/docs-meta';
import type { Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface DocsSidebarProps {
  locale: Locale;
  activeSlug?: string;
}

const CATEGORY_ORDER: DocCategory[] = ['core', 'plugin', 'operations', 'reference', 'meta', 'spec'];

/**
 * DocsSidebar —— 按 category 分组的左侧导航,跟随 locale 显示中英文标签。
 * 在 /[locale]/docs 和 /[locale]/docs/[slug] 都使用。
 */
export default function DocsSidebar({ locale, activeSlug }: DocsSidebarProps) {
  const pathname = usePathname();
  const grouped = getDocsByCategory();

  return (
    <nav aria-label="Documentation" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-4">
      <ul className="space-y-7">
        { CATEGORY_ORDER.map((cat) => {
          const docs = grouped[cat];
          if (docs.length === 0) return null;
          return (
            <li key={ cat }>
              <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
                { CATEGORY_LABELS[cat][locale === 'zh-CN' ? 'zh' : 'en'] }
              </h3>
              <ul className="space-y-0.5">
                { docs.map((doc) => (
                  <DocLink
                    key={ doc.slug }
                    doc={ doc }
                    href={ localizedPath(`/docs/${ doc.slug }`, locale) }
                    isActive={ activeSlug === doc.slug || pathname?.endsWith(`/${ doc.slug }`) }
                  />
                )) }
              </ul>
            </li>
          );
        }) }
      </ul>
    </nav>
  );
}

function DocLink({ doc, href, isActive }: { doc: DocMeta; href: string; isActive: boolean }) {
  return (
    <li>
      <Link
        href={ href }
        className={ `block rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors ${
          isActive
            ? 'bg-[var(--wb-bg-soft)] font-medium text-[var(--wb-fg)]'
            : 'text-[var(--wb-fg-muted)] hover:bg-[var(--wb-bg-soft)]/60 hover:text-[var(--wb-fg)]'
        }` }
      >
        { doc.title }
      </Link>
    </li>
  );
}