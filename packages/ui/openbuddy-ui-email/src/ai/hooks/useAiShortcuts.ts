/**
 * useAiShortcuts — Email AI 全局键盘快捷键。
 *
 * 设计参考:
 *   - Superhuman: J / K 切换,Z 稍后,E 归档,R 回复
 *   - Shortwave:  Cmd+K 调出 AI 命令
 *   - Gmail:      C 新建,/ 搜索,Esc 取消
 *
 * 与旧 `useEmailKeyboard` 的差异:
 *   - 旧 hook 绑死 IPC + alert/toast 副作用;新 hook 只发出语义化事件,
 *     由父组件决定怎么 dispatch(避免 hook 重新执行 IPC)。
 *   - 新 hook 支持 AI 行动(clean inbox / undo / open command bar)。
 */
import { useEffect, useRef } from "react";

export type AiShortcut =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "archive" }
  | { kind: "snooze" }
  | { kind: "reply" }
  | { kind: "compose" }
  | { kind: "search" }
  | { kind: "command" }
  | { kind: "clean-inbox" }
  | { kind: "undo" }
  | { kind: "help" };

export interface UseAiShortcutsArgs {
  enabled?: boolean;
  onShortcut: (shortcut: AiShortcut) => void;
}

const KEY_MAP: Record<string, AiShortcut> = {
  j: { kind: "next" },
  k: { kind: "prev" },
  e: { kind: "archive" },
  z: { kind: "snooze" },
  r: { kind: "reply" },
  c: { kind: "compose" },
  "/": { kind: "search" },
  "meta+k": { kind: "command" },
  "ctrl+k": { kind: "command" },
  "shift+!": { kind: "clean-inbox" },
  "meta+z": { kind: "undo" },
  "ctrl+z": { kind: "undo" },
  "?": { kind: "help" },
};

/** 顶层辅助 hook — 把键盘事件翻译成 AI 语义动作。 */
export function useAiShortcuts({ enabled = true, onShortcut }: UseAiShortcutsArgs): void {
  const handlerRef = useRef(onShortcut);
  useEffect(() => { handlerRef.current = onShortcut; }, [onShortcut]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      // 忽略输入框 / 可编辑区域中的按键。
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const mod = event.metaKey ? "meta+" : event.ctrlKey ? "ctrl+" : "";
      const key = event.key === "?" ? "?" : event.key.toLowerCase();
      const lookup = `${mod}${key}`;
      const shortcut = KEY_MAP[lookup];
      if (!shortcut) return;
      event.preventDefault();
      handlerRef.current(shortcut);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}

/** 默认可见的快捷键清单(底部状态栏用)。 */
export const AI_SHORTCUTS_HELP: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "J / K", label: "切换" },
  { keys: "E", label: "归档" },
  { keys: "Z", label: "稍后" },
  { keys: "R", label: "回复" },
  { keys: "C", label: "新建" },
  { keys: "/", label: "搜索" },
  { keys: "⌘ K", label: "AI 命令" },
  { keys: "⌘ Z", label: "撤销" },
  { keys: "?", label: "帮助" },
];
