'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Keyboard, X } from 'lucide-react';
import { localizedPath, type Locale } from '@/lib/i18n';

interface Shortcut {
  keys: string[];
  desc: { en: string; zh: string };
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'K'], desc: { en: 'Search documentation', zh: '搜索文档' } },
  { keys: ['G', 'H'], desc: { en: 'Go home', zh: '回到首页' } },
  { keys: ['G', 'D'], desc: { en: 'Go to download', zh: '前往下载' } },
  { keys: ['G', 'C'], desc: { en: 'Go to changelog', zh: '前往更新日志' } },
  { keys: ['G', 'R'], desc: { en: 'Go to roadmap', zh: '前往路线图' } },
  { keys: ['G', 'P'], desc: { en: 'Go to pricing', zh: '前往定价' } },
  { keys: ['?'], desc: { en: 'Show this help', zh: '显示本面板' } },
  { keys: ['Esc'], desc: { en: 'Close dialogs', zh: '关闭弹窗' } }
];

/**
 * KeyboardShortcuts —— 全局键盘快捷键 + 帮助面板
 *
 * 触发:
 * - ⌘K / Ctrl+K → 打开文档搜索(dispatch OPEN_SEARCH_EVENT)
 * - ? 键 (Shift+/) → 显示快捷键面板
 * - G + H/D/C/R/P → 跳转对应页面(跟随当前 locale)
 * - Esc → 关闭面板
 */
export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const locale: Locale = pathname?.startsWith('/zh-CN') ? 'zh-CN' : 'en';

  useEffect(() => {
    let lastKey = '';
    let lastKeyTime = 0;

    const onKey = (e: KeyboardEvent) => {
      // 忽略 input/textarea 中的按键
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }

      // ⌘K 由 SearchDialog 直接监听;这里只在面板打开时同步关闭自己。
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        setOpen(false);
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      // G + X 双键
      if (e.key.toLowerCase() === 'g') {
        lastKey = 'g';
        lastKeyTime = Date.now();
        return;
      }
      if (lastKey === 'g' && Date.now() - lastKeyTime < 1500) {
        const map: Record<string, string> = {
          h: '/',
          d: '/download',
          c: '/changelog',
          r: '/roadmap',
          p: '/pricing'
        };
        const target = map[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          router.push(localizedPath(target, locale));
        }
        lastKey = '';
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locale, router]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--wb-mask)] p-4 backdrop-blur-sm"
      onClick={ () => setOpen(false) }
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 shadow-wb-overlay"
        onClick={ (e) => e.stopPropagation() }
      >
        <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
          <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-[var(--wb-fg)]">
            <Keyboard className="h-4 w-4" />
            <span>{ locale === 'zh-CN' ? '键盘快捷键' : 'Keyboard shortcuts' }</span>
          </h2>
          <button
            type="button"
            onClick={ () => setOpen(false) }
            aria-label="Close"
            className="text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-4 space-y-2.5">
          { SHORTCUTS.map((s, i) => (
            <li key={ i } className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--wb-fg-muted)]">
                { locale === 'zh-CN' ? s.desc.zh : s.desc.en }
              </span>
              <span className="flex items-center gap-1">
                { s.keys.map((k, j) => (
                  <kbd
                    key={ j }
                    className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-1.5 font-mono text-[11px] font-medium text-[var(--wb-fg)]"
                  >
                    { k }
                  </kbd>
                )) }
              </span>
            </li>
          )) }
        </ul>
        <p className="mt-5 border-t border-[var(--wb-border)] pt-3 text-[11px] text-[var(--wb-fg-faint)]">
          { locale === 'zh-CN' ? (
            <>按 <kbd className="wb-kbd">?</kbd> 随时开关本面板。</>
          ) : (
            <>Press <kbd className="wb-kbd">?</kbd> anytime to toggle this panel.</>
          ) }
        </p>
      </div>
    </div>
  );
}
