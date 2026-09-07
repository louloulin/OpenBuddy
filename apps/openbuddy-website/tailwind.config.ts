import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

/**
 * OpenBuddy Website —— Tailwind preset。
 *
 * 设计策略：复用根仓库 `src/styles/tokens.css` 中的 --wb-* 令牌，
 * 将其映射到 Tailwind 的 color/spacing/radius，便于在 Tailwind 类中直接使用。
 *
 * 颜色使用 CSS function 形式 `var(--wb-*)` —— 这样 dark mode 切换时
 * 所有颜色自动跟随 theme 变化，无需 `dark:` 前缀。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,md,mdx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 全部通过 CSS variable，让 dark 模式自动适配
        brand: {
          1: 'var(--wb-brand-soft)',
          2: 'var(--wb-brand-soft-2)',
          3: 'var(--wb-brand)',
          4: 'var(--wb-brand)',
          5: 'var(--wb-brand)',
          7: 'var(--wb-brand)',
          8: 'var(--wb-brand)',
          9: 'var(--wb-brand)',
          10: 'var(--wb-brand-deep)',
          DEFAULT: 'var(--wb-brand)',
          deep: 'var(--wb-brand-deep)'
        },
        accent: {
          DEFAULT: 'var(--wb-accent)',
          hover: 'var(--wb-accent-hover)'
        },
        // 语义化 surface tokens
        surface: {
          bg: 'var(--wb-bg)',
          'bg-soft': 'var(--wb-bg-soft)',
          'bg-soft-2': 'var(--wb-bg-soft-2)',
          'bg-tertiary': 'var(--wb-bg-tertiary)',
          border: 'var(--wb-border)',
          'border-soft': 'var(--wb-border-soft)',
          'border-strong': 'var(--wb-border-strong)',
          text: 'var(--wb-fg)',
          'text-muted': 'var(--wb-fg-muted)',
          'text-faint': 'var(--wb-fg-faint)'
        },
        // 状态
        success: 'var(--wb-success)',
        warning: 'var(--wb-warning)',
        error: 'var(--wb-error)',
        // 红色 (用于 ✗ cell) - 通过 opacity 在两套主题下都可见
        red: {
          1: 'rgba(220, 50, 70, 0.10)',
          3: 'rgba(220, 50, 70, 0.20)',
          7: '#dc143c',
          9: '#dc143c',
          10: '#dc143c'
        },
        // 琥珀色
        amber: {
          1: 'rgba(245, 158, 11, 0.10)',
          2: 'rgba(245, 158, 11, 0.12)',
          3: 'rgba(245, 158, 11, 0.20)',
          9: '#f59e0b',
          10: '#f59e0b'
        },
        // 天蓝
        sky: {
          1: 'rgba(14, 165, 233, 0.10)',
          2: 'rgba(14, 165, 233, 0.12)',
          3: 'rgba(14, 165, 233, 0.20)',
          9: '#0ea5e9',
          10: '#0ea5e9'
        },
        // 玫红
        rose: {
          1: 'rgba(244, 63, 94, 0.10)',
          2: 'rgba(244, 63, 94, 0.12)',
          3: 'rgba(244, 63, 94, 0.20)',
          9: '#f43f5e',
          10: '#f43f5e'
        }
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace']
      },
      fontSize: {
        'display-xl': ['clamp(3.5rem, 7vw, 5.5rem)', { lineHeight: '0.95', letterSpacing: '-0.04em', fontWeight: '600' }],
        'display-lg': ['clamp(2.5rem, 5vw, 4rem)', { lineHeight: '1.0', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-md': ['clamp(2rem, 3.5vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }]
      },
      borderRadius: {
        'wb-sm': '4px',
        'wb-md': '8px',
        'wb-lg': '12px',
        'wb-xl': '16px'
      },
      boxShadow: {
        'wb-card': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        'wb-card-hover': '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.06)',
        'wb-glow-brand': '0 0 0 1px rgba(0, 194, 154, 0.15), 0 8px 24px -8px rgba(0, 194, 154, 0.45)'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'cursor-blink': {
          '0%, 50%': { opacity: '1' },
          '50.01%, 100%': { opacity: '0' }
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' }
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'cursor-blink': 'cursor-blink 1.1s steps(1) infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'gradient-pan': 'gradient-pan 8s ease infinite',
        'spin-slow': 'spin-slow 12s linear infinite'
      }
    }
  },
  plugins: [typography]
};

export default config;