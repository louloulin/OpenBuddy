/**
 * Design tokens for the phone (20261115-mobile.md §4.3).
 *
 * The geometry (radii, 44pt targets, 15–16 body) still follows the desktop,
 * but the palette moved to the **Grok bot** direction the product now targets:
 * cool neutral greys, pure-black dark canvas, white-on-black ink actions, and
 * exactly one blue accent reserved for links/focus/the caret. No warm cream,
 * no brand colour on primary buttons, no decorative shadows.
 *
 * Differences from the web layer are only those a phone needs: touch targets
 * (44pt) and a larger minimum body size (15–16).
 */

export type Scheme = 'light' | 'dark'

export type Theme = {
  scheme: Scheme
  /** Window / sidebar canvas (web: --ob-canvas). */
  canvas: string
  /** Main panel behind the conversation (web: --ob-surface). */
  surface: string
  /** Cards, composer, sheets (web: --ob-card). */
  card: string
  cardBorder: string
  /** Values used for text (web: --wb-text-strong / medium / weak). */
  text: string
  textMedium: string
  textWeak: string
  /** Hover / pressed overlays (web: --ob-hover / --ob-active). */
  hover: string
  pressed: string
  /** Primary action ink (web: --ob-ink), not a brand colour. */
  ink: string
  inkFg: string
  /** Bubble fills: user is a warm grey on the desktop, assistant has no bubble. */
  bubble: string
  bubbleText: string
  /** Inline code background (web: rgba(0,0,0,.05) on light, raised on dark). */
  inlineCode: string
  /** Accent used sparingly: caret + focus ring (web: --ob-focus). */
  accent: string
  focus: string
  danger: string
  warning: string
  ok: string
  /** Geometry (web: radius 16 bubbles, 24 composer card). */
  radiusBubble: number
  radiusCard: number
  radiusPill: number
  /** Typography. */
  fontBody: number
  lineBody: number
  fontMeta: number
  mono: string
  /** Layout. */
  gutter: number
  hairline: number
  touch: number
}

const light: Theme = {
  scheme: 'light',
  canvas: '#f5f5f5',
  surface: '#ffffff',
  card: '#ffffff',
  cardBorder: '#e6e6e6',
  text: '#0a0a0a',
  textMedium: '#525252',
  textWeak: '#8b8b8b',
  hover: 'rgba(0, 0, 0, 0.045)',
  pressed: 'rgba(0, 0, 0, 0.08)',
  ink: '#0a0a0a',
  inkFg: '#ffffff',
  bubble: '#f0f0f0',
  bubbleText: '#0a0a0a',
  inlineCode: 'rgba(0, 0, 0, 0.06)',
  accent: '#2563eb',
  focus: 'rgba(37, 99, 235, 0.45)',
  danger: '#e5484d',
  warning: '#b26a00',
  ok: '#1f7a4d',
  radiusBubble: 16,
  radiusCard: 24,
  radiusPill: 999,
  fontBody: 15,
  lineBody: 24,
  fontMeta: 13,
  mono: 'Menlo',
  gutter: 16,
  hairline: 1,
  touch: 44,
}

const dark: Theme = {
  scheme: 'dark',
  canvas: '#000000',
  surface: '#0b0b0b',
  card: '#171717',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  text: '#f5f5f5',
  textMedium: 'rgba(245, 245, 245, 0.66)',
  textWeak: 'rgba(245, 245, 245, 0.42)',
  hover: 'rgba(255, 255, 255, 0.06)',
  pressed: 'rgba(255, 255, 255, 0.1)',
  ink: '#f5f5f5',
  inkFg: '#0b0b0b',
  bubble: '#222222',
  bubbleText: '#f5f5f5',
  inlineCode: 'rgba(255, 255, 255, 0.09)',
  accent: '#93b4ff',
  focus: 'rgba(147, 180, 255, 0.55)',
  danger: '#ff6b63',
  warning: '#e0a33a',
  ok: '#4ade80',
  radiusBubble: 16,
  radiusCard: 24,
  radiusPill: 999,
  fontBody: 15,
  lineBody: 24,
  fontMeta: 13,
  mono: 'Menlo',
  gutter: 16,
  hairline: 1,
  touch: 44,
}

export function themeFor(scheme: Scheme | null | undefined): Theme {
  return scheme === 'dark' ? dark : light
}

export { light as lightTheme, dark as darkTheme }
