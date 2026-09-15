/**
 * SlideInRight — slide + fade from right edge (toasts, side panels).
 */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { slideInRight } from "./presets";
import { useReducedMotion } from "./useReducedMotion";

export interface SlideInRightProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  show?: boolean;
  delay?: number;
}

export function SlideInRight({ children, className, style, show = true, delay = 0 }: SlideInRightProps) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(show && !reduced);
  useEffect(() => {
    if (show && !reduced) setMounted(true);
  }, [show, reduced]);

  if (!mounted) return null;
  return (
    <div className={`${slideInRight.className} ${className ?? ""}`} style={{ ...slideInRight.style, animationDelay: `${delay}ms`, ...style }}>
      {children}
    </div>
  );
}
