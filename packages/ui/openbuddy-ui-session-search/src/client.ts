/**
 * Session search client — wraps the host-core `session.search` and
 * `session.message` JSON-RPC methods.
 *
 * The host-core lives in `crates/openbuddy-host-core/src/session_search/` and
 * is reached via the existing `@openbuddy/host-runtime` `HostProcess.call`.
 * We keep the client surface minimal so the UI components can depend on a
 * stable TS contract without caring about transport.
 */
export interface SearchHit {
  sessionId: string;
  title?: string;
  snippet: string;
  rank: number;
  lineNo: number;
  matchedAt?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

export interface MessageResult {
  sessionId: string;
  lineNo: number;
  role?: string;
  content: string;
  createdAt?: string;
}

export interface SessionSearchClient {
  search(query: string, maxResults?: number): Promise<SearchResult>;
  message(sessionId: string, lineNo: number): Promise<MessageResult>;
}

/** Default client that proxies to the host-core sidecar. */
export function createHostSessionSearchClient(call: <T>(method: string, params?: unknown) => Promise<T>): SessionSearchClient {
  return {
    async search(query, maxResults = 50) {
      const res = await call<SearchResult>("session.search", { query, maxResults });
      return res ?? { hits: [], total: 0 };
    },
    async message(sessionId, lineNo) {
      return await call<MessageResult>("session.message", { sessionId, lineNo });
    },
  };
}

/** In-memory client used in tests and as a dev fallback. */
export class InMemorySessionSearchClient implements SessionSearchClient {
  private readonly store = new Map<string, Array<{ lineNo: number; role?: string; content: string; createdAt?: string }>>();

  addSession(sessionId: string, lines: Array<{ role?: string; content: string }>): void {
    const existing = this.store.get(sessionId) ?? [];
    lines.forEach((line, idx) => {
      existing.push({
        lineNo: existing.length + 1,
        role: line.role,
        content: line.content,
      });
    });
    this.store.set(sessionId, existing);
  }

  async search(query: string, maxResults = 50): Promise<SearchResult> {
    if (!query.trim()) return { hits: [], total: 0 };
    const qLower = query.toLowerCase();
    const hits: SearchHit[] = [];
    let total = 0;
    for (const [sessionId, lines] of this.store.entries()) {
      for (const line of lines) {
        const occurrences = line.content.toLowerCase().split(qLower).length - 1;
        if (occurrences === 0) continue;
        total++;
        if (hits.length < maxResults) {
          const pos = line.content.toLowerCase().indexOf(qLower);
          const snippet = pos >= 0
            ? line.content.slice(Math.max(0, pos - 40), pos + qLower.length + 40)
            : line.content.slice(0, 80);
          hits.push({
            sessionId,
            lineNo: line.lineNo,
            snippet,
            rank: occurrences * 10,
            matchedAt: line.createdAt,
          });
        }
      }
    }
    hits.sort((a, b) => b.rank - a.rank);
    return { hits, total };
  }

  async message(sessionId: string, lineNo: number): Promise<MessageResult> {
    const lines = this.store.get(sessionId);
    const line = lines?.find((l) => l.lineNo === lineNo);
    if (!line) throw new Error(`session ${sessionId} line ${lineNo} not found`);
    const { lineNo: _lineNo, ...rest } = line;
    return { sessionId, lineNo, ...rest };
  }
}
