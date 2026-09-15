/**
 * KeyboardShortcutsDialog — Phase 6 升级版
 *
 * 新增可搜索 input + 列表过滤。登记 7 个核心快捷键 + ⌘⇧[ / ⌘⇧] 会话导航。
 */
import { useState, useMemo } from "react";
import { useShortcut } from "./useShortcut";

export interface ShortcutEntry {
  id: string;
  keys: string;        // 显示文本，如 "⌘ K"
  label: string;
  category: string;
}

export const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  { id: "command-palette", keys: "⌘ K", label: "打开命令面板", category: "全局" },
  { id: "new-session", keys: "⌘ N", label: "新建会话", category: "全局" },
  { id: "toggle-sidebar", keys: "⌘ B", label: "切换侧边栏", category: "全局" },
  { id: "toggle-scene", keys: "⌘ /", label: "切换助手场景", category: "全局" },
  { id: "session-1", keys: "⌘ 1", label: "切换到第 1 个会话", category: "会话" },
  { id: "session-9", keys: "⌘ 9", label: "切换到第 9 个会话", category: "会话" },
  { id: "prev-session", keys: "⌘ ⇧ [", label: "上一个会话", category: "会话" },
  { id: "next-session", keys: "⌘ ⇧ ]", label: "下一个会话", category: "会话" },
];

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  shortcuts?: ShortcutEntry[];
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
  shortcuts = DEFAULT_SHORTCUTS,
}: KeyboardShortcutsDialogProps) {
  const [query, setQuery] = useState("");

  useShortcut({ key: "Escape", when: () => open }, () => onClose());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shortcuts;
    return shortcuts.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q)
    );
  }, [shortcuts, query]);

  if (!open) return null;

  return (
    <div className="kbd-shortcuts-overlay" role="dialog" aria-modal="true" aria-labelledby="kbd-title">
      <div className="kbd-shortcuts-panel">
        <header className="kbd-shortcuts-header">
          <h2 id="kbd-title" className="kbd-shortcuts-title">键盘快捷键</h2>
          <button className="kbd-shortcuts-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <input
          type="search"
          className="kbd-shortcuts-search"
          placeholder="搜索快捷键..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="搜索快捷键"
        />
        <ul className="kbd-shortcuts-list">
          {filtered.length === 0 && (
            <li className="kbd-shortcuts-empty">未找到匹配的快捷键</li>
          )}
          {filtered.map((s) => (
            <li key={s.id} className="kbd-shortcuts-item">
              <span className="kbd-shortcuts-label">{s.label}</span>
              <kbd className="kbd-shortcuts-keys">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
