/**
 * Skeleton — 骨架屏（React Bits 风格 shimmer 动画）
 * Phase 3 — 基础原语扩展
 */
import { memo } from "react";
import "./Skeleton.module.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  /** 行内排版，与文字并排 */
  inline?: boolean;
}

export const Skeleton = memo(function Skeleton({ width = "100%", height = 14, radius = 6, className, inline }: SkeletonProps) {
  return (
    <span
      className={`ob-skeleton ${inline ? "ob-skeleton--inline" : ""} ${className ?? ""}`}
      style={{
        width,
        height,
        borderRadius: radius,
        display: inline ? "inline-block" : "block",
      }}
      aria-hidden
    />
  );
});
