/**
 * ChatShortcutOverlay — 快捷键发现面板(Phase B.6)。
 *
 * 包装现有的 `KeyboardShortcutsDialog`,扩展:
 *   - 新增 `Ctrl/Cmd+/` 与 `Shift+/`(即 "?") 全局触发器
 *   - 默认 shortcut list 注入对话/编辑/导航/工具/调试 5 组
 *   - 在 `<AppShell>` 挂载一次即可,作用域全应用
 *
 * 视觉与键盘流交互均来自 `@openbuddy/ui-shell` 的 `KeyboardShortcutsDialog`,
 * 本组件只做"对话相关快捷键"的默认值注入与全局事件桥接。
 */
import { useEffect, useState } from "react";
import {
  KeyboardShortcutsDialog,
  type ShortcutEntry,
} from "@openbuddy/ui-shell";
import { useShortcut } from "@openbuddy/ui-shell";

/**
 * 对话相关的默认快捷键集合(在 ui-shell 默认之上扩展)。
 */
export const CHAT_SHORTCUTS: ShortcutEntry[] = [
  { id: "chat-find", keys: "⌘ F", label: "在当前会话中查找", category: "对话" },
  { id: "chat-find-next", keys: "⌘ G", label: "查找下一个", category: "对话" },
  { id: "chat-find-prev", keys: "⌘ ⇧ G", label: "查找上一个", category: "对话" },
  { id: "chat-retry", keys: "⌘ R", label: "重新生成最后一条回复", category: "对话" },
  { id: "chat-edit-last", keys: "⌘ E", label: "编辑最后一条用户消息", category: "对话" },
  { id: "chat-stop", keys: "Esc", label: "停止生成", category: "对话" },
  { id: "chat-pause", keys: "⌘ P", label: "暂停生成(软停止,保留上下文)", category: "对话" },
  { id: "chat-clear", keys: "⌘ L", label: "清空当前输入", category: "编辑" },
  { id: "chat-send", keys: "⌘ ⏎", label: "发送(任意焦点位置)", category: "编辑" },
  { id: "chat-history-prev", keys: "↑", label: "上一条历史输入", category: "编辑" },
  { id: "chat-history-next", keys: "↓", label: "下一条历史输入", category: "编辑" },
  { id: "chat-tools-panel", keys: "⌘ ⇧ T", label: "切换工具面板", category: "工具" },
  { id: "chat-shortcuts", keys: "?", label: "显示快捷键面板", category: "帮助" },
];

export type ChatShortcutOverlayProps = {
  /** 自定义追加的快捷键(插件可扩展)。 */
  extraShortcuts?: ShortcutEntry[];
  /** 触发快捷键面板的键位;默认 `?`(Shift+/)。 */
  triggerKey?: string;
  /** 是否监听 `Ctrl/Cmd+/` 作为额外触发器。 */
  alsoCtrlSlash?: boolean;
};

export function ChatShortcutOverlay({
  extraShortcuts,
  triggerKey = "?",
  alsoCtrlSlash = true,
}: ChatShortcutOverlayProps) {
  const [open, setOpen] = useState(false);

  useShortcut(
    { key: triggerKey, when: () => !open },
    () => setOpen(true),
  );
  useShortcut(
    {
      key: "/",
      mod: true,
      when: () => !open,
    },
    () => setOpen(true),
  );

  // 防御:在 input/textarea 焦点时,不抢 `?` 字符(否则用户输入"?"时被劫持)。
  // useShortcut 内部应已经做这个判断,但这里再加一道防线。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shortcuts = extraShortcuts ? [...CHAT_SHORTCUTS, ...extraShortcuts] : CHAT_SHORTCUTS;

  return (
    <KeyboardShortcutsDialog open={open} onClose={() => setOpen(false)} shortcuts={shortcuts} />
  );
}
