/**
 * @openbuddy/ui-theme/themes — 17 OKLCh-based theme definitions.
 *
 * Inspired by cabinet's `lib/themes.ts`, tuned so every accent flows
 * through OpenBuddy's brand color #00C29A as a soft secondary signal.
 * Each theme declares its body font, optional heading font, an accent
 * preview color, and a flat record of CSS variable values (using the
 * `--wb-*` token names that the rest of the renderer already reads).
 *
 * Two base blocks (LIGHT_BASE / DARK_BASE) provide the default OKLCh
 * palette; each theme's `vars` is merged on top, then we set the document
 * element's `data-theme="dark|light"` + `data-theme-name="<name>"`
 * attributes. Win95/WinXP deliberately escape OKLCh to keep their retro
 * look; everything else uses perceptual color space.
 */

export type ThemeName =
  | "claude"
  | "openbuddy"
  | "openbuddy-dark"
  | "white"
  | "black"
  | "midnight-ocean"
  | "aurora"
  | "ember"
  | "forest"
  | "cyber"
  | "paper"
  | "sakura"
  | "meadow"
  | "sky"
  | "lavender"
  | "win95"
  | "winxp"
  | "matrix"
  | "apple";

export type ThemeType = "dark" | "light";

export interface ThemeDefinition {
  name: ThemeName;
  label: string;
  type: ThemeType;
  font?: string;
  headingFont?: string;
  /** Preview color for the theme picker swatch. */
  accent: string;
  vars: Record<string, string>;
}

/**
 * 品牌色 `#00C29A` 的 OKLCh 等价表示(精确往返:oklch→sRGB 取整后仍是
 * 0/194/154,见 __tests__/brand-accent.test.ts)。
 *
 * 之前 `--wb-accent` 在主题里被写成 `oklch(0.72 0.135 165)`(= rgb(55,191,143)),
 * 那是一个**被去饱和过的薄荷绿**,并不是品牌色。后果:`src/styles/tokens.css`
 * 里 `--wb-accent: var(--wb-brand-primary)`(=`#00C29A`)被主题的内联值盖掉,
 * 全站强调色(选中描边、激活指示条)从品牌青绿漂成灰绿,ThemePicker 的色板
 * 却仍然显示 `#00C29A` —— 色板和实际不符。这里定义成唯一真源,两边都引用它。
 */
export const BRAND_ACCENT_OKLCH = "oklch(0.7246 0.142 171)";

/**
 * 基础字体栈 —— body 与等宽字体的最终兜底。
 *
 * 抽成常量(而不是只在 LIGHT_BASE/DARK_BASE 里各写一遍)是一处**功能修复**:
 * 主题里的 `font: '"Space Grotesk", var(--wb-font)'` 自引用基础栈,若把这段
 * 字符串原样写回 `--wb-font`,CSS 变量就构成循环引用 → 整条 font-family 失效、
 * 悄悄退回浏览器默认字体。所以这里在**定义时**把 `var(--wb-font)` /
 * `var(--wb-font-mono)` 文本展开(见 resolveThemeFontTokens),运行时没有循环。
 */
export const BASE_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const BASE_MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ─── Base token blocks ───────────────────────────────────────────────
export const LIGHT_BASE: Record<string, string> = {
  "--wb-bg-primary": "oklch(0.995 0 0)",
  "--wb-bg-secondary": "oklch(0.97 0 0)",
  "--wb-bg-tertiary": "oklch(0.94 0 0)",
  "--wb-bg-elevated": "oklch(1 0 0)",
  "--wb-bg-overlay": "oklch(0.16 0 0 / 0.45)",
  "--wb-fg-primary": "oklch(0.18 0 0)",
  "--wb-fg-secondary": "oklch(0.42 0 0)",
  "--wb-fg-tertiary": "oklch(0.6 0 0)",
  "--wb-border": "oklch(0.9 0 0)",
  "--wb-border-soft": "oklch(0.93 0 0)",
  "--wb-accent": BRAND_ACCENT_OKLCH,
  "--wb-accent-soft": "oklch(0.7246 0.142 171 / 0.12)",
  "--wb-accent-fg": "oklch(0.99 0 0)",
  "--wb-danger": "oklch(0.55 0.2 25)",
  "--wb-success": "oklch(0.6 0.15 145)",
  "--wb-warning": "oklch(0.7 0.15 75)",
  "--wb-shadow": "0 4px 12px oklch(0 0 0 / 0.08)",
  "--wb-shadow-md": "0 8px 24px oklch(0 0 0 / 0.12)",
  "--wb-shadow-lg": "0 16px 48px oklch(0 0 0 / 0.18)",
  "--wb-radius-sm": "4px",
  "--wb-radius-md": "6px",
  "--wb-radius-lg": "10px",
  "--wb-radius-xl": "16px",
  "--wb-font": BASE_FONT_STACK,
  "--wb-font-mono": BASE_MONO_STACK,
};

