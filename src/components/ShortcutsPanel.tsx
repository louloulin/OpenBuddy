import { useEffect, useMemo, useRef, useState } from "react";
import { keyLabel, SHORTCUTS, type ShortcutScope } from "@/lib/shortcuts";
import type { SessionSummary } from "@/lib/types";
import { XCloseIcon } from "@/foundation/components/Icon/icons";
import { relativeTime } from "@/lib/file-utils";

/** The registry as a grouped list (设置·快捷键 and the Ctrl/Cmd+/ panel, U8.2). */
export function ShortcutList() {
  const groups = useMemo(() => {
    const out = new Map<ShortcutScope, typeof SHORTCUTS>();
    for (const s of SHORTCUTS) out.set(s.scope, [...(out.get(s.scope) ?? []), s]);
    return [...out];
  }, []);
  return (
    <div className="shortcut-groups">
      {groups.map(([scope, items]) => (
        <section key={scope} className="shortcut-group">
          <h4 className="shortcut-group__title">{scope}</h4>
          <ul className="shortcuts-list">
            {items.map((s) => (
              <li key={s.id} className="shortcuts-list__row">
                <span className="shortcuts-list__action">{s.label}</span>
                <span className="shortcuts-list__keys">{s.keys.map((k) => <kbd key={k} className="shortcuts-list__key">{keyLabel(k)}</kbd>)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Modal({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="ob-modal__overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"ob-modal " + className} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="快捷键" onClose={onClose} className="ob-modal--shortcuts">
      <header className="ob-modal__head">
        <span>快捷键</span>
        <button type="button" className="ob-modal__close" onClick={onClose} aria-label="关闭"><XCloseIcon size="sm" /></button>
      </header>
      <div className="ob-modal__body"><ShortcutList /></div>
    </Modal>
  );
}

/**
 * Ctrl/Cmd+K: find a task by title, or run a common action (20261115-ui §5.10).
 * ↑/↓ move, Enter opens, Esc closes.
 */
export function SearchPalette({ sessions, onOpen, onNewTask, onClose }: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
  onNewTask: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const list = sessions
      .filter((s) => !s.archived && !seen.has(s.sessionId) && (seen.add(s.sessionId), true))
      .filter((s) => !q || (s.title || "未命名会话").toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return list.slice(0, 50);
  }, [sessions, query]);
  useEffect(() => setActive(0), [query]);
  const rows = [{ kind: "new" as const }, ...results.map((s) => ({ kind: "session" as const, s }))];
  const pick = (index: number) => {
    const row = rows[index];
    if (!row) return;
    onClose();
    if (row.kind === "new") onNewTask(); else onOpen(row.s);
  };
  return (
    <Modal label="搜索任务" onClose={onClose} className="ob-modal--palette">
      <input
        ref={inputRef}
        className="palette__input"
        placeholder="搜索任务标题…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={`palette-row-${active}`}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(active); }
        }}
      />
      <ul className="palette__list" id="palette-list" role="listbox" aria-label="搜索结果">
        {rows.map((row, i) => (
          <li
            key={row.kind === "new" ? "new" : row.s.sessionId}
            id={`palette-row-${i}`}
            role="option"
            aria-selected={i === active}
            className={"palette__row" + (i === active ? " palette__row--active" : "")}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
          >
            {row.kind === "new" ? (
              <><span className="palette__title">新建任务</span><kbd className="shortcuts-list__key">{keyLabel("Mod")}</kbd><kbd className="shortcuts-list__key">N</kbd></>
            ) : (
              <><span className="palette__title">{row.s.title || "未命名会话"}</span><span className="palette__meta">{row.s.updatedAt ? relativeTime(new Date(row.s.updatedAt).getTime() || 0) : ""}</span></>
            )}
          </li>
        ))}
        {query.trim() && results.length === 0 && <li className="palette__empty">没有标题包含「{query.trim()}」的任务</li>}
      </ul>
    </Modal>
  );
}
