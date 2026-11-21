import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { keyLabel, SHORTCUTS, type ShortcutScope } from "@/shared/lib/shortcuts";
import type { SessionSummary } from "@openbuddy/protocol/dto";
import { XCloseIcon } from "@openbuddy/ui/icon/icons/index";
import { relativeTime } from "@/shared/lib/files/file-utils";
import type { SessionSearchHit } from "@openbuddy/protocol/search";
import { requestFind } from "../state/find-request-store";
import { useFeature } from "../routing/use-feature";
import { ContentHitBody } from "./SearchOverlay";
import { findTermFor, searchable, useContentSearch } from "./use-content-search";

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

type PaletteRow =
  | { kind: "new" }
  | { kind: "session"; s: SessionSummary }
  | { kind: "hit"; hit: SessionSearchHit };

/**
 * Ctrl/Cmd+K: find a task by title, or run a common action (20261115-ui §5.10); with
 * `session_search` served, a 内容 group lists message-text hits with highlighted snippets
 * (pii W1.4). Opening a hit opens its task and jumps the chat's find bar to the match.
 * ↑/↓ move, Enter opens, Esc closes.
 */
export function SearchPalette({ sessions, onOpen, onNewTask, onClose }: {
  sessions: SessionSummary[];
  onOpen: (s: Pick<SessionSummary, "sessionId" | "cwd">) => void;
  onNewTask: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentSearch = useFeature("session-search");
  const content = useContentSearch(query, contentSearch);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const list = sessions
      .filter((s) => !s.archived && !seen.has(s.sessionId) && (seen.add(s.sessionId), true))
      .filter((s) => !q || (s.title || "未命名会话").toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return list.slice(0, q ? 8 : 50);
  }, [sessions, query]);
  // Title-only hits are already in the 任务 group; the 内容 group is about message text.
  const hits = useMemo(() => content.hits.filter((hit) => hit.matchedIn !== "title"), [content.hits]);
  useEffect(() => setActive(0), [query]);
  const rows: PaletteRow[] = [{ kind: "new" }, ...results.map((s) => ({ kind: "session" as const, s })), ...hits.map((hit) => ({ kind: "hit" as const, hit }))];
  const pick = (index: number) => {
    const row = rows[index];
    if (!row) return;
    onClose();
    if (row.kind === "new") onNewTask();
    else if (row.kind === "session") onOpen(row.s);
    else {
      requestFind(row.hit.sessionId, findTermFor(query, row.hit));
      onOpen({ sessionId: row.hit.sessionId, cwd: row.hit.cwd });
    }
  };
  const showContent = contentSearch && searchable(query);
  const rowProps = (i: number) => ({
    id: `palette-row-${i}`,
    role: "option",
    "aria-selected": i === active,
    className: "palette__row" + (i === active ? " palette__row--active" : ""),
    onMouseEnter: () => setActive(i),
    onClick: () => pick(i),
  });
  return (
    <Modal label="搜索任务" onClose={onClose} className="ob-modal--palette">
      <input
        ref={inputRef}
        className="palette__input"
        placeholder={contentSearch ? "搜索任务标题或对话内容…" : "搜索任务标题…"}
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
        {rows.map((row, i) => row.kind === "new" ? (
          <li key="new" {...rowProps(i)}>
            <span className="palette__title">新建任务</span><kbd className="shortcuts-list__key">{keyLabel("Mod")}</kbd><kbd className="shortcuts-list__key">N</kbd>
          </li>
        ) : row.kind === "session" ? (
          <Fragment key={row.s.sessionId}>
            {i === 1 && query.trim() && <li className="palette__group" role="presentation">任务</li>}
            <li {...rowProps(i)}>
              <span className="palette__title">{row.s.title || "未命名会话"}</span><span className="palette__meta">{row.s.updatedAt ? relativeTime(new Date(row.s.updatedAt).getTime() || 0) : ""}</span>
            </li>
          </Fragment>
        ) : (
          <Fragment key={`hit-${row.hit.sessionId}`}>
            {i === results.length + 1 && <li className="palette__group" role="presentation">内容</li>}
            <li {...rowProps(i)} className={rowProps(i).className + " palette__row--hit"} data-hit-session={row.hit.sessionId}>
              <ContentHitBody hit={row.hit} meta={<span className="palette__meta">{relativeTime(new Date(row.hit.updatedAt).getTime() || 0)}</span>} />
            </li>
          </Fragment>
        ))}
        {query.trim() && results.length === 0 && !showContent && <li className="palette__empty">没有标题包含「{query.trim()}」的任务</li>}
        {showContent && hits.length === 0 && (
          <li className="palette__empty" role="presentation">
            {content.searching ? "正在搜索对话内容…" : content.failed ? "内容搜索暂时不可用" : results.length === 0 ? `没有找到「${query.trim()}」` : "对话内容里没有更多匹配"}
          </li>
        )}
      </ul>
    </Modal>
  );
}
