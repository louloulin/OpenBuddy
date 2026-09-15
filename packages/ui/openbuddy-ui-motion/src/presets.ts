/**
 * @openbuddy/ui-motion/presets
 *
 * Predefined transition / animation recipes matching React Bits-style reveals.
 * These are CSS class strings (not framer-motion variants) so they compose
 * naturally with the existing CSS modules + tokens.css stack.
 */

import { easings, durations } from "./easings";

/** Returns the CSS class to apply for a "fadeInUp" reveal. */
export const fadeInUp = {
  className: "ob-motion-fade-in-up",
  keyframes: `@keyframes ob-fade-in-up {
    from { opacity: 0; transform: translate3d(0, 8px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0,   0); }
  }`,
  style: {
    animation: `ob-fade-in-up var(--wb-duration-medium, ${durations.medium}ms) ${easings.outExpo} both`,
  },
} as const;

export const scaleIn = {
  className: "ob-motion-scale-in",
  keyframes: `@keyframes ob-scale-in {
    from { opacity: 0; transform: scale(0.94); }
    to   { opacity: 1; transform: scale(1); }
  }`,
  style: {
    animation: `ob-scale-in var(--wb-duration-base, ${durations.base}ms) ${easings.springPop} both`,
  },
} as const;

export const slideInRight = {
  className: "ob-motion-slide-in-right",
  keyframes: `@keyframes ob-slide-in-right {
    from { opacity: 0; transform: translate3d(16px, 0, 0); }
    to   { opacity: 1; transform: translate3d(0,    0, 0); }
  }`,
  style: {
    animation: `ob-slide-in-right var(--wb-duration-medium, ${durations.medium}ms) ${easings.outExpo} both`,
  },
} as const;
