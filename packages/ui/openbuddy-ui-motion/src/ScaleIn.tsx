/**
 * ScaleIn — spring-pop scale-in for modals / popovers / cards.
 */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { scaleIn } from "./presets";
import { useReducedMotion } from "./useReducedMotion";

export interface ScaleInProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  /** Render the element animated in (default true). */
  show?: boolean;
}

export function ScaleIn({ children, delay = 0, className, style, show = true }: ScaleInProps) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(show && !reduced);
  useEffect(() => {
    if (show && !reduced) setMounted(true);
  }, [show, reduced]);

  if (!mounted) return null;
  return (
    <div className={`${scaleIn.className} ${className ?? ""}`} style={{ ...scaleIn.style, animationDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}
