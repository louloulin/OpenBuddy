/**
 * KbdHint — 快捷键提示标签
 * Phase 3 — 基础原语扩展
 */
import { memo, type ReactNode } from "react";
import "./KbdHint.module.css";

export interface KbdHintProps {
  /** 单个按键或组合（"⌘" "Ctrl" "Shift" "/"） */
  keys: string | ReadonlyArray<string>;
  size?: "sm" | "md";
  className?: string;
}

function normalizeKey(key: string): string {
  if (key === "Cmd" || key === "cmd") return "⌘";
  if (key === "Ctrl" || key === "ctrl") return "⌃";
  if (key === "Alt" || key === "alt") return "⌥";
  if (key === "Shift" || key === "shift") return "⇧";
  if (key === "Enter" || key === "Return") return "↵";
  if (key === "Esc" || key === "Escape") return "Esc";
  return key;
}

export const KbdHint = memo(function KbdHint({ keys, size = "sm", className }: KbdHintProps) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={`ob-kbd ${size === "md" ? "ob-kbd--md" : ""} ${className ?? ""}`}>
      {list.map((k, i) => (
        <kbd key={i} className="ob-kbd__key">
          {normalizeKey(k)}
        </kbd>
      ))}
    </span>
  );
});