export const DARK_BASE: Record<string, string> = {
  "--wb-bg-primary": "oklch(0.16 0.005 240)",
  "--wb-bg-secondary": "oklch(0.19 0.005 240)",
  "--wb-bg-tertiary": "oklch(0.22 0.005 240)",
  "--wb-bg-elevated": "oklch(0.21 0.005 240)",
  "--wb-bg-overlay": "oklch(0 0 0 / 0.55)",
  "--wb-fg-primary": "oklch(0.95 0 0)",
  "--wb-fg-secondary": "oklch(0.75 0 0)",
  "--wb-fg-tertiary": "oklch(0.55 0 0)",
  "--wb-border": "oklch(0.32 0 0)",
  "--wb-border-soft": "oklch(0.28 0 0)",
  "--wb-accent": BRAND_ACCENT_OKLCH,
  "--wb-accent-soft": "oklch(0.7246 0.142 171 / 0.16)",
  "--wb-accent-fg": "oklch(0.13 0 0)",
  "--wb-danger": "oklch(0.7 0.2 25)",
  "--wb-success": "oklch(0.7 0.16 145)",
  "--wb-warning": "oklch(0.78 0.15 75)",
  "--wb-shadow": "0 4px 12px oklch(0 0 0 / 0.45)",
  "--wb-shadow-md": "0 8px 24px oklch(0 0 0 / 0.5)",
  "--wb-shadow-lg": "0 16px 48px oklch(0 0 0 / 0.55)",
  "--wb-radius-sm": "4px",
  "--wb-radius-md": "6px",
  "--wb-radius-lg": "10px",
  "--wb-radius-xl": "16px",
  "--wb-font": BASE_FONT_STACK,
  "--wb-font-mono": BASE_MONO_STACK,
};

