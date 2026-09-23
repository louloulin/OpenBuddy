/**
 * ChatShortcutOverlay — 快捷键发现面板(Plan5 Phase B.6)。
 *
 * 单一入口:把 `@openbuddy/ui-shell` 的 `DEFAULT_SHORTCUTS`(全局/会话/导航)
 * 与 `CHAT_SHORTCUTS`(对话/编辑/工具/帮助)合并成一张分组面板,由宿主
 * **挂载一次**。
 *
 * 两种使用方式:
 *   1. **受控**(默认应用走这条):宿主传 `open` / `onOpenChange`,由宿主自己
 *      绑快捷键(本项目是 `useAppShellRuntime` 的全局 keydown —— `?` 与
 *      `Ctrl/Cmd+/`)。受控模式下本组件**不**再监听键盘,避免一份面板被
 *      两个监听器各开一次(曾经的 "两个面板叠在一起" 缺陷)。
 *   2. **非受控**:不传 `open` 时,组件自己绑 `?` 与 `Ctrl/Cmd+/`,
 *      适合把会话包单独嵌进别的宿主的场景。
 *
 * 视觉与键盘流交互来自 `KeyboardShortcutsDialog`;本组件只负责
 * 默认值合并 + 可选的全局事件桥接。
 */
import { useEffect, useState } from "react";
import {
  KeyboardShortcutsDialog,
  DEFAULT_SHORTCUTS,
  useShortcut,
  type ShortcutEntry,
} from "@openbuddy/ui-shell";

/**
 * 对话相关的默认快捷键集合(在 ui-shell `DEFAULT_SHORTCUTS` 之上扩展)。
 * 键位与 `useShortcut` / 应用内真实绑定保持一致(单一真值)。
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
  { id: "chat-shortcuts", keys: "? / ⌘ /", label: "显示快捷键面板", category: "帮助" },
];

/**
 * 合并后的完整快捷键集合:`DEFAULT_SHORTCUTS`(全局 / 会话导航)
 * + `CHAT_SHORTCUTS`(对话 / 编辑 / 工具 / 帮助)
 * + 调用方追加项。id 冲突时后者覆盖前者。
 */
export function mergeShortcutEntries(
  ...groups: ReadonlyArray<ReadonlyArray<ShortcutEntry> | undefined>
): ShortcutEntry[] {
  const byId = new Map<string, ShortcutEntry>();
  for (const group of groups) {
    if (!group) continue;
    for (const entry of group) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/** 面板默认展示的全部条目(不含调用方追加项)。 */
export const ALL_SHORTCUTS: ShortcutEntry[] = mergeShortcutEntries(
  DEFAULT_SHORTCUTS,
  CHAT_SHORTCUTS,
);

export type ChatShortcutOverlayProps = {
  /** 自定义追加的快捷键(插件可扩展;同 id 覆盖内置项)。 */
  extraShortcuts?: ShortcutEntry[];
  /**
   * 受控开关。传入时组件不监听键盘(由宿主统一派发),这是默认应用的用法;
   * 不传时组件自行绑定 `?` / `Ctrl/Cmd+/`(独立嵌入场景)。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 非受控模式下触发面板的键位;默认 `?`(Shift+/)。 */
  triggerKey?: string;
  /** 非受控模式下是否同时监听 `Ctrl/Cmd+/`。 */
  alsoCtrlSlash?: boolean;
  /** 覆盖整份条目列表(不传时用 `ALL_SHORTCUTS + extraShortcuts`)。 */
  shortcuts?: ShortcutEntry[];
};

export function ChatShortcutOverlay({
  extraShortcuts,
  open: openProp,
  onOpenChange,
  triggerKey = "?",
  alsoCtrlSlash = true,
  shortcuts,
}: ChatShortcutOverlayProps) {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  // 只在非受控模式绑键盘 —— 受控模式由宿主统一派发(避免双面板)。
  useShortcut(
    { key: triggerKey, when: () => !isControlled && !uncontrolledOpen },
    () => setUncontrolledOpen(true),
  );
  useShortcut(
    { key: "/", mod: true, when: () => !isControlled && alsoCtrlSlash && !uncontrolledOpen },
    () => setUncontrolledOpen(true),
  );

  useEffect(() => {
    if (!open || isControlled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUncontrolledOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isControlled]);

  const entries = shortcuts ?? mergeShortcutEntries(ALL_SHORTCUTS, extraShortcuts);

  return (
    <KeyboardShortcutsDialog open={open} onClose={() => setOpen(false)} shortcuts={entries} />
  );
}
