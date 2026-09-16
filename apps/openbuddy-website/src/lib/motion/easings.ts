/**
 * Easings and durations as JS constants, for the Web Animations API and for
 * `animationDelay` bookkeeping.
 *
 * Ported from packages/ui/openbuddy-ui-motion/src/easings.ts and mirrored by
 * the `--wb-ease-*` / `--wb-duration-*` custom properties in
 * src/styles/globals.css. Prefer the CSS vars in stylesheets; use these only
 * where JS needs the number. Change both together or the two timelines drift.
 */

export const easings = {
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOutQuart: 'cubic-bezier(0.76, 0, 0.24, 1)',
  outBack: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  springPop: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
} as const;

export const durations = {
  instant: 80,
  fast: 120,
  base: 200,
  medium: 280,
  slow: 380,
  slower: 540
} as const;

export type EasingKey = keyof typeof easings;
export type DurationKey = keyof typeof durations;
