'use client';

import { Search } from 'lucide-react';
import { OPEN_SEARCH_EVENT } from '@/components/search/SearchDialog';

interface SearchButtonProps {
  label: string;
  /** Shortcut hint rendered inside the pill, e.g. "⌘K" */
  shortcut: string;
}

/**
 * SearchButton —— header 里的搜索入口。点击后 dispatch 全局事件,
 * 由 layout 里挂载的 SearchDialog 接管(避免把弹窗状态提到 header)。
 *
 * md 以下退化成纯图标:手机没有键盘,⌘K 提示无意义,而搜索本身必须可达
 * ——之前整颗按钮都是 hidden md:inline-flex,移动端完全进不去搜索。
 */
export default function SearchButton({ label, shortcut }: SearchButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
      aria-label={label}
      className="inline-flex items-center gap-2 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] p-2 text-[12.5px] text-[var(--wb-fg-muted)] transition-colors hover:border-[var(--wb-border-strong)] hover:text-[var(--wb-fg)] md:px-2.5 md:py-1.5"
    >
      <Search className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden />
      <span className="hidden md:inline">{label}</span>
      <kbd className="hidden rounded border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-1 font-mono text-[10px] text-[var(--wb-fg-faint)] md:inline-block">
        {shortcut}
      </kbd>
    </button>
  );
}
