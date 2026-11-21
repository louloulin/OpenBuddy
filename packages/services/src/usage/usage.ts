import { join } from "node:path";
import { JsonStore, type Settings } from "../settings/settings.js";
import type { UsageBucket, UsageCostSource, UsageEvent, UsageSessionEntry, UsageSnapshot } from "@openbuddy/protocol/usage";

interface UsageFile {
  /** sessionId → the session's latest cumulative stats (Pi's getSessionStats is cumulative). */
  sessions: Record<string, UsageSessionEntry>;
  /**
   * 追加式每回合事件 (compute use): 每回合写入一条增量，按日 / 按厂商的花费从这里算。
   * 旧文件没有 events，退回按 session 聚合（见 snapshot）。
   */
  events?: UsageEvent[];
}

/**
 * 用量 (20261116-pii W5.6): the host keeps one cumulative entry per session and aggregates on read.
 *
 * The renderer used to keep a localStorage ledger that nothing wrote to. This service is fed by the
 * engine on `agent_settled` (real `getSessionStats()`), so 用量统计 shows the same tokens and cost
 * the context ring does, across restarts, grouped by day / model / expert.
 *
 * compute use (20261121): the same feed now also appends one **delta** event per turn, so
 * 「今天花了多少」是按真实回合累加，而不是按「会话最后一次在哪天」猜。费用按来源分列：
 * 本地按定价表估算的记 `estimate`，上游网关报告的真账记 `gateway`，两者永不混算。
 */