// ─── 19 themes (R8.8 增 openbuddy + openbuddy-dark) ──────────────────────────────────────────────────────
export const THEMES: ReadonlyArray<ThemeDefinition> = [
  {
    // R8.8: 品牌色 #00C29A 锚定的浅色主题 —— OpenBuddy 默认主题,
    // 让产品有清晰的视觉身份。accent 用品牌绿青(oklch 165 度),
    // bg 用接近白但带极轻绿色调的 off-white,fg 用深炭色保持对比度。
    name: "openbuddy",
    label: "OpenBuddy",
    type: "light",
    accent: "#00C29A",
    vars: {
      "--wb-bg-primary": "oklch(0.985 0.005 165)",
      "--wb-bg-secondary": "oklch(0.965 0.008 165)",
      "--wb-bg-tertiary": "oklch(0.94 0.012 165)",
      "--wb-bg-elevated": "oklch(0.995 0.003 165)",
      "--wb-fg-primary": "oklch(0.2 0.015 240)",
      "--wb-fg-secondary": "oklch(0.42 0.015 240)",
      "--wb-fg-tertiary": "oklch(0.58 0.015 240)",
      "--wb-border": "oklch(0.88 0.01 165)",
      "--wb-border-soft": "oklch(0.92 0.008 165)",
      "--wb-accent": BRAND_ACCENT_OKLCH,
      "--wb-accent-soft": "oklch(0.7246 0.142 171 / 0.14)",
      "--wb-accent-fg": "oklch(0.99 0.005 165)",
      "--wb-danger": "oklch(0.55 0.2 25)",
      "--wb-success": "oklch(0.65 0.15 150)",
      "--wb-warning": "oklch(0.78 0.15 80)",
    },
  },
  {
    // R8.8: 品牌色 #00C29A 锚定的深色主题。深色画布 + 略亮的品牌青作 accent,
    // 沿用品牌身份但适配长时间专注场景。
    name: "openbuddy-dark",
    label: "OpenBuddy Dark",
    type: "dark",
    accent: "#00C29A",
    vars: {
      "--wb-bg-primary": "oklch(0.16 0.008 240)",
      "--wb-bg-secondary": "oklch(0.19 0.008 240)",
      "--wb-bg-tertiary": "oklch(0.22 0.008 240)",
      "--wb-bg-elevated": "oklch(0.21 0.008 240)",
      "--wb-bg-overlay": "oklch(0 0 0 / 0.55)",
      "--wb-fg-primary": "oklch(0.95 0.005 165)",
      "--wb-fg-secondary": "oklch(0.78 0.01 165)",
      "--wb-fg-tertiary": "oklch(0.6 0.01 165)",
      "--wb-border": "oklch(0.32 0.01 240)",
      "--wb-border-soft": "oklch(0.28 0.01 240)",
      "--wb-accent": BRAND_ACCENT_OKLCH,
      "--wb-accent-soft": "oklch(0.7246 0.142 171 / 0.18)",
      "--wb-accent-fg": "oklch(0.13 0.01 240)",
      "--wb-danger": "oklch(0.7 0.2 25)",
      "--wb-success": "oklch(0.72 0.16 150)",
      "--wb-warning": "oklch(0.78 0.15 80)",
    },
  },
  {
    name: "claude",
    label: "Claude",
    type: "dark",
    font: '"Space Grotesk", var(--wb-font)',
    headingFont: '"Playfair Display", Georgia, serif',
    accent: "#cc785c",
    vars: {
      "--wb-bg-primary": "oklch(0.13 0.01 45)",
      "--wb-bg-secondary": "oklch(0.16 0.01 45)",
      "--wb-bg-tertiary": "oklch(0.2 0.01 45)",
      "--wb-bg-elevated": "oklch(0.18 0.01 45)",
      "--wb-fg-primary": "oklch(0.93 0.02 60)",
      "--wb-fg-secondary": "oklch(0.78 0.02 60)",
      "--wb-fg-tertiary": "oklch(.6 0.02 60)",
      "--wb-border": "oklch(1 0 0 / 9%)",
      "--wb-border-soft": "oklch(1 0 0 / 6%)",
      "--wb-accent": "oklch(0.72 0.12 45)",
      "--wb-accent-soft": "oklch(0.72 0.12 45 / 0.16)",
      "--wb-accent-fg": "oklch(0.13 0.01 45)",
    },
  },
  {
    name: "black",
    label: "Black",
    type: "dark",
    accent: "#737373",
    vars: {
      "--wb-bg-primary": "oklch(0.1 0 0)",
      "--wb-bg-secondary": "oklch(0.14 0 0)",
      "--wb-bg-tertiary": "oklch(0.18 0 0)",
      "--wb-bg-elevated": "oklch(0.16 0 0)",
      "--wb-fg-primary": "oklch(0.95 0 0)",
      "--wb-fg-secondary": "oklch(0.7 0 0)",
      "--wb-fg-tertiary": "oklch(0.5 0 0)",
      "--wb-border": "oklch(1 0 0 / 8%)",
      "--wb-border-soft": "oklch(1 0 0 / 5%)",
      "--wb-accent": "oklch(0.95 0 0)",
      "--wb-accent-soft": "oklch(0.95 0 0 / 0.12)",
      "--wb-accent-fg": "oklch(0.1 0 0)",
    },
  },
  {
    name: "white",
    label: "White",
    type: "light",
    accent: "#737373",
    vars: {},
  },
  {
    name: "midnight-ocean",
    label: "Midnight Ocean",
    type: "dark",
    accent: "#3b82f6",
    vars: {
      "--wb-bg-primary": "oklch(0.16 0.03 240)",
      "--wb-bg-secondary": "oklch(0.2 0.03 240)",
      "--wb-bg-tertiary": "oklch(0.24 0.03 240)",
      "--wb-bg-elevated": "oklch(0.22 0.03 240)",
      "--wb-fg-primary": "oklch(0.95 0.01 240)",
      "--wb-fg-secondary": "oklch(0.75 0.02 240)",
      "--wb-fg-tertiary": "oklch(0.55 0.02 240)",
      "--wb-border": "oklch(0.4 0.04 240)",
      "--wb-border-soft": "oklch(0.32 0.04 240)",
      "--wb-accent": "oklch(0.7 0.15 240)",
      "--wb-accent-soft": "oklch(0.7 0.15 240 / 0.15)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
    },
  },
  {
    name: "aurora",
    label: "Aurora",
    type: "dark",
    accent: "#22d3ee",
    vars: {
      "--wb-bg-primary": "oklch(0.14 0.04 200)",
      "--wb-bg-secondary": "oklch(0.18 0.05 195)",
      "--wb-bg-tertiary": "oklch(0.22 0.06 190)",
      "--wb-bg-elevated": "oklch(0.2 0.05 195)",
      "--wb-fg-primary": "oklch(0.95 0.02 200)",
      "--wb-fg-secondary": "oklch(0.75 0.05 200)",
      "--wb-fg-tertiary": "oklch(0.55 0.05 200)",
      "--wb-border": "oklch(0.35 0.07 195)",
      "--wb-border-soft": "oklch(0.28 0.06 195)",
      "--wb-accent": "oklch(0.78 0.16 200)",
      "--wb-accent-soft": "oklch(0.78 0.16 200 / 0.16)",
      "--wb-accent-fg": "oklch(0.12 0.04 200)",
    },
  },
  {
    name: "ember",
    label: "Ember",
    type: "dark",
    accent: "#f97316",
    vars: {
      "--wb-bg-primary": "oklch(0.15 0.02 35)",
      "--wb-bg-secondary": "oklch(0.19 0.03 35)",
      "--wb-bg-tertiary": "oklch(0.23 0.04 35)",
      "--wb-bg-elevated": "oklch(0.21 0.03 35)",
      "--wb-fg-primary": "oklch(0.95 0.02 50)",
      "--wb-fg-secondary": "oklch(0.75 0.04 50)",
      "--wb-fg-tertiary": "oklch(0.55 0.04 50)",
      "--wb-border": "oklch(0.38 0.05 35)",
      "--wb-border-soft": "oklch(0.3 0.04 35)",
      "--wb-accent": "oklch(0.74 0.17 45)",
      "--wb-accent-soft": "oklch(0.74 0.17 45 / 0.16)",
      "--wb-accent-fg": "oklch(0.13 0.02 35)",
    },
  },
  {
    name: "forest",
    label: "Forest",
    type: "dark",
    accent: "#10b981",
    vars: {
      "--wb-bg-primary": "oklch(0.16 0.02 150)",
      "--wb-bg-secondary": "oklch(0.2 0.03 150)",
      "--wb-bg-tertiary": "oklch(0.24 0.03 150)",
      "--wb-bg-elevated": "oklch(0.22 0.03 150)",
      "--wb-fg-primary": "oklch(0.95 0.02 150)",
      "--wb-fg-secondary": "oklch(0.75 0.04 150)",
      "--wb-fg-tertiary": "oklch(0.55 0.04 150)",
      "--wb-border": "oklch(0.36 0.04 150)",
      "--wb-border-soft": "oklch(0.28 0.03 150)",
      "--wb-accent": "oklch(0.72 0.15 155)",
      "--wb-accent-soft": "oklch(0.72 0.15 155 / 0.16)",
      "--wb-accent-fg": "oklch(0.13 0.02 150)",
    },
  },
  {
    name: "cyber",
    label: "Cyber",
    type: "dark",
    font: '"JetBrains Mono", var(--wb-font-mono)',
    accent: "#22ff88",
    vars: {
      "--wb-bg-primary": "oklch(0.12 0.04 290)",
      "--wb-bg-secondary": "oklch(0.16 0.05 290)",
      "--wb-bg-tertiary": "oklch(0.2 0.06 290)",
      "--wb-bg-elevated": "oklch(0.18 0.05 290)",
      "--wb-fg-primary": "oklch(0.95 0.05 290)",
      "--wb-fg-secondary": "oklch(0.78 0.08 290)",
      "--wb-fg-tertiary": "oklch(0.6 0.08 290)",
      "--wb-border": "oklch(0.38 0.08 290)",
      "--wb-border-soft": "oklch(0.3 0.07 290)",
      "--wb-accent": "oklch(0.82 0.22 145)",
      "--wb-accent-soft": "oklch(0.82 0.22 145 / 0.16)",
      "--wb-accent-fg": "oklch(0.12 0.04 290)",
    },
  },
  {
    name: "matrix",
    label: "Matrix",
    type: "dark",
    font: '"JetBrains Mono", var(--wb-font-mono)',
    accent: "#00ff41",
    vars: {
      "--wb-bg-primary": "oklch(0.08 0.03 145)",
      "--wb-bg-secondary": "oklch(0.1 0.04 145)",
      "--wb-bg-tertiary": "oklch(0.12 0.05 145)",
      "--wb-bg-elevated": "oklch(0.11 0.04 145)",
      "--wb-fg-primary": "oklch(0.85 0.2 145)",
      "--wb-fg-secondary": "oklch(0.7 0.18 145)",
      "--wb-fg-tertiary": "oklch(0.5 0.15 145)",
      "--wb-border": "oklch(0.3 0.1 145)",
      "--wb-border-soft": "oklch(0.22 0.08 145)",
      "--wb-accent": "oklch(0.78 0.27 145)",
      "--wb-accent-soft": "oklch(0.78 0.27 145 / 0.18)",
      "--wb-accent-fg": "oklch(0.08 0.03 145)",
    },
  },
  {
    name: "paper",
    label: "Paper",
    type: "light",
    font: '"Cardo", Georgia, serif',
    accent: "#a07a4a",
    vars: {
      "--wb-bg-primary": "oklch(0.98 0.012 80)",
      "--wb-bg-secondary": "oklch(0.95 0.018 80)",
      "--wb-bg-tertiary": "oklch(0.92 0.022 80)",
      "--wb-bg-elevated": "oklch(0.99 0.008 80)",
      "--wb-fg-primary": "oklch(0.22 0.02 60)",
      "--wb-fg-secondary": "oklch(0.42 0.03 60)",
      "--wb-fg-tertiary": "oklch(0.58 0.03 60)",
      "--wb-border": "oklch(0.85 0.02 75)",
      "--wb-border-soft": "oklch(0.9 0.015 75)",
      "--wb-accent": "oklch(0.55 0.08 60)",
      "--wb-accent-soft": "oklch(0.55 0.08 60 / 0.12)",
      "--wb-accent-fg": "oklch(0.99 0.005 80)",
    },
  },
  {
    name: "sakura",
    label: "Sakura",
    type: "light",
    accent: "#ec4899",
    vars: {
      "--wb-bg-primary": "oklch(0.99 0.012 350)",
      "--wb-bg-secondary": "oklch(0.97 0.025 350)",
      "--wb-bg-tertiary": "oklch(0.94 0.04 350)",
      "--wb-bg-elevated": "oklch(0.99 0.015 350)",
      "--wb-fg-primary": "oklch(0.22 0.03 350)",
      "--wb-fg-secondary": "oklch(0.42 0.04 350)",
      "--wb-fg-tertiary": "oklch(0.58 0.04 350)",
      "--wb-border": "oklch(0.88 0.03 350)",
      "--wb-border-soft": "oklch(0.92 0.02 350)",
      "--wb-accent": "oklch(0.66 0.22 0)",
      "--wb-accent-soft": "oklch(0.66 0.22 0 / 0.12)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
    },
  },
  {
    name: "meadow",
    label: "Meadow",
    type: "light",
    accent: "#16a34a",
    vars: {
      "--wb-bg-primary": "oklch(0.99 0.01 150)",
      "--wb-bg-secondary": "oklch(0.96 0.02 150)",
      "--wb-bg-tertiary": "oklch(0.93 0.03 150)",
      "--wb-bg-elevated": "oklch(0.99 0.012 150)",
      "--wb-fg-primary": "oklch(0.22 0.02 150)",
      "--wb-fg-secondary": "oklch(0.42 0.03 150)",
      "--wb-fg-tertiary": "oklch(0.58 0.03 150)",
      "--wb-border": "oklch(0.86 0.03 150)",
      "--wb-border-soft": "oklch(0.91 0.02 150)",
      "--wb-accent": "oklch(0.6 0.17 150)",
      "--wb-accent-soft": "oklch(0.6 0.17 150 / 0.13)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
    },
  },
  {
    name: "sky",
    label: "Sky",
    type: "light",
    accent: "#0ea5e9",
    vars: {
      "--wb-bg-primary": "oklch(0.99 0.01 230)",
      "--wb-bg-secondary": "oklch(0.96 0.02 230)",
      "--wb-bg-tertiary": "oklch(0.93 0.03 230)",
      "--wb-bg-elevated": "oklch(0.99 0.012 230)",
      "--wb-fg-primary": "oklch(0.22 0.02 230)",
      "--wb-fg-secondary": "oklch(0.42 0.03 230)",
      "--wb-fg-tertiary": "oklch(0.58 0.03 230)",
      "--wb-border": "oklch(0.86 0.03 230)",
      "--wb-border-soft": "oklch(0.91 0.02 230)",
      "--wb-accent": "oklch(0.6 0.15 230)",
      "--wb-accent-soft": "oklch(0.6 0.15 230 / 0.13)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
    },
  },
  {
    name: "lavender",
    label: "Lavender",
    type: "light",
    accent: "#8b5cf6",
    vars: {
      "--wb-bg-primary": "oklch(0.99 0.012 290)",
      "--wb-bg-secondary": "oklch(0.96 0.025 290)",
      "--wb-bg-tertiary": "oklch(0.93 0.035 290)",
      "--wb-bg-elevated": "oklch(0.99 0.015 290)",
      "--wb-fg-primary": "oklch(0.22 0.03 290)",
      "--wb-fg-secondary": "oklch(0.42 0.04 290)",
      "--wb-fg-tertiary": "oklch(0.58 0.04 290)",
      "--wb-border": "oklch(0.86 0.03 290)",
      "--wb-border-soft": "oklch(0.91 0.025 290)",
      "--wb-accent": "oklch(0.6 0.18 290)",
      "--wb-accent-soft": "oklch(0.6 0.18 290 / 0.13)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
    },
  },
  {
    name: "apple",
    label: "Apple",
    type: "light",
    font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", system-ui, sans-serif',
    accent: "#007aff",
    vars: {
      "--wb-bg-primary": "oklch(1 0 0)",
      "--wb-bg-secondary": "oklch(0.98 0.002 240)",
      "--wb-bg-tertiary": "oklch(0.95 0.003 240)",
      "--wb-bg-elevated": "oklch(1 0 0)",
      "--wb-fg-primary": "oklch(0.18 0 0)",
      "--wb-fg-secondary": "oklch(0.42 0 0)",
      "--wb-fg-tertiary": "oklch(0.6 0 0)",
      "--wb-border": "oklch(0.9 0 0)",
      "--wb-border-soft": "oklch(0.94 0 0)",
      "--wb-accent": "oklch(0.55 0.2 250)",
      "--wb-accent-soft": "oklch(0.55 0.2 250 / 0.12)",
      "--wb-accent-fg": "oklch(0.99 0 0)",
      "--wb-radius-md": "8px",
      "--wb-radius-lg": "12px",
      "--wb-radius-xl": "18px",
    },
  },
  {
    name: "win95",
    label: "Windows 95",
    type: "light",
    font: '"Pixelated MS Sans Serif", "MS Sans Serif", Tahoma, sans-serif',
    accent: "#008080",
    vars: {
      "--wb-bg-primary": "#c0c0c0",
      "--wb-bg-secondary": "#c0c0c0",
      "--wb-bg-tertiary": "#b0b0b0",
      "--wb-bg-elevated": "#dfdfdf",
      "--wb-bg-overlay": "#00000080",
      "--wb-fg-primary": "#000000",
      "--wb-fg-secondary": "#222222",
      "--wb-fg-tertiary": "#444444",
      "--wb-border": "#808080",
      "--wb-border-soft": "#a0a0a0",
      "--wb-accent": "#000080",
      "--wb-accent-soft": "#00008022",
      "--wb-accent-fg": "#ffffff",
      "--wb-danger": "#800000",
      "--wb-success": "#008000",
      "--wb-warning": "#808000",
      "--wb-shadow": "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #404040",
      "--wb-shadow-md": "inset 2px 2px 0 #ffffff, inset -2px -2px 0 #404040",
      "--wb-radius-sm": "0",
      "--wb-radius-md": "0",
      "--wb-radius-lg": "0",
      "--wb-radius-xl": "0",
    },
  },
  {
    name: "winxp",
    label: "Windows XP",
    type: "light",
    font: '"Trebuchet MS", Tahoma, sans-serif',
    accent: "#245edb",
    vars: {
      "--wb-bg-primary": "#ece9d8",
      "--wb-bg-secondary": "#d6d2c2",
      "--wb-bg-tertiary": "#c1bcac",
      "--wb-bg-elevated": "#f1efe2",
      "--wb-bg-overlay": "#00000080",
      "--wb-fg-primary": "#1c1c1c",
      "--wb-fg-secondary": "#3c3c3c",
      "--wb-fg-tertiary": "#5c5c5c",
      "--wb-border": "#919b9c",
      "--wb-border-soft": "#adb2b3",
      "--wb-accent": "#3a6ea5",
      "--wb-accent-soft": "#3a6ea522",
      "--wb-accent-fg": "#ffffff",
      "--wb-danger": "#a02020",
      "--wb-success": "#208020",
      "--wb-warning": "#a08020",
    },
  },
];

