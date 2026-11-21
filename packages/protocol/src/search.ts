/**
 * `session_search` (pii W1.4): full-text search over every saved session's messages.
 * The engine indexes `SessionManager.listAll()` message text and refreshes changed files by mtime.
 */
export interface SessionSearchRequest {
  /** Words to find; whitespace-separated terms must all appear (case-insensitive). */
  query: string;
  /** Only sessions started in this workspace. */
  cwd?: string | null;
  /** Maximum hits, 1–100 (default 20). */
  limit?: number | null;
}

/** [start, end) character range inside `SessionSearchHit.snippet`. */
export type SearchMatchRange = [number, number];

export interface SessionSearchHit {
  sessionId: string;
  cwd: string;
  title: string;
  /** A short excerpt around the first hit, whitespace collapsed; `…` marks cut ends. */
  snippet: string;
  /** Ranges of the matched terms inside `snippet`, sorted and non-overlapping. */
  matches: SearchMatchRange[];
  /** Whether the terms were found in the title, the messages or both. */
  matchedIn: 'title' | 'content' | 'both';
  /** Occurrences of the terms in the messages (capped). */
  matchCount: number;
  /** Higher is better. */
  rank: number;
  updatedAt: string;
  archived: boolean;
}
