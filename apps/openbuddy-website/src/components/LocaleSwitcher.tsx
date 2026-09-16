'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { locales, localeNames, localeFlags, type Locale } from '@/lib/i18n';

/**
 * LocaleSwitcher —— 中英双语切换下拉菜单
 *
 * 功能：
 * - 点击展开下拉，显示所有可用语言
 * - 当前语言前显示 ✓
 * - 切换时保持当前路由（含 hash 锚点）
 * - 键盘可访问 (Esc 关闭、Enter 选择)
 * - 点击外部自动关闭
 */
export default function LocaleSwitcher() {
  const params = useParams();
  const [open, setOpenState] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 当前 locale: 从路由 /zh-CN/... 推断
  const currentLocale: Locale = (params?.locale as Locale) ?? 'en';

  // 关闭弹窗：点击外部 / Esc 键
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenState(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenState(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /**
   * 构建切换后的目标路径。
   * 保持 hash 锚点 (#features 等);所有路径都带 locale 前缀,
   * 因为路由结构是 `[locale]/...`(默认语言同样需要前缀)。
   */
  function buildTargetHref(target: Locale): string {
    if (typeof window === 'undefined') return `/${target}`;
    const { pathname: path, hash } = window.location;
    // 去掉已有的 locale 前缀(若有)
    const stripped = path.replace(new RegExp(`^/(${locales.join('|')})(?=/|$)`), '') || '/';
    const targetPath = stripped === '/' ? `/${target}` : `/${target}${stripped}`;
    return `${targetPath}${hash || ''}`;
  }

  return (
    <div ref={ containerRef } className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={ open }
        aria-label="Select language"
        onClick={ () => setOpenState(!open) }
        style={ { color: 'inherit' } }
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors hover:bg-current/10"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="font-mono text-[11px] uppercase">{ localeFlags[currentLocale] }</span>
        <ChevronDown className={ `h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}` } />
      </button>

      { open ? (
        <div
          role="listbox"
          aria-label="Language"
          className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg)] shadow-wb-card-hover"
        >
          { locales.map((l) => {
            const isCurrent = l === currentLocale;
            return (
              <Link
                key={ l }
                href={ buildTargetHref(l) }
                role="option"
                aria-selected={ isCurrent }
                onClick={ () => setOpenState(false) }
                className={ `flex items-center justify-between px-3 py-2 text-[13px] transition-colors ${
                  isCurrent
                    ? 'bg-brand-1 text-brand-10 dark:text-brand-8'
                    : 'text-[var(--wb-fg)] hover:bg-[var(--wb-bg-soft-2)]'
                }` }
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    { localeFlags[l] }
                  </span>
                  <span>{ localeNames[l] }</span>
                </span>
                { isCurrent ? <Check className="h-3.5 w-3.5 text-brand-10 dark:text-brand-8" /> : null }
              </Link>
            );
          }) }
        </div>
      ) : null }
    </div>
  );
}