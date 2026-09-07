import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

/**
 * OpenBuddy Website —— Tailwind preset (tutti 严格对标版)
 *
 * 关键变化:
 * - 字体: Source Serif 4 (display) + Inter (UI) + JetBrains Mono (code)
 * - 字号: 更大、更紧的 letter-spacing
 * - 颜色: 全 CSS variable, dark mode 自动适配
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
          'bg-pure': 'var(--wb-bg-pure)',
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
        // tutti 严格对标的字号阶梯
        // H1: 51px tutti, 我们提到 56-72px (Hero)
        // H2: 39px tutti
        // 正文: 25.8px tutti (大正文, 18px 普通正文)
        'display-2xl': ['clamp(3.25rem, 6.5vw, 4.75rem)', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '500' }],
        'display-xl': ['clamp(2.75rem, 5vw, 3.75rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-lg': ['clamp(2rem, 3.5vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '500' }],
        'display-md': ['clamp(1.5rem, 2.5vw, 2rem)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-sm': ['clamp(1.25rem, 1.75vw, 1.5rem)', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '500' }],
        // 正文层级 (tutti 25.8px = text-lg-xl)
        'body-lg': ['1.125rem', { lineHeight: '1.6', letterSpacing: '-0.005em' }],     // 18px
        'body-xl': ['1.375rem', { lineHeight: '1.55', letterSpacing: '-0.01em' }],      // 22px (tutti 副标)
        'body-2xl': ['1.625rem', { lineHeight: '1.5', letterSpacing: '-0.015em' }]      // 26px (tutti 副标最大值)
      },
      borderRadius: {
        'wb-sm': '6px',
        'wb-md': '10px',
        'wb-lg': '14px',
        'wb-xl': '20px'
      },
      boxShadow: {
        'wb-card': 'none',
        'wb-card-hover': 'none',
        'wb-glow-brand': 'none'
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
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
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        'cursor-blink': 'cursor-blink 1.1s steps(1) infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'gradient-pan': 'gradient-pan 8s ease infinite',
        'spin-slow': 'spin-slow 12s linear infinite',
        'fade-in': 'fade-in 0.4s ease-out both'
      }
    }
  },
  plugins: [typography]
};

export default config;
