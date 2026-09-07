'use client';

import { useState, useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Open search (coming soon)' },
  { keys: ['G', 'H'], desc: 'Go home' },
  { keys: ['G', 'D'], desc: 'Go to download' },
  { keys: ['G', 'C'], desc: 'Go to changelog' },
  { keys: ['G', 'R'], desc: 'Go to roadmap' },
  { keys: ['G', 'P'], desc: 'Go to pricing' },
  { keys: ['?'], desc: 'Show this help' },
  { keys: ['Esc'], desc: 'Close dialogs' }
];

/**
 * KeyboardShortcuts —— 全局键盘快捷键 + 帮助面板
 *
 * 触发:
 * - ? 键 (Shift+/) → 显示快捷键面板
 * - G + H/D/C/R/P → 跳转对应页面
 * - Esc → 关闭面板
 */
export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

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
          window.location.href = target;
        }
        lastKey = '';
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--wb-mask)] p-4 backdrop-blur-sm"
      onClick={ () => setOpen(false) }
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 shadow-wb-card-hover"
        onClick={ (e) => e.stopPropagation() }
      >
        <div className="flex items-center justify-between border-b border-[var(--wb-border)] pb-4">
          <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-[var(--wb-fg)]">
            <Keyboard className="h-4 w-4" />
            <span>Keyboard shortcuts</span>
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
              <span className="text-[var(--wb-fg-muted)]">{ s.desc }</span>
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
          Press <kbd className="wb-kbd">?</kbd> anytime to toggle this panel.
        </p>
      </div>
    </div>
  );
}