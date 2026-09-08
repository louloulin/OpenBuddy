'use client';

import { useTheme } from '@/components/ThemeProvider';
import { Sun, Moon } from 'lucide-react';

/**
 * ThemeSwitcher —— 明暗主题切换按钮
 *
 * 关键: 不硬编码 text/border 颜色, 让父级 (header) 通过 text 继承
 * 这样在 dark hero 上 (header text-white) 按钮也变白
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-current/20 transition-colors hover:bg-current/10"
      style={ { color: 'inherit' } }
    >
      { isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" /> }
    </button>
  );
}
