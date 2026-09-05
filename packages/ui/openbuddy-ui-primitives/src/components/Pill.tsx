import type { ReactNode } from "react";
import styles from "./Pill.module.css";

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface PillProps {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}

export function Pill({ tone = "neutral", children, className }: PillProps) {
  return (
    <span className={[styles.pill, styles[`t_${tone}`], className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
