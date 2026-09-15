/**
 * @openbuddy/ui-motion/easings
 *
 * Re-export of CSS easing tokens as JS constants for Web Animations API use.
 * Keep in sync with tokens.css `--wb-ease-*` vars.
 */

export const easings = {
  outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOutQuart: "cubic-bezier(0.76, 0, 0.24, 1)",
  outBack: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  springPop: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export const durations = {
  instant: 80,
  fast: 120,
  base: 200,
  medium: 280,
  slow: 380,
  slower: 540,
} as const;

export type EasingKey = keyof typeof easings;
export type DurationKey = keyof typeof durations;