export class UsageService {
  private store: JsonStore<UsageFile>;
  constructor(settings: Settings) {
    this.store = new JsonStore(join(settings.dir, "usage.json"), () => ({ sessions: {} }));
  }
  get path() {
    return this.store.path;
  }
  /** Record (or replace) one session's cumulative usage, appending the turn's delta. */
  record(entry: UsageSessionEntry) {
    const file = this.store.read();
    const previous = file.sessions[entry.sessionId];
    const events = file.events ?? (file.events = []);
    // Pi 的统计是会话累计值，事件存增量；首次记录时增量即累计值。
    const delta = {
      input: Math.max(0, entry.tokens.input - (previous?.tokens.input ?? 0)),
      output: Math.max(0, entry.tokens.output - (previous?.tokens.output ?? 0)),
      total: Math.max(0, entry.tokens.total - (previous?.tokens.total ?? 0)),
    };
    const cost = Math.max(0, entry.cost - (previous?.cost ?? 0));
    if (delta.total > 0 || delta.output > 0 || cost > 0)
      events.push({
        sessionId: entry.sessionId,
        at: entry.at,
        providerId: entry.providerId ?? providerOf(entry.modelKey),
        modelKey: entry.modelKey,
        expertName: entry.expertName,
        tokens: delta,
        cost,
        costSource: entry.costSource ?? "estimate",
      });
    file.sessions[entry.sessionId] = entry;
    this.store.write(file);
  }
  forget(sessionId: string) {
    const file = this.store.read();
    if (!(sessionId in file.sessions)) return;
    delete file.sessions[sessionId];
    if (file.events) file.events = file.events.filter((event) => event.sessionId !== sessionId);
    this.store.write(file);
  }
  /** 厂商归属：`provider/model` 的前缀；没有 modelKey 时按会话 id 归到 unknown。 */
  providerFor(sessionId: string): string {
    const entry = this.store.read().sessions[sessionId];
    return entry?.providerId ?? providerOf(entry?.modelKey) ?? "unknown";
  }
  /**
   * 某个厂商今日 / 本月的花费（美元，估算与权威费用都计入）。
   * 日 / 月口径沿用全仓库统一的 UTC ISO 分桶（与用量面板一致）。
   */
  providerSpend(providerId: string, now = new Date()): { todayUsd: number; monthUsd: number } {
    const file = this.store.read();
    const today = now.toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    let todayUsd = 0;
    let monthUsd = 0;
    const events = file.events ?? [];
    if (events.length) {
      for (const event of events) {
        if ((event.providerId ?? providerOf(event.modelKey) ?? "unknown") !== providerId) continue;
        const day = event.at.slice(0, 10);
        if (day === today) todayUsd += event.cost;
        if (day.startsWith(month)) monthUsd += event.cost;
      }
    } else {
      for (const entry of Object.values(file.sessions)) {
        if ((entry.providerId ?? providerOf(entry.modelKey) ?? "unknown") !== providerId) continue;
        const day = entry.at.slice(0, 10);
        if (day === today) todayUsd += entry.cost;
        if (day.startsWith(month)) monthUsd += entry.cost;
      }
    }
    return { todayUsd, monthUsd };
  }
  snapshot(): UsageSnapshot {
    const file = this.store.read();
    const entries = Object.values(file.sessions);
    const events = file.events ?? [];
    const totals = { tokens: 0, prompt: 0, completion: 0, cost: 0, sessions: entries.length };
    const byDate = new Buckets();
    const byModel = new Buckets();
    const byExpert = new Buckets();
    const byProvider = new Buckets();
    const cost = { estimated: 0, authoritative: 0 };
    type Row = {
      sessionId: string;
      at: string;
      providerId?: string;
      modelKey?: string;
      expertName?: string;
      tokens: { input: number; output: number; total: number };
      cost: number;
      costSource: UsageCostSource;
    };
    const account = (row: Row) => {
      totals.tokens += row.tokens.total;
      totals.prompt += row.tokens.input;
      totals.completion += row.tokens.output;
      totals.cost += row.cost;
      byDate.add(row.at.slice(0, 10), row.tokens.total, row.cost, row.sessionId);
      byProvider.add(row.providerId ?? "unknown", row.tokens.total, row.cost, row.sessionId);
      if (row.modelKey) byModel.add(row.modelKey, row.tokens.total, row.cost, row.sessionId);
      if (row.expertName) byExpert.add(`专家 · ${row.expertName}`, row.tokens.total, row.cost, row.sessionId);
      if (row.costSource === "gateway") cost.authoritative += row.cost;
      else cost.estimated += row.cost;
    };
    if (events.length) {
      // 有事件流：按每回合的增量聚合，日 / 厂商口径才准确。
      for (const event of events)
        account({
          sessionId: event.sessionId,
          at: event.at,
          providerId: event.providerId ?? providerOf(event.modelKey),
          modelKey: event.modelKey,
          expertName: event.expertName,
          tokens: event.tokens,
          cost: event.cost,
          costSource: event.costSource,
        });
    } else {
      // 旧文件（没有事件流）：退回到按 session 聚合，保持既有语义。
      for (const entry of entries)
        account({
          sessionId: entry.sessionId,
          at: entry.at,
          providerId: entry.providerId ?? providerOf(entry.modelKey),
          modelKey: entry.modelKey,
          expertName: entry.expertName,
          tokens: entry.tokens,
          cost: entry.cost,
          costSource: entry.costSource ?? "estimate",
        });
    }
    return {
      generatedAt: new Date().toISOString(),
      totals,
      byDate: byDate.toRecord(),
      byModel: byModel.toRecord(),
      byExpert: byExpert.toRecord(),
      byProvider: byProvider.toRecord(),
      cost,
      // Newest first: the panel lists recent sessions.
      sessions: entries.sort((a, b) => (a.at < b.at ? 1 : -1)),
    };
  }
}

/** 分桶累加器：token / 费用 / 去重会话数。 */
class Buckets {
  private readonly map: Record<string, UsageBucket> = {};
  private readonly seen = new Map<string, Set<string>>();
  add(key: string, tokens: number, cost: number, sessionId: string) {
    const current = (this.map[key] ??= { tokens: 0, cost: 0, sessions: 0 });
    current.tokens += tokens;
    current.cost += cost;
    const ids = this.seen.get(key) ?? new Set<string>();
    ids.add(sessionId);
    this.seen.set(key, ids);
    // sessions = 参与该分桶的去重会话数（事件流里一个会话会有多个回合）。
    current.sessions = ids.size;
  }
  toRecord(): Record<string, UsageBucket> {
    return this.map;
  }
}

/** `provider/model` → `provider`；没有前缀时返回 undefined。 */
function providerOf(modelKey?: string): string | undefined {
  if (!modelKey) return undefined;
  const slash = modelKey.indexOf("/");
  return slash > 0 ? modelKey.slice(0, slash) : undefined;
}
