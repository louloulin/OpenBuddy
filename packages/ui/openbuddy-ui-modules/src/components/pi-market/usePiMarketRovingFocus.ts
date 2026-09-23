/**
 * usePiMarketRovingFocus — Pi-market 卡片间的键盘 roving focus。
 *
 * 设计目标(对齐 pi.dev / npm 命令面板体验):
 *   - `j` 或 `ArrowDown` → 下一张卡片获得 active;
 *   - `k` 或 `ArrowUp`   → 上一张卡片获得 active;
 *   - `Home` / `End`     → 跳到第一/最后一张;
 *   - `Enter`            → 激活当前 active 卡片(打开 install dialog);
 *   - `c`                → 复制当前 active 卡片的 install 命令;
 *   - `o`                → 打开当前 active 卡片的 repo / npm 链接(优先 repo,否则 npm)。
 *
 * 设计原则:
 *   - 不抢宿主快捷键:遇到 <input> / <textarea> / [contenteditable] 时直接放行。
 *   - 修饰键(Cmd/Ctrl/Alt)存在时直接放行,避免与系统级快捷键冲突。
 *   - 滚到 active 卡片:`element.scrollIntoView({ block: "nearest" })`,
 *     但只在容器已经滚动过 / active 切换时执行,避免首次渲染的跳动。
 *   - SSR 安全:无 window 时静默跳过。
 *   - activeId 跟随 visible entries 自动失效(进入新一页时回到第一张),
 *     避免「active 指向已不存在的卡片」。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface RovingEntry {
  id: string;
  /** 主 repo URL(优先);用于 `o` 快捷键。 */
  repoUrl?: string;
  npmUrl?: string;
  /** 用于 `c` 复制 / `Enter` 激活 / 默认 anchor。 */
  installCommand?: string;
}

export interface UsePiMarketRovingFocusOptions<E extends RovingEntry> {
  /** 当前可见的卡片列表。 */
  entries: readonly E[];
  /** 触发 install(传给 Enter 键)。 */
  onActivate?: (entry: E) => void;
  /** 触发复制(传给 `c` 键)。 */
  onCopy?: (entry: E) => void;
  /** 触发打开外部链接(传给 `o` 键)。 */
  onOpenLink?: (entry: E, url: string) => void;
  /** false 时整组快捷键不绑。 */
  enabled?: boolean;
}

export interface UsePiMarketRovingFocusResult<E extends RovingEntry> {
  /** 当前 active 卡片的 id;null 表示无 active。 */
  activeId: string | null;
  /** 主动设置 active(供鼠标 hover / focus 同步)。 */
  setActiveId: (id: string | null) => void;
  /** 容器 ref,挂到 PiMarketTab 的 <main> 上便于滚动联动。 */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 卡片级 ref 回调,用于按 id 取 DOM。 */
  registerCard: (id: string) => (node: HTMLElement | null) => void;
}

export function usePiMarketRovingFocus<E extends RovingEntry>(
  options: UsePiMarketRovingFocusOptions<E>,
): UsePiMarketRovingFocusResult<E> {
  const { entries, onActivate, onCopy, onOpenLink, enabled = true } = options;

  const [activeId, setActiveIdState] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const registerCard = useCallback((id: string) => {
    return (node: HTMLElement | null) => {
      if (node) cardRefs.current.set(id, node);
      else cardRefs.current.delete(id);
    };
  }, []);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
  }, []);

  // 列表条目变化时,如果当前 active 不在新列表里,清空避免悬挂。
  useEffect(() => {
    if (activeId === null) return;
    if (!entries.some((entry) => entry.id === activeId)) {
      setActiveIdState(null);
    }
  }, [entries, activeId]);

  // 滚到 active 卡片(进入新一页时尤其需要)。
  useEffect(() => {
    if (!activeId) return;
    const node = cardRefs.current.get(activeId);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target)) return;

      const list = entriesRef.current;
      if (list.length === 0) return;

      const currentId = activeRef.current;
      const currentIndex = currentId ? list.findIndex((e) => e.id === currentId) : -1;

      const moveTo = (nextIndex: number) => {
        const clamped = Math.max(0, Math.min(list.length - 1, nextIndex));
        const next = list[clamped];
        if (next) {
          setActiveIdState(next.id);
          event.preventDefault();
        }
      };

      switch (event.key) {
        case "j":
        case "ArrowDown":
          if (currentIndex < 0) moveTo(0);
          else moveTo(currentIndex + 1);
          return;
        case "k":
        case "ArrowUp":
          if (currentIndex < 0) moveTo(0);
          else moveTo(currentIndex - 1);
          return;
        case "Home":
          moveTo(0);
          return;
        case "End":
          moveTo(list.length - 1);
          return;
        case "Enter": {
          if (currentIndex < 0) return;
          const entry = list[currentIndex];
          if (entry && onActivate) {
            event.preventDefault();
            onActivate(entry);
          }
          return;
        }
        case "c": {
          if (currentIndex < 0) return;
          const entry = list[currentIndex];
          if (entry && onCopy) {
            event.preventDefault();
            onCopy(entry);
          }
          return;
        }
        case "o": {
          if (currentIndex < 0) return;
          const entry = list[currentIndex];
          if (entry && onOpenLink) {
            const url = entry.repoUrl || entry.npmUrl;
            if (url) {
              event.preventDefault();
              onOpenLink(entry, url);
            }
          }
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onActivate, onCopy, onOpenLink]);

  return {
    activeId,
    setActiveId,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    registerCard,
  };
}
