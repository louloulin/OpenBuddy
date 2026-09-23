import { useMemo } from "react";
import type { SearchHit } from "../client.js";
import styles from "./SessionSearchHit.module.css";

export interface SessionSearchHitProps {
  hit: SearchHit;
  query: string;
  active?: boolean;
  onSelect?: () => void;
}

export function SessionSearchHit({ hit, query, active, onSelect }: SessionSearchHitProps) {
  const highlighted = useMemo(() => highlight(hit.snippet, query), [hit.snippet, query]);
  return (
    <li
      role="option"
      aria-selected={active || undefined}
      data-testid="session-search-hit"
      data-active={active ? "true" : undefined}
      className={[styles.row, active ? styles.active : ""].filter(Boolean).join(" ")}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      tabIndex={0}
    >
      <div className={styles.title}>{hit.title ?? hit.sessionId}</div>
      <div className={styles.snippet}>{highlighted}</div>
      <div className={styles.meta}>
        <span className={styles.sessionId}>{hit.sessionId}</span>
        <span className={styles.lineNo}>L{hit.lineNo}</span>
        {hit.matchedAt ? <span className={styles.timestamp}>{hit.matchedAt}</span> : null}
      </div>
    </li>
  );
}

/** Highlight query matches with `<mark>` tags; case-insensitive. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.mark}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
