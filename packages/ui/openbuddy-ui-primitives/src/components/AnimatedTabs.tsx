/**
 * AnimatedTabs — 下划线滑动切换的 Tabs（React Bits 风格）
 * Phase 3 — 基础原语扩展
 */
import { useRef, useState, useEffect, useLayoutEffect, type ReactNode } from "react";
import "./AnimatedTabs.module.css";

export interface AnimatedTabsItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface AnimatedTabsProps<T extends string = string> {
  items: ReadonlyArray<AnimatedTabsItem<T>>;
  activeId: T;
  onChange(id: T): void;
  className?: string;
  size?: "sm" | "md";
}

export function AnimatedTabs<T extends string>({
  items, activeId, onChange, className, size = "md",
}: AnimatedTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [_, force] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const active = container.querySelector<HTMLButtonElement>(`[data-tab-id="${activeId}"]`);
    if (!active) return;
    const cRect = container.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    indicator.style.left = `${aRect.left - cRect.left}px`;
    indicator.style.width = `${aRect.width}px`;
  }, [activeId, items]);

  useEffect(() => {
    const onResize = () => force((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div ref={containerRef} className={`ob-tabs ${size === "sm" ? "ob-tabs--sm" : ""} ${className ?? ""}`} role="tablist">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-tab-id={item.id}
            className={`ob-tabs__btn ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
          >
            {item.icon && <span className="ob-tabs__icon">{item.icon}</span>}
            <span className="ob-tabs__label">{item.label}</span>
            {item.badge != null && <span className="ob-tabs__badge">{item.badge}</span>}
          </button>
        );
      })}
      <div ref={indicatorRef} className="ob-tabs__indicator" aria-hidden />
    </div>
  );
}
