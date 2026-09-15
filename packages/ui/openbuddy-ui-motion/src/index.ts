/**
 * @openbuddy/ui-motion — 统一对外入口
 *
 * 动画 / 微交互原语层。React Bits 风格的 reveal / scroll-trigger / reduced-motion
 * 适配；零运行时依赖（不引入 framer-motion），纯 CSS transitions + Web Animations API。
 */

export { useInView } from "./useInView";
export type { UseInViewOptions } from "./useInView";
export { useReducedMotion } from "./useReducedMotion";
export { easings, durations } from "./easings";
export type { EasingKey, DurationKey } from "./easings";
export { fadeInUp, scaleIn, slideInRight } from "./presets";

// React components
export { FadeInUp } from "./FadeInUp";
export { ScaleIn } from "./ScaleIn";
export { SlideInRight } from "./SlideInRight";
