/**
 * usePiMarketShortcuts — 注册一组只对当前 panel 生效的键盘快捷键。
 *
 * - `/`           聚焦搜索框(常见浏览行为)
 * - `Escape`      已经聚焦在搜索框时,清空搜索并保持焦点;其它情况冒泡给宿主
 * - `g` 然后 `p`  跳到下一页(分页辅助)
 * - `g` 然后 `P`  跳到上一页
 *
 * 卡片之间的 roving focus(j/k / Enter / c / o)由 usePiMarketRovingFocus
 * 单独实现,这样两个 hook 职责分离、可以独立开关。
 *
 * 设计原则:
 *   - 不抢宿主快捷键:遇到 <input> / <textarea> / [contenteditable] 时,
 *     仅 `/` 会触发;其它按键冒泡。
 *   - 冲突时把焦点操作放在 onKeyDown 之后,用 ref 直接 focus 控件,不破坏 input 受控值。
 *   - 两键序列(`g` + `p`)用 800ms 窗口,避免误触。
 *   - SSR 安全:没有 window 时静默跳过。
 */
import { useEffect, useRef } from "react";

export interface PiMarketShortcutBindings {
  /** 触发「聚焦搜索」 */
  focusSearch: () => void;
  /** 当前页减 1(到边界时由宿主自己 disable) */
  prevPage?: () => void;
  /** 当前页加 1 */
  nextPage?: () => void;
}

interface UsePiMarketShortcutsOptions extends PiMarketShortcutBindings {
  /** false 时彻底不绑;默认 true。 */
  enabled?: boolean;
}

const SEQ_TIMEOUT_MS = 800;

export function usePiMarketShortcuts(options: UsePiMarketShortcutsOptions): void {
  const { focusSearch, prevPage, nextPage, enabled = true } = options;
  const pendingGRef = useRef(false);
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const isEditable = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const clearPending = () => {
      pendingGRef.current = false;
      if (pendingGTimerRef.current !== null) {
        clearTimeout(pendingGTimerRef.current);
        pendingGTimerRef.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // 修饰键存在 = 用户在做系统级快捷键,别抢
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const editable = isEditable(event.target);

      // `/` 在所有非 input 上下文都聚焦搜索;在 input 里只当用户没输入时才抢
      if (event.key === "/" && !editable) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (editable) {
        // input 里其它快捷键全部冒泡
        return;
      }

      // Escape:清 pending 序列(让下次 g 重新开始)
      if (event.key === "Escape") {
        if (pendingGRef.current) {
          clearPending();
          event.preventDefault();
        }
        return;
      }

      // g 序列
      if (event.key === "g" && !pendingGRef.current) {
        pendingGRef.current = true;
        event.preventDefault();
        pendingGTimerRef.current = setTimeout(() => {
          pendingGRef.current = false;
          pendingGTimerRef.current = null;
        }, SEQ_TIMEOUT_MS);
        return;
      }
      if (pendingGRef.current) {
        if (event.key === "p" && prevPage) {
          event.preventDefault();
          prevPage();
          clearPending();
          return;
        }
        if (event.key === "P" && nextPage) {
          event.preventDefault();
          nextPage();
          clearPending();
          return;
        }
        // 其它键取消 g 序列
        clearPending();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [enabled, focusSearch, prevPage, nextPage]);
}
