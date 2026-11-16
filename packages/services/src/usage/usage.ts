import { join } from "node:path";
import { JsonStore, type Settings } from "../settings/settings.js";
import type { UsageBucket, UsageSessionEntry, UsageSnapshot } from "@openbuddy/protocol/usage";

interface UsageFile {
  /** sessionId → the session's latest cumulative stats (Pi's getSessionStats is cumulative). */
  sessions: Record<string, UsageSessionEntry>;
}

/**
 * 用量 (20261116-pii W5.6): the host keeps one cumulative entry per session and aggregates on read.
 *
 * The renderer used to keep a localStorage ledger that nothing wrote to. This service is fed by the
 * engine on `agent_settled` (real `getSessionStats()`), so 用量统计 shows the same tokens and cost
 * the context ring does, across restarts, grouped by day / model / expert.
 */
export class UsageService {
  private store: JsonStore<UsageFile>;
  constructor(settings: Settings) {
    this.store = new JsonStore(join(settings.dir, "usage.json"), () => ({ sessions: {} }));
  }
  get path() {
    return this.store.path;
  }
  /** Record (or replace) one session's cumulative usage. */
  record(entry: UsageSessionEntry) {
    const file = this.store.read();
    file.sessions[entry.sessionId] = entry;
    this.store.write(file);
  }
  forget(sessionId: string) {
    const file = this.store.read();
    if (!(sessionId in file.sessions)) return;
    delete file.sessions[sessionId];
    this.store.write(file);
  }
  snapshot(): UsageSnapshot {
    const entries = Object.values(this.store.read().sessions);
    const totals = { tokens: 0, prompt: 0, completion: 0, cost: 0, sessions: entries.length };
    const byDate: Record<string, UsageBucket> = {};
    const byModel: Record<string, UsageBucket> = {};
    const byExpert: Record<string, UsageBucket> = {};
    const add = (bucket: Record<string, UsageBucket>, key: string, entry: UsageSessionEntry) => {
      const current = (bucket[key] ??= { tokens: 0, cost: 0, sessions: 0 });
      current.tokens += entry.tokens.total;
      current.cost += entry.cost;
      current.sessions += 1;
    };
    for (const entry of entries) {
      totals.tokens += entry.tokens.total;
      totals.prompt += entry.tokens.input;
      totals.completion += entry.tokens.output;
      totals.cost += entry.cost;
      add(byDate, entry.at.slice(0, 10), entry);
      if (entry.modelKey) add(byModel, entry.modelKey, entry);
      if (entry.expertName) add(byExpert, `专家 · ${entry.expertName}`, entry);
    }
    return {
      generatedAt: new Date().toISOString(),
      totals,
      byDate,
      byModel,
      byExpert,
      // Newest first: the panel lists recent sessions.
      sessions: entries.sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  }
}
