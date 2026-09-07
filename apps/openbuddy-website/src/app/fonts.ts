/**
 * 本地字体定义 —— 避免构建时下载 Google Fonts。
 *
 * 实际上我们不通过 next/font 加载 Google Fonts（构建环境可能没有外网）。
 * 而是通过 CSS @font-face + 系统回退栈实现：
 *
 * - Inter        -> 系统 UI 字体优先（macOS SF Pro, Linux Cantarell）
 * - JetBrains Mono -> 系统等宽字体优先（SF Mono, Cascadia Code）
 *
 * 设计上保持与原 BRAND.md 的字体推荐一致。
 */

export const fontVariables = 'antialiased';

/**
 * 字体 CSS 变量名，由 globals.css 中的 fallback 字体栈消费：
 *
 *   --font-inter: 'Inter', 'SF Pro Text', 'Segoe UI', system-ui, sans-serif
 *   --font-jetbrains: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace
 */
export const fontFamilies = {
  inter: 'var(--font-inter)',
  jetbrains: 'var(--font-jetbrains)',
  display: 'var(--font-display)'
} as const;