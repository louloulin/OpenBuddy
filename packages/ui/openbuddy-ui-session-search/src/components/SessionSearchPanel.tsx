/**
 * SessionSearchPanel — search across all sessions via host-core session.search.
 *
 * Phase 2 / C8. Mirrors PI-Desktop `apps/desktop/components/SessionSearchPanel.tsx`:
 *   - debounced input (200ms)
 *   - keyboard navigation (Up/Down arrows + Enter to open hit)
 *   - empty state with helpful copy
 *   - loading state via the slot
 *   - hits grouped by session; selecting a hit resolves to a sessionId+lineNo
 *
 * The panel renders into a slot provided by the host shell. The host passes
 * `onOpen` so we can deep-link into the conversation viewer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SearchHit, SearchResult, SessionSearchClient } from "../client.js";
import { SessionSearchEmpty } from "./SessionSearchEmpty.js";
import { SessionSearchHit } from "./SessionSearchHit.js";
import { SessionSearchInput } from "./SessionSearchInput.js";
import styles from "./SessionSearchPanel.module.css";

export interface SessionSearchPanelProps {
  client: SessionSearchClient;
  onOpen?: (hit: SearchHit) => void;
  /** Max results to display (default 50, matches host-core default). */
  maxResults?: number;
  /** Debounce ms for the input (default 200). */
  debounceMs?: number;
  /** Test hook: disable auto-focus. */
  autoFocus?: boolean;
  /** Test hook: render only the input. */
  inputOnly?: boolean;
  className?: string;
  labels?: Partial<SessionSearchPanelLabels>;
}

export interface SessionSearchPanelLabels {
  title: string;
  placeholder: string;
  emptyHint: string;
  totalLabel: string;
  noResultsLabel: string;
  loadingLabel: string;
  errorLabel: string;
}

const DEFAULT_LABELS: SessionSearchPanelLabels = {
  title: "Search sessions",
  placeholder: "Search across all sessions…",
  emptyHint: "Try a keyword, command name, or error message.",
  totalLabel: "results",
  noResultsLabel: "No matches.",
  loadingLabel: "Searching…",
  errorLabel: "Search failed.",
};

export function SessionSearchPanel(props: SessionSearchPanelProps) {
  const {
    client,
    onOpen,
    maxResults = 50,
    debounceMs = 200,
    autoFocus = true,
    inputOnly = false,
    className,
    labels: labelsProp,
  } = props;
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...(labelsProp ?? {}) }), [labelsProp]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [result, setResult] = useState<SearchResult>({ hits: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce query input.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  // Run the search.
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResult({ hits: [], total: 0 });
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    client
      .search(debouncedQuery, maxResults)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setResult(res);
        setActiveIndex(0);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(String((err as Error)?.message ?? err));
        setResult({ hits: [], total: 0 });
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [debouncedQuery, client, maxResults]);

  // Keyboard navigation.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, result.hits.length - 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "Enter" && result.hits[activeIndex]) {
        event.preventDefault();
        onOpen?.(result.hits[activeIndex]);
      } else if (event.key === "Escape") {
        setQuery("");
      }
    },
    [result.hits, activeIndex, onOpen],
  );

  return (
    <div
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-testid="session-search-panel"
      data-loading={loading || undefined}
      data-empty={!loading && result.hits.length === 0 && debouncedQuery ? "true" : undefined}
      onKeyDown={handleKeyDown}
    >
      <SessionSearchInput
        value={query}
        onChange={setQuery}
        placeholder={labels.placeholder}
        title={labels.title}
        autoFocus={autoFocus}
      />
      {inputOnly ? null : (
        <div className={styles.results} data-testid="session-search-results">
          {loading ? (
            <div className={styles.status} data-testid="session-search-loading">
              {labels.loadingLabel}
            </div>
          ) : error ? (
            <div className={styles.statusError} data-testid="session-search-error">
              {labels.errorLabel} {error}
            </div>
          ) : result.hits.length === 0 ? (
            debouncedQuery.trim() ? (
              <SessionSearchEmpty message={labels.noResultsLabel} hint={labels.emptyHint} />
            ) : (
              <SessionSearchEmpty message={labels.placeholder} hint={labels.emptyHint} />
            )
          ) : (
            <>
              <div className={styles.meta} data-testid="session-search-meta">
                {result.total} {labels.totalLabel}
              </div>
              <ul className={styles.list} role="listbox">
                {result.hits.map((hit, idx) => (
                  <SessionSearchHit
                    key={`${hit.sessionId}:${hit.lineNo}`}
                    hit={hit}
                    query={debouncedQuery}
                    active={idx === activeIndex}
                    onSelect={() => onOpen?.(hit)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
