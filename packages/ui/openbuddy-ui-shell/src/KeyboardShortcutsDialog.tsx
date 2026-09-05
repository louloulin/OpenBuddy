/**
 * R1 — Keyboard shortcuts overlay (Codex-style).
 *
 * Triggered by `?` (Shift+/) anywhere in the renderer. Lists the most
 * important shortcuts so new users can discover them without leaving the
 * app. The dialog is dismissable with Escape or by clicking the backdrop.
 *
 * The actual keybindings are owned by the call sites (Composer, ChatView,
 * Sidebar) — this component is purely informational. Adding a new shortcut
 * is a single edit in two places: the handler + this list.
 */
import { memo, useEffect } from "react";
import { CloseIcon, KeyboardIcon } from "@openbuddy/ui-primitives/icons";

export interface ShortcutEntry {
  /** Keys in human-readable form, e.g. "Cmd+K", "↑/↓". */
  keys: string;
  /** Chinese description of what the shortcut does. */
  description: string;
  /** Optional grouping (search, navigation, composer, etc.). */
  group?: string;
}

const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  { keys: "Cmd+K", description: "打开搜索面板", group: "导航" },
  { keys: "Cmd+B", description: "折叠 / 展开侧边栏", group: "导航" },
  { keys: "Cmd+L", description: "跳转到当前会话", group: "导航" },
  { keys: "Cmd+T", description: "新建任务", group: "导航" },
  { keys: "Cmd+,", description: "打开设置", group: "导航" },
  { keys: "Cmd+/", description: "切换模型选择器", group: "导航" },
  { keys: "?", description: "显示 / 隐藏快捷键列表", group: "导航" },

  { keys: "Enter", description: "发送消息(无换行)", group: "输入" },
  { keys: "Shift+Enter", description: "在输入框插入换行", group: "输入" },
  { keys: "↑ / ↓", description: "在历史消息和草稿之间导航", group: "输入" },
  { keys: "Esc", description: "停止生成 / 关闭弹层", group: "输入" },
  { keys: "@", description: "打开 @ 文件 / 符号选择器", group: "输入" },
  { keys: "/", description: "打开 slash 指令菜单", group: "输入" },

  { keys: "Cmd+F", description: "在对话内查找", group: "查看" },
  { keys: "F3 / Shift+F3", description: "跳到下一个 / 上一个匹配", group: "查看" },
  { keys: "Cmd+Shift+R", description: "强制重新加载渲染进程", group: "查看" },
];

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Allow the host to inject additional shortcuts (e.g. plugin-added). */
  extraShortcuts?: ShortcutEntry[];
}

export const KeyboardShortcutsDialog = memo(function KeyboardShortcutsDialog({
  open,
  onClose,
  extraShortcuts,
}: KeyboardShortcutsDialogProps) {
  // Close on Escape when open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const all = [...DEFAULT_SHORTCUTS, ...(extraShortcuts ?? [])];
  const groups = new Map<string, ShortcutEntry[]>();
  for (const s of all) {
    const g = s.group ?? "其他";
    const list = groups.get(g);
    if (list) list.push(s);
    else groups.set(g, [s]);
  }

  return (
    <div
      className="kb-shortcuts-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="键盘快捷键"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kb-shortcuts">
        <header className="kb-shortcuts__header">
          <span className="kb-shortcuts__title">
            <KeyboardIcon size="sm" /> 键盘快捷键
          </span>
          <button
            type="button"
            className="kb-shortcuts__close"
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon size="sm" />
          </button>
        </header>
        <div className="kb-shortcuts__body">
          {Array.from(groups.entries()).map(([group, entries]) => (
            <section key={group} className="kb-shortcuts__group">
              <h3 className="kb-shortcuts__group-title">{group}</h3>
              <ul className="kb-shortcuts__list">
                {entries.map((s, i) => (
                  <li key={i} className="kb-shortcuts__row">
                    <span className="kb-shortcuts__keys">
                      {s.keys.split(" ").map((k, j) => (
                        <kbd key={j} className="kb-shortcuts__kbd">{k}</kbd>
                      ))}
                    </span>
                    <span className="kb-shortcuts__desc">{s.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="kb-shortcuts__footer">
          按 <kbd className="kb-shortcuts__kbd">?</kbd> 随时再次打开 ·{" "}
          <kbd className="kb-shortcuts__kbd">Esc</kbd> 关闭
        </footer>
      </div>
    </div>
  );
});
