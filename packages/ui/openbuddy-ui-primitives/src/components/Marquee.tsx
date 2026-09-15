/**
 * Marquee — 横向滚动 (React Bits 风格)
 * Phase 3 — 基础原语扩展
 * 用于技能推荐栏 / 工具列表横向滚动展示
 */
import { memo, useEffect, useState, type ReactNode, Children } from "react";
import "./Marquee.module.css";

export interface MarqueeProps {
  children: ReactNode;
  /** 像素/秒；越大越快 */
  speed?: number;
  /** 是否暂停在 hover 时 */
  pauseOnHover?: boolean;
  className?: string;
}

export const Marquee = memo(function Marquee({ children, speed = 40, pauseOnHover = true, className }: MarqueeProps) {
  const [count, setCount] = useState(2);
  useEffect(() => {
    const childArr = Children.toArray(children);
    setCount(Math.max(2, Math.ceil(120 / Math.max(childArr.length, 1))));
  }, [children]);

  const duration = `${Math.max(8, 200 / Math.max(speed, 1))}s`;

  return (
    <div className={`ob-marquee ${pauseOnHover ? "ob-marquee--hover-pause" : ""} ${className ?? ""}`}>
      <div className="ob-marquee__track" style={{ animationDuration: duration }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="ob-marquee__group">{children}</div>
        ))}
      </div>
    </div>
  );
});
