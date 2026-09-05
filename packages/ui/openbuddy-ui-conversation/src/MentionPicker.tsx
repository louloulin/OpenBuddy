/**
 * R1 - @-mention picker (Codex / Cursor-style).
 *
 * Opens when the user types `@` at the start of a token in the Composer.
 * Shows the top workspace matches (files / folders) returned by the
 * `workspaceSearch` IPC. The user can:
 *   - arrow keys to navigate
 *   - Enter / Tab to insert the selection as `@<path>` and continue typing
 *   - Esc to dismiss
 *
 * The component is presentation-only: it receives the trigger character
 * position, the current query (the text after the @), and a callback for
 * when a result is selected. The Composer owns the textarea state.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTextIcon, FolderIcon, AtIcon } from "@openbuddy/ui-primitives/icons";
import { workspaceSearch, type OpenBuddyWorkspaceHit } from "@/lib/agent/pi-client";

export interface MentionPickerProps {
  open: boolean;
  /** Current text after the `@` trigger, including any prefix the user has typed. */
  query: string;
  /** Workspace root to search within. */
  cwd: string;
  /** Position the picker should anchor to (textarea-relative). */
  anchor?: { top: number; left: number };
  onSelect: (hit: OpenBuddyWorkspaceHit) => void;
  onDismiss: () => void;
}

export const MentionPicker = memo(function MentionPicker({
  open,
  query,
  cwd,
  anchor,
  onSelect,
  onDismiss,
}: MentionPickerProps) {
  const [hits, setHits] = useState<OpenBuddyWorkspaceHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Re-fetch when query or cwd changes
  useEffect(() => {
    if (!open || !cwd) {
      setHits([]);
      return;
    }
    const ticket = ++reqRef.current;
    setLoading(true);
    void workspaceSearch(query, cwd, { limit: 30 })
      .then((res) => {
        if (ticket !== reqRef.current) return; // stale
        setHits(res.hits);
        setActiveIndex(0);
        setLoading(false);
      })
      .catch(() => {
        if (ticket !== reqRef.current) return;
        setHits([]);
        setLoading(false);
      });
  }, [open, query, cwd]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setHits([]);
      setActiveIndex(0);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (hits.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % hits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + hits.length) % hits.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const hit = hits[activeIndex];
        if (hit) onSelect(hit);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    },
    [hits, activeIndex, onSelect, onDismiss],
  );

  // Expose keydown to the parent composer via a callback ref. The composer
  // attaches a window-level keydown that delegates to this function when
  // the picker is open.
  useEffect(() => {
    if (!open) return;
    (window as Window & { __openbuddyMentionKeyDown?: (e: KeyboardEvent) => void }).__openbuddyMentionKeyDown = (e) => handleKeyDown(e as unknown as React.KeyboardEvent);
    return () => {
      delete (window as Window & { __openbuddyMentionKeyDown?: (e: KeyboardEvent) => void }).__openbuddyMentionKeyDown;
    };
  }, [open, handleKeyDown]);

  // Scroll the active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchor) return { display: "none" };
    return {
      position: "absolute",
      top: anchor.top,
      left: anchor.left,
    };
  }, [anchor]);

  if (!open) return null;

  return (
    <div className="mention-picker" style={style} role="listbox" aria-label="工作空间搜索">
      <div className="mention-picker__header">
        <span className="mention-picker__icon" aria-hidden="true">
          <AtIcon size="sm" />
        </span>
        <span className="mention-picker__query">
          {query || "搜索文件 / 文件夹"}
        </span>
        {loading && <span className="mention-picker__loading">搜索中…</span>}
      </div>
      <div className="mention-picker__list" ref={listRef}>
        {hits.length === 0 && !loading && (
          <div className="mention-picker__empty">没有匹配项</div>
        )}
        {hits.map((hit, i) => (
          <button
            key={hit.absPath}
            type="button"
            data-idx={i}
            role="option"
            aria-selected={i === activeIndex}
            className={
              "mention-picker__item" + (i === activeIndex ? " mention-picker__item--active" : "")
            }
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => onSelect(hit)}
          >
            <span className="mention-picker__kind-icon" aria-hidden="true">
              {hit.kind === "folder" ? <FolderIcon size="sm" /> : <FileTextIcon size="sm" />}
            </span>
            <span className="mention-picker__path">{hit.path}</span>
            <span className="mention-picker__kind">{hit.kind}</span>
          </button>
        ))}
      </div>
      <div className="mention-picker__footer">
        <span><kbd>↑↓</kbd> 切换</span>
        <span><kbd>Enter</kbd> 选择</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>
    </div>
  );
});
