/**
 * useShortcut — Phase 6 键盘快捷键 hook
 *
 * 用法：
 *   useShortcut({ mod: true, key: "k" }, () => openCommandPalette());
 *   useShortcut({ key: "Escape" }, () => closeDialog(), { when: isOpen });
 *
 * 自动适配：Mac ⌘ vs Win/Linux Ctrl。
 */

import { useEffect, useMemo } from "react";

export interface ShortcutOptions {
  /** 主修饰键（Mac ⌘ / Win Ctrl 自动适配） */
  mod?: boolean;
  /** Shift 修饰 */
  shift?: boolean;
  /** Alt/Option 修饰 */
  alt?: boolean;
  /** 单键（如 "k"、"Escape"、"ArrowUp"）；大小写不敏感 */
  key: string;
  /** 守卫函数：返回 false 时不触发 */
  when?: () => boolean;
  /** 是否阻止默认行为 */
  preventDefault?: boolean;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function isMacMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

export function useShortcut(
  options: ShortcutOptions,
  callback: (e: KeyboardEvent) => void
): void {
  const serialized = useMemo(
    () =>
      JSON.stringify({
        mod: options.mod ?? false,
        shift: options.shift ?? false,
        alt: options.alt ?? false,
        key: options.key.toLowerCase(),
      }),
    [options.mod, options.shift, options.alt, options.key]
  );

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (options.mod && !isMacMod(e)) return;
      if (options.shift && !e.shiftKey) return;
      if (options.alt && !e.altKey) return;
      if (e.key.toLowerCase() !== options.key.toLowerCase()) return;
      if (options.when && !options.when()) return;
      if (options.preventDefault ?? true) e.preventDefault();
      callback(e);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [serialized, callback, options]);
}
