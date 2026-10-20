/**
 * P1.4 授权审计面板 — 共享类型 + 纯过滤/统计函数。
 *
 * 全部为平台无关的纯函数 + 类型,可被任意 UI 包复用:
 *   - `filterAuditEvents(events, filters)`:按多维过滤
 *   - `summarizeAuditEvents(events)`:统计计数
 *   - `formatAuditAt(iso)`:本地化时间
 *   - `formatAuditDetail(detail)`:JSON.stringify 友好版本
 *
 * 组件本身不直接调 IPC,由调用方注入 `onLoad / onExport / onClear`
 * 回调(单测中注入 vi.fn 即可)。
 */

export type AuditOutcome = "allow" | "deny" | "success" | "failure" | "info";
export type AuditSource = "renderer" | "main" | "ipc" | "plugin" | "casdoor";

export interface AuditEvent {
  id: string;
  at: string;
  event: string;
  outcome: AuditOutcome;
  source: AuditSource;
  subject?: string;
  detail?: Record<string, unknown>;
  hash?: string;
}

export interface AuditFilters {
  /** 按 source 过滤(空集合 = 不过滤)。 */
  sources: ReadonlyArray<AuditSource>;
  /** 按 outcome 过滤(空集合 = 不过滤)。 */
  outcomes: ReadonlyArray<AuditOutcome>;
  /** event 名称子串匹配(大小写不敏感,空字符串 = 不过滤)。 */
  eventQuery: string;
  /** subject 子串匹配(大小写不敏感,空字符串 = 不过滤)。 */
  subjectQuery: string;
  /** 起止 ISO 时间(任一为空 = 不限制)。 */
  fromIso?: string;
  toIso?: string;
}

export const AUDIT_OUTCOMES: readonly AuditOutcome[] = ["allow", "deny", "success", "failure", "info"];
export const AUDIT_SOURCES: readonly AuditSource[] = ["renderer", "main", "ipc", "plugin", "casdoor"];

export const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  allow: "允许",
  deny: "拒绝",
  success: "成功",
  failure: "失败",
  info: "信息",
};

export const SOURCE_LABEL: Record<AuditSource, string> = {
  renderer: "渲染层",
  main: "主进程",
  ipc: "IPC",
  plugin: "插件",
  casdoor: "Casdoor",
};

export const EMPTY_FILTERS: AuditFilters = {
  sources: [],
  outcomes: [],
  eventQuery: "",
  subjectQuery: "",
};

/**
 * 多维过滤 audit events。
 *
 * 设计:
 *   - 空数组/空字符串 视为「不过滤」(便于 caller 构造 filters)
 *   - 大小写不敏感(查询类匹配)
 *   - 时间范围闭区间 [fromIso, toIso]
 *   - 复杂度 O(n),无索引(本地 ring buffer ≤ 1000 条,够用)
 */
export function filterAuditEvents(events: ReadonlyArray<AuditEvent>, filters: AuditFilters): AuditEvent[] {
  const sourceSet = new Set(filters.sources);
  const outcomeSet = new Set(filters.outcomes);
  const eventLower = filters.eventQuery.trim().toLowerCase();
  const subjectLower = filters.subjectQuery.trim().toLowerCase();
  const fromMs = filters.fromIso ? Date.parse(filters.fromIso) : Number.NEGATIVE_INFINITY;
  const toMs = filters.toIso ? Date.parse(filters.toIso) : Number.POSITIVE_INFINITY;
  const out: AuditEvent[] = [];
  for (const e of events) {
    if (sourceSet.size > 0 && !sourceSet.has(e.source)) continue;
    if (outcomeSet.size > 0 && !outcomeSet.has(e.outcome)) continue;
    if (eventLower && !e.event.toLowerCase().includes(eventLower)) continue;
    if (subjectLower && !(e.subject ?? "").toLowerCase().includes(subjectLower)) continue;
    const atMs = Date.parse(e.at);
    if (Number.isFinite(atMs)) {
      if (atMs < fromMs || atMs > toMs) continue;
    }
    out.push(e);
  }
  return out;
}

export interface AuditSummary {
  total: number;
  bySource: Record<AuditSource, number>;
  byOutcome: Record<AuditOutcome, number>;
}

/**
 * 统计总数 + 按 source / outcome 分桶。
 */
export function summarizeAuditEvents(events: ReadonlyArray<AuditEvent>): AuditSummary {
  const bySource = Object.fromEntries(AUDIT_SOURCES.map((s) => [s, 0])) as Record<AuditSource, number>;
  const byOutcome = Object.fromEntries(AUDIT_OUTCOMES.map((o) => [o, 0])) as Record<AuditOutcome, number>;
  for (const e of events) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
  }
  return { total: events.length, bySource, byOutcome };
}

/** ISO 时间 → 本地化字符串(YYYY-MM-DD HH:mm:ss,无时区后缀)。 */
export function formatAuditAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** detail 对象 → 单行字符串(供表格显示)。 */
export function formatAuditDetail(detail?: Record<string, unknown>): string {
  if (!detail) return "—";
  try {
    return JSON.stringify(detail);
  } catch {
    return "[unserializable]";
  }
}

/** 工厂函数:在 AuditFilters 上切换某个 source 是否被选中。 */
export function toggleSource(filters: AuditFilters, source: AuditSource): AuditFilters {
  const set = new Set(filters.sources);
  if (set.has(source)) set.delete(source);
  else set.add(source);
  return { ...filters, sources: Array.from(set) };
}

/** 工厂函数:在 AuditFilters 上切换某个 outcome 是否被选中。 */
export function toggleOutcome(filters: AuditFilters, outcome: AuditOutcome): AuditFilters {
  const set = new Set(filters.outcomes);
  if (set.has(outcome)) set.delete(outcome);
  else set.add(outcome);
  return { ...filters, outcomes: Array.from(set) };
}

/** 是否「无任何过滤」(用于决定是否显示「无匹配」占位文案)。 */
export function isFiltersEmpty(filters: AuditFilters): boolean {
  return filters.sources.length === 0
    && filters.outcomes.length === 0
    && filters.eventQuery.trim() === ""
    && filters.subjectQuery.trim() === ""
    && !filters.fromIso
    && !filters.toIso;
}
