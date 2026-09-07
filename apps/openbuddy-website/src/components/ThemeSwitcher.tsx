'use client';

import { useTheme } from '@/components/ThemeProvider';
import { Sun, Moon } from 'lucide-react';

/**
 * ThemeSwitcher —— 明暗主题切换按钮
 *
 * 显示当前主题对应图标；hover 时 hover 提示，aria-label 描述操作。
 */
export default function ThemeSwitcher() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={ toggleTheme }
      aria-label={ isDark ? 'Switch to light theme' : 'Switch to dark theme' }
      title={ isDark ? 'Switch to light theme' : 'Switch to dark theme' }
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--wb-border)] text-[var(--wb-fg-muted)] transition-colors hover:bg-[var(--wb-bg-soft-2)] hover:text-[var(--wb-fg)]"
    >
      { isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" /> }
    </button>
  );
}