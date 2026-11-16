/**
 * 用量 (pii W5.6) wire types: per-session token / cost totals aggregated in the host, so the
 * renderer no longer keeps its own localStorage ledger.
 */

export interface UsageSessionEntry {
  sessionId: string;
  /** Sidebar title at the time of the last turn (optional). */
  title?: string;
  cwd: string;
  /** ISO time of the last recorded turn. */
  at: string;
  /** `provider/model`. */
  modelKey?: string;
  /** Bound expert name, when the session ran under one. */
  expertName?: string;
  tokens: { input: number; output: number; total: number };
  cost: number;
  toolCalls: number;
}

export interface UsageBucket {
  tokens: number;
  cost: number;
  sessions: number;
}

export interface UsageSnapshot {
  generatedAt: string;
  totals: { tokens: number; prompt: number; completion: number; cost: number; sessions: number };
  /** YYYY-MM-DD → totals of the sessions whose last turn was that day. */
  byDate: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  byExpert: Record<string, UsageBucket>;
  sessions: UsageSessionEntry[];
}
