/**
 * FadeInUp — scroll-triggered fade + translate animation.
 * Wraps children and animates them when the element enters viewport.
 */
import type { CSSProperties, ReactNode } from "react";
import { useInView } from "./useInView";
import { useReducedMotion } from "./useReducedMotion";
import { fadeInUp } from "./presets";

export interface FadeInUpProps {
  children: ReactNode;
  delay?: number;
  /** Trigger only once (default true) */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "li" | "article";
}

export function FadeInUp({
  children,
  delay = 0,
  once = true,
  className,
  style,
  as: As = "div",
}: FadeInUpProps) {
  const [ref, inView] = useInView<HTMLDivElement>({ once });
  const reduced = useReducedMotion();

  const composed: CSSProperties = {
    ...(inView && !reduced ? fadeInUp.style : {}),
    animationDelay: `${delay}ms`,
    ...style,
  };

  return (
    <As ref={ref as never} className={`${fadeInUp.className} ${className ?? ""}`} style={composed}>
      {children}
    </As>
  );
}
