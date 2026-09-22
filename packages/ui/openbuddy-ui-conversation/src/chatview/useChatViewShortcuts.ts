/**
 * useChatViewShortcuts — 会话内键盘快捷键注册 hook。
 *
 * 抽出 `ChatView.tsx` 改造前内联的 window keydown 监听,行为逐字等价:
 *   - Ctrl/Cmd + F → 打开会话内查找(仅当会话里有消息时,与改造前一致)
 *   - Escape(查找面板打开时)→ 关闭查找
 *
 * 新增(Phase B.6):
 *   - `?`(Shift+/) 与 Ctrl/Cmd + `/` → 快捷键发现面板,**不在本 hook 处理**。
 *     它由 App 顶层挂载一次的 `<ChatShortcutOverlay />` 全局承接,避免
 *     每个 ChatView 实例各挂一份监听。
 *
 * 两个导出:
 *   - `useChatViewShortcuts` — 供 `<div onKeyDown>` 绑定的容器内快捷键
 *   - `useChatViewGlobalShortcuts` — 改造前语义:无需焦点,window 级监听
 *     (会话查找在滚动区域外点击后仍要可用,所以保留全局监听)
 */
import { useCallback, useEffect, useRef } from "react";

export type UseChatViewShortcutsParams = {
  /** Ctrl/Cmd+F 触发。 */
  onToggleFind?: () => void;
  /** 查找打开时按 Escape 触发。 */
  onCloseFind?: () => void;
  /** 查找面板当前是否打开(Escape 分支的守卫)。 */
  findOpen?: boolean;
  /** 会话里是否有消息;无消息时 Ctrl/Cmd+F 不抢键(与改造前一致)。 */
  hasMessages?: boolean;
};

export type UseChatViewShortcutsResult = {
  /** 绑到 chat 根容器的 onKeyDown。 */
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

function isMetaOrCtrl(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey;
}

/** 焦点在可编辑元素里时不抢 Escape(让 inline editor / composer 自己处理)。 */
function isEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (el as any).isContentEditable === true;
}

export function useChatViewShortcuts({
  onToggleFind,
  onCloseFind,
  findOpen,
  hasMessages = true,
}: UseChatViewShortcutsParams): UseChatViewShortcutsResult {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && findOpen && !isEditingTarget(event.target)) {
        event.preventDefault();
        onCloseFind?.();
        return;
      }
      if (isMetaOrCtrl(event) && event.key.toLowerCase() === "f") {
        if (!hasMessages) return;
        event.preventDefault();
        onToggleFind?.();
      }
    },
    [findOpen, hasMessages, onToggleFind, onCloseFind],
  );

  return { handleKeyDown };
}

/**
 * window 级会话查找快捷键。改造前是 ChatView 里一段内联 useEffect,
 * 这里原样保留语义:`Ctrl/Cmd+F` 无需焦点即可打开查找。
 */
export function useChatViewGlobalShortcuts({
  enabled,
  onOpenFind,
}: {
  /** 会话里有消息时才挂监听(改造前用 `messages.length > 0` 守卫)。 */
  enabled: boolean;
  onOpenFind: () => void;
}): void {
  // 回调走 ref:调用方(`ChatView`)通常传内联箭头函数,直接进依赖数组
  // 会让监听器每次渲染都重挂 —— 这里只按 `enabled` 挂载一次。
  const onOpenFindRef = useRef(onOpenFind);
  onOpenFindRef.current = onOpenFind;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onOpenFindRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
