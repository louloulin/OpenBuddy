'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CATEGORY_LABELS, type DocCategory, type DocMeta, getDocsByCategory } from '@/lib/docs-meta';
import type { Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';

interface DocsSidebarProps {
  locale: Locale;
  activeSlug?: string;
  /** 'rail' = sticky desktop column; 'inline' = flows inside the mobile panel */
  variant?: 'rail' | 'inline';
  /** Called when a doc link is activated — lets a mobile panel close itself */
  onNavigate?: () => void;
}

const CATEGORY_ORDER: DocCategory[] = ['core', 'plugin', 'operations', 'reference', 'meta', 'spec'];

const COLLAPSE_KEY = 'openbuddy-docs-sidebar';

/**
 * DocsSidebar —— 按 category 分组的左侧导航,跟随 locale 显示中英文标签。
 * 在 /[locale]/docs 和 /[locale]/docs/[slug] 都使用。
 *
 * 折叠状态:每个 group 默认展开;展开/折叠状态写 localStorage 持久化。
 * 当前 group 命中 activeSlug 时强制展开。
 */
export default function DocsSidebar({
  locale,
  activeSlug,
  variant = 'rail',
  onNavigate
}: DocsSidebarProps) {
  const pathname = usePathname();
  const grouped = getDocsByCategory();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  function toggle(cat: string) {
    const next = new Set(collapsed);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  return (
    <nav
      aria-label="Documentation"
      className={
        variant === 'rail'
          ? 'sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-4'
          : ''
      }
    >
      <ul className="space-y-7">
        { CATEGORY_ORDER.map((cat) => {
          const docs = grouped[cat];
          if (docs.length === 0) return null;
          const hasActive = docs.some((d) => d.slug === activeSlug);
          const isCollapsed = hydrated && collapsed.has(cat) && !hasActive;
          return (
            <li key={ cat }>
              <button
                type="button"
                aria-expanded={ !isCollapsed }
                onClick={ () => toggle(cat) }
                className="mb-2 flex w-full items-center justify-between gap-2 text-left font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--wb-fg-faint)] hover:text-[var(--wb-fg-muted)]"
              >
                <span>{ CATEGORY_LABELS[cat][locale === 'zh-CN' ? 'zh' : 'en'] }</span>
                <span
                  aria-hidden
                  className={ `font-mono text-[10px] transition-transform ${ isCollapsed ? '-rotate-90' : '' }` }
                >
                  ▾
                </span>
              </button>
              { !isCollapsed ? (
                <ul className="space-y-0.5">
                  { docs.map((doc) => (
                    <DocLink
                      key={ doc.slug }
                      doc={ doc }
                      href={ localizedPath(`/docs/${ doc.slug }`, locale) }
                      isActive={ activeSlug === doc.slug || pathname?.endsWith(`/${ doc.slug }`) }
                      onNavigate={ onNavigate }
                    />
                  )) }
                </ul>
              ) : null }
            </li>
          );
        }) }
      </ul>
    </nav>
  );
}

function DocLink({
  doc,
  href,
  isActive,
  onNavigate
}: {
  doc: DocMeta;
  href: string;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        href={ href }
        onClick={ onNavigate }
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