export const DEFAULT_DARK_THEME: ThemeName = "openbuddy-dark";
export const DEFAULT_LIGHT_THEME: ThemeName = "openbuddy";
export const DEFAULT_THEME_PAIR: { light: ThemeName; dark: ThemeName } = {
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
};

export function getThemeByName(
  name: string | null | undefined,
): ThemeDefinition | null {
  if (!name) return null;
  return THEMES.find((t) => t.name === name) ?? null;
}

export function themesByType(type: ThemeType): ThemeDefinition[] {
  return THEMES.filter((t) => t.type === type);
}

export function resolveVars(name: ThemeName): Record<string, string> {
  const theme = getThemeByName(name);
  if (!theme) return {};
  const base = theme.type === "dark" ? DARK_BASE : LIGHT_BASE;
  return { ...base, ...theme.vars };
}

/**
 * 把主题字体里的 `var(--wb-font)` / `var(--wb-font-mono)` 引用展开成具体字体栈。
 *
 * 为什么必须展开:主题写的是 `'"Space Grotesk", var(--wb-font)'`,而我们的落地
 * 位置**就是** `--wb-font` —— 直接写回等于 `--wb-font: "Space Grotesk", var(--wb-font)`,
 * CSS 判定为循环引用 → 整条声明失效,主题字体永远不会生效(现状如此:19 套主题
 * 的 `font` / `headingFont` 只用在 ThemePicker 预览里,对真实 UI 零影响)。
 * 展开后运行时不再有自引用。
 */
