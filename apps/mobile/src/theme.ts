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
  /** Cards inside a list (SettingsList, result rows). */
  radiusTile: number
  /** Bottom sheets. */
  radiusSheet: number
  /** Code blocks, thumbnails, chips inside a card. */
  radiusSmall: number
  /**
   * Typography ramp. Four sizes, no ad-hoc numbers: a screen title, a section
   * heading, body, and metadata. `fontMicro` is allowed only for uppercase
   * labels ≤ 4 characters (thinking chip, counters), never for sentences.
   */
  fontTitle: number
  fontHeading: number
  fontBody: number
  lineBody: number
  fontMeta: number
  fontMicro: number
  mono: string
  /** Layout. */
  gutter: number
  /** Padding inside a card. */
  pad: number
  /** Vertical rhythm between transcript rows. */
  rowGap: number
  /** Minimum tap target (Apple HIG / Material). */
  touch: number
  hairline: number
  /** Modal backdrop. Stronger on dark: a 35% veil over pure black is invisible. */
  scrim: string
  /** Filled badge (unread counts) — ink, so it matches the primary button. */
  badge: string
  badgeText: string
}

const light: Theme = {
  scheme: 'light',
  canvas: '#f5f5f5',
  surface: '#ffffff',
  card: '#ffffff',
  cardBorder: '#e6e6e6',
  text: '#0a0a0a',
  textMedium: '#525252',
  // #8b8b8b on white is ≈3.4:1; metadata that must stay legible uses #6f6f6f (4.7:1).
  textWeak: '#6f6f6f',
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
  radiusTile: 14,
  radiusSheet: 18,
  radiusSmall: 8,
  fontTitle: 28,
  fontHeading: 17,
  fontBody: 15,
  lineBody: 24,
  fontMeta: 13,
  fontMicro: 11,
  mono: 'Menlo',
  gutter: 16,
  pad: 14,
  rowGap: 8,
  touch: 44,
  hairline: 1,
  scrim: 'rgba(0, 0, 0, 0.32)',
  badge: '#0a0a0a',
  badgeText: '#ffffff',
}

const dark: Theme = {
  scheme: 'dark',
  canvas: '#000000',
  surface: '#0b0b0b',
  card: '#171717',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  text: '#f5f5f5',
  textMedium: 'rgba(245, 245, 245, 0.70)',
  // 0.58 on #171717 ≈ 4.7:1 — metadata still recedes but clears AA.
  textWeak: 'rgba(245, 245, 245, 0.58)',
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
  radiusTile: 14,
  radiusSheet: 18,
  radiusSmall: 8,
  fontTitle: 28,
  fontHeading: 17,
  fontBody: 15,
  lineBody: 24,
  fontMeta: 13,
  fontMicro: 11,
  mono: 'Menlo',
  gutter: 16,
  pad: 14,
  rowGap: 8,
  touch: 44,
  hairline: 1,
  // A 35% veil over #000 is invisible; dark needs a heavier backdrop.
  scrim: 'rgba(0, 0, 0, 0.62)',
  badge: '#f5f5f5',
  badgeText: '#0b0b0b',
}

export function themeFor(scheme: Scheme | null | undefined): Theme {
  return scheme === 'dark' ? dark : light
}

export { light as lightTheme, dark as darkTheme }
