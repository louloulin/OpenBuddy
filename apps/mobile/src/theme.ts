/**
 * Design tokens for the phone (20261115-mobile.md §4.3).
 *
 * These are the *desktop* tokens from `apps/web/src/styles/polish.css`, ported
 * verbatim: warm neutral canvas, near-white surface, an ink primary action
 * rather than a brand blue, hairline borders and quiet shadows. The phone must
 * look like the same product as the desktop window, so the numbers below are
 * copied rather than invented.
 *
 * Differences from the web layer are only those a phone needs: touch targets
 * (44pt), a larger minimum body size (15–16), and one accent reserved for the
 * send button and the streaming caret.
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
  canvas: '#f3f2f0',
  surface: '#f9f8f7',
  card: '#ffffff',
  cardBorder: '#e6e5e3',
  text: '#121110',
  textMedium: 'rgba(18, 17, 16, 0.68)',
  textWeak: 'rgba(18, 17, 16, 0.46)',
  hover: 'rgba(15, 13, 10, 0.045)',
  pressed: 'rgba(15, 13, 10, 0.075)',
  ink: '#121110',
  inkFg: '#ffffff',
  bubble: '#ebebeb',
  bubbleText: 'rgba(0, 0, 0, 0.9)',
  inlineCode: 'rgba(0, 0, 0, 0.05)',
  accent: '#3857c7',
  focus: 'rgba(56, 87, 199, 0.5)',
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
  canvas: '#181716',
  surface: '#131211',
  card: '#201f1d',
  cardBorder: 'rgba(252, 252, 252, 0.08)',
  text: '#f4f3f1',
  textMedium: 'rgba(244, 243, 241, 0.72)',
  textWeak: 'rgba(244, 243, 241, 0.48)',
  hover: 'rgba(252, 252, 252, 0.06)',
  pressed: 'rgba(252, 252, 252, 0.1)',
  ink: '#f4f3f1',
  inkFg: '#141312',
  bubble: '#2a2927',
  bubbleText: 'rgba(252, 252, 252, 0.92)',
  inlineCode: 'rgba(252, 252, 252, 0.09)',
  accent: '#8199ff',
  focus: 'rgba(129, 156, 255, 0.6)',
  danger: '#ff6b63',
  warning: '#e0a33a',
  ok: '#4fc98a',
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