export function expandFontRefs(value: string | undefined): string | null {
  if (!value) return null;
  const expanded = value
    .replace(/var\(\s*--wb-font-mono\s*(?:,[^)]*)?\)/g, BASE_MONO_STACK)
    .replace(/var\(\s*--wb-font\s*(?:,[^)]*)?\)/g, BASE_FONT_STACK)
    .trim();
  return expanded.length > 0 ? expanded : null;
}

/**
 * 主题真正落到 DOM 的字体 token。
 *
 *   `--wb-font`         body / 编辑器正文字体(全站继承的基线)
 *   `--wb-font-heading` 标题字体(无 headingFont 的主题与 body 相同)
 *
 * 单独成函数而不是塞进 `theme.vars`:字体是**顶层字段**而非 delta,且需要
 * 展开自引用 —— 与颜色 token 的处理路径不同。
 */
export function resolveThemeFontTokens(
  theme: ThemeDefinition | null | undefined,
): Record<string, string> {
  if (!theme) return {};
  const body = expandFontRefs(theme.font) ?? BASE_FONT_STACK;
  const heading = expandFontRefs(theme.headingFont) ?? body;
  return { "--wb-font": body, "--wb-font-heading": heading };
}

/**
 * 一套主题落到 DOM 的**完整** token 集合 = 颜色(base + delta)+ 字体。
 *
 * 唯一真源:store 与 ThemeInitializer 都走这里,避免"首屏用 resolveVars、
 * 之后用完整集合"这种两套口径(字体就会在首屏后突然换一次)。
 */
export function resolveThemeVars(
  name: ThemeName | string | null | undefined,
): Record<string, string> {
  if (!name) return {};
  const theme = getThemeByName(name as ThemeName);
  if (!theme) return {};
  return { ...resolveVars(theme.name), ...resolveThemeFontTokens(theme) };
}

const GOOGLE_FONT_RE = /['"]([A-Z][A-Za-z0-9 ]+?)['"]/;

export function extractGoogleFontFamily(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const m = value.match(GOOGLE_FONT_RE);
  return m ? m[1].replace(/\s+/g, "+") : null;
}

export function buildFontStylesheetUrl(families: string[]): string | null {
  if (families.length === 0) return null;
  const params = families
    .map((f) => `family=${f}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
