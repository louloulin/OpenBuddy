import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

/**
 * OpenBuddy Website —— Tailwind preset。
 *
 * 设计策略：复用根仓库 `src/styles/tokens.css` 中的 --wb-* 令牌，
 * 将其映射到 Tailwind 的 color/spacing/radius，便于在 Tailwind 类中直接使用。
 * 任何对令牌值本身的修改请先修改 src/styles/tokens.css 再同步此处。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,md,mdx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Brand palette (--wb-palette-*)
        brand: {
          1: '#DFF7F2',
          2: '#BFF0E6',
          3: '#9FE8D9',
          4: '#80E1CD',
          5: '#60D9C0',
          7: '#40D1B3',
          8: '#00C29A',
          9: '#009273',
          10: '#00614D'
        },
        // Accent (品牌强调色，复用 --wb-accent #5B6CFF 用于强调链接/CTA)
        accent: {
          DEFAULT: '#5B6CFF',
          hover: '#4858E0',
          active: '#3547C2'
        },
        // Surface tokens (light)
        surface: {
          bg: '#FFFFFF',
          'bg-soft': '#FAFAFA',
          'bg-soft-2': '#F2F2F2',
          border: '#E6E6E6',
          'border-strong': '#D0D7DE',
          text: '#1F2328',
          'text-muted': '#656D76',
          'text-faint': '#8B949E'
        },
        // Status
        success: '#1F883D',
        warning: '#9A6700',
        error: '#CF222E'
      },
      fontFamily: {
        // Inter 作为正文，SF Pro / Segoe UI 系统回退
        sans: ['var(--font-inter)', 'SF Pro Text', 'Segoe UI', 'system-ui', 'sans-serif'],
        // Cal Sans Display (替代品) + Inter 用于 Hero 大字标题
        display: ['var(--font-cal)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
        // 等宽字体 —— 代码与终端元素
        mono: ['var(--font-jetbrains)', 'SF Mono', 'JetBrains Mono', 'Cascadia Code', 'monospace']
      },
      fontSize: {
        // 编辑器级字号阶梯 (1.25 黄金比例)
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
        }
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'cursor-blink': 'cursor-blink 1.1s steps(1) infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'gradient-pan': 'gradient-pan 8s ease infinite'
      }
    }
  },
  plugins: [typography]
};

export default config;