import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Clock, FileText } from "lucide-react";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";
import { sessionSearch } from "@openbuddy/client/agent-client";
import type { SessionSummary } from "@openbuddy/protocol/dto";
import type { SearchMatchRange, SessionSearchHit } from "@openbuddy/protocol/search";

/** A search snippet with its matched ranges wrapped in <mark> (pii W1.4; no HTML injection). */
export function HighlightedSnippet({ snippet, matches, className }: { snippet: string; matches: readonly SearchMatchRange[]; className?: string }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of matches) {
    if (start < at || end > snippet.length || end <= start) continue;
    if (start > at) parts.push(snippet.slice(at, start));
    parts.push(<mark key={start} className="search-hit__mark">{snippet.slice(start, end)}</mark>);
    at = end;
  }
  if (at < snippet.length) parts.push(snippet.slice(at));
  return <span className={className}>{parts}</span>;
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** One full-text hit: title, highlighted snippet, workspace — shared by this overlay and the Ctrl/Cmd+K palette. */
export function ContentHitBody({ hit, meta }: { hit: Pick<SessionSearchHit, "title" | "sessionId" | "snippet" | "matches" | "cwd" | "archived">; meta?: React.ReactNode }) {
  return (
    <div className="conversation-search-modal__item-body">
      <div className="conversation-search-modal__item-title">
        {hit.title || hit.sessionId.slice(0, 8)}
        {hit.archived && <span className="search-hit__tag">已归档</span>}
      </div>
      {hit.snippet && <HighlightedSnippet className="conversation-search-modal__item-snippet" snippet={hit.snippet} matches={hit.matches ?? []} />}
      <div className="conversation-search-modal__item-cwd">
        {hit.cwd ? <span title={hit.cwd}>{baseName(hit.cwd)}</span> : null}
        {meta}
      </div>
    </div>
  );
}


export function SearchOverlay({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (sessionId: string, cwd?: string) => void;
}) {
  // Two-section model: there is no single flat list anymore. For local title
  // matching we flatten whatever the sidebar currently holds (independent +
  // any expanded 空间 node caches). Cross-cwd content search still goes via
  const independent = useSessionsStore((s) => s.independent);
  const workspaceSessions = useSessionsStore((s) => s.workspaceSessions);
  const sessions = useMemo<SessionSummary[]>(
    () => [...independent, ...Object.values(workspaceSessions).flat()],
    [independent, workspaceSessions],
  );
  const [query, setQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<SessionSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemoteHits([]);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced remote search. Only kicks in for queries ≥ 2 chars.
  const runRemoteSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setRemoteHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const hits = await sessionSearch(q.trim(), undefined, 30);
      setRemoteHits(hits);
    } catch {
      setRemoteHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runRemoteSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runRemoteSearch]);

  // Local title matches (always computed, instant).
  const localMatches: SessionSummary[] = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  })();

  // Dedupe: remote hits whose sessionId already appears in localMatches are
  // shown only once (in the remote section, which has the snippet).
  const localIds = new Set(localMatches.map((s) => s.sessionId));
  const remoteOnly = remoteHits.filter((h) => !localIds.has(h.sessionId));

  if (!open) return null;

  return (
    <div
      className="conversation-search-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="搜索会话"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="conversation-search-modal">
        <div className="conversation-search-modal__input-wrapper">
          <Search size={16} strokeWidth={1.75} className="conversation-search-modal__icon" />
          <input
            ref={inputRef}
            className="conversation-search-modal__input"
            placeholder="搜索会话标题或内容…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <span className="conversation-search-modal__spinner">搜索中…</span>
          )}
          <button
            className="conversation-search-modal__close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="conversation-search-modal__body">
          {localMatches.length > 0 && (
            <>
              <div className="conversation-search-modal__count">
                本地会话 ({localMatches.length})
              </div>
              <ul className="conversation-search-modal__list">
                {localMatches.slice(0, 30).map((s) => (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      className="conversation-search-modal__item"
                      onClick={() => {
                        onSelect(s.sessionId, s.cwd);
                        onClose();
                      }}
                      title={s.title}
                    >
                      <Clock
                        size={14}
                        strokeWidth={1.75}
                        className="conversation-search-modal__item-icon"
                      />
                      <span className="conversation-search-modal__item-title">
                        {s.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {remoteOnly.length > 0 && (
            <>
              <div className="conversation-search-modal__count">
                全文检索结果 ({remoteOnly.length})
              </div>
              <ul className="conversation-search-modal__list">
                {remoteOnly.map((h) => (
                  <li key={h.sessionId}>
                    <button
                      type="button"
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
                      onClick={() => {
                        onSelect(h.sessionId, h.cwd);
                        onClose();
                      }}
                      title={h.cwd ?? h.sessionId}
                    >
                      <FileText
                        size={14}
                        strokeWidth={1.75}
                        className="conversation-search-modal__item-icon"
                      />
                      <ContentHitBody hit={h} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!searching &&
            localMatches.length === 0 &&
            remoteOnly.length === 0 &&
            query.trim().length > 0 && (
              <div className="conversation-search-modal__empty">
                没有匹配的会话
              </div>
            )}
          {!searching &&
            localMatches.length === 0 &&
            remoteOnly.length === 0 &&
            query.trim().length === 0 && (
              <div className="conversation-search-modal__count">
                输入关键词搜索会话内容（全文检索）
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
