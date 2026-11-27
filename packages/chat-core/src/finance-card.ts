/**
 * 投研数据卡识别 (20261126-upup UP-5.1 / 20261127-upup U5)。
 *
 * UpUp 的数据工具都遵守同一个「来源信封」契约（upup `pi-runtime/src/tool-output-contract.ts`）：
 * 结果的 `details` 带 `auditId`、as-of 时间和至少一个来源字段（`evidence` / `source` / `provider`），
 * 正文是 `JSON.stringify(value)`。这里只认这个信封：没有 as-of 或来源的结果一律不出卡，
 * 免得把缓存快照或模型编的数字包装成「数据」。
 *
 * 纯函数：输入工具调用视图，输出卡片数据；UI 只负责渲染。
 */
import type { ToolCallView } from "./transcript";

export type FinanceCardKind = "quote" | "valuation" | "risk" | "data";
/** 涨跌方向；A 股习惯红涨绿跌，颜色由 UI 决定。 */
export type FinanceTone = "up" | "down" | "flat";

export interface FinanceCardRow {
  key: string;
  label: string;
  value: string;
  tone?: FinanceTone;
}

export interface FinanceCard {
  toolCallId: string;
  toolName: string;
  kind: FinanceCardKind;
  /** 标的或工具名，作为卡片标题。 */
  title: string;
  asOf: string;
  /** 来源徽标（provider 优先，其次 evidence.source / source）。 */
  source: string;
  /** live / delayed / cached …（evidence.dataFreshness）。 */
  freshness?: string;
  /** 键值行（对象结果）。 */
  rows: FinanceCardRow[];
  /** 表格（数组结果）：列名与每行的单元格。 */
  table?: { columns: string[]; rows: string[][]; total: number };
}

const MAX_ROWS = 12;
const MAX_COLUMNS = 6;
const MAX_TABLE_ROWS = 10;

const LABELS: Record<string, string> = {
  symbol: "代码",
  name: "名称",
  market: "市场",
  price: "价格",
  last: "最新价",
  close: "收盘",
  open: "开盘",
  high: "最高",
  low: "最低",
  bid: "买一",
  ask: "卖一",
  change: "涨跌",
  changepct: "涨跌幅",
  pctchange: "涨跌幅",
  changepercent: "涨跌幅",
  volume: "成交量",
  amount: "成交额",
  turnover: "成交额",
  currency: "币种",
  pettm: "市盈率 TTM",
  pe: "市盈率",
  pb: "市净率",
  pricetobook: "市净率",
  ps: "市销率",
  pcf: "市现率",
  marketcap: "市值",
  bookvaluepershare: "每股净资产",
  eps: "每股收益",
  roe: "ROE",
  dividendyield: "股息率",
  volatility: "波动率",
  annualizedvolatility: "年化波动率",
  maxdrawdown: "最大回撤",
  sharpe: "夏普比率",
  sharperatio: "夏普比率",
  beta: "Beta",
  var: "VaR",
  cvar: "CVaR",
  return: "收益率",
  totalreturn: "累计收益",
  annualizedreturn: "年化收益",
  date: "日期",
};

/** 这些字段的正负号就是涨跌方向。 */
const SIGNED = /^(change|changepct|pctchange|changepercent|return|totalreturn|annualizedreturn|pnl|profit)$/;
/** 不出现在卡片正文里的元数据（已在卡头展示或无业务意义）。 */
const HIDDEN = /^(asof|source|provider|freshness|datafreshness|auditid|evidence|indicative|retrievedat|query|id|policy)$/;

const norm = (key: string) => key.replace(/[_\s-]/g, "").toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** 工具名 → 卡片类别。 */
export function financeCardKind(toolName: string): FinanceCardKind {
  const name = toolName.toLowerCase();
  if (/quote|price|snapshot|ticker/.test(name)) return "quote";
  if (/valuation|ratio|dcf|multiple|pe_|_pe\b|pb_/.test(name)) return "valuation";
  if (/risk|var\b|drawdown|volatil|stress|beta/.test(name)) return "risk";
  return "data";
}

export const FINANCE_KIND_LABEL: Record<FinanceCardKind, string> = {
  quote: "行情",
  valuation: "估值",
  risk: "风险",
  data: "数据",
};

/** 固定免责声明：数据卡永远带这句话。 */
export const FINANCE_DISCLAIMER = "数据来自第三方数据源，仅供研究参考，不构成投资建议。";

function formatValue(value: unknown, key: string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
    const fixed = Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 1 ? 4 : 2);
    // 只有明确是「百分比数值」的字段才加 %；比率类（0.12）原样显示，避免把 12% 写成 0.12%。
    return /^(changepct|pctchange|changepercent)$/.test(key) ? `${fixed}%` : fixed;
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  return JSON.stringify(value).slice(0, 80);
}

function toneOf(value: unknown, key: string): FinanceTone | undefined {
  if (!SIGNED.test(key)) return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

/** 来源信封：返回 {asOf, source, freshness}；不满足契约返回 null。 */
export function provenanceOf(details: unknown): { asOf: string; source: string; freshness?: string } | null {
  if (!isRecord(details) || details.auditId === undefined) return null;
  const evidence = details.evidence;
  const first = Array.isArray(evidence) ? (isRecord(evidence[0]) ? evidence[0] : undefined) : isRecord(evidence) ? evidence : undefined;
  const asOf = typeof details.asOf === "string" ? details.asOf : typeof first?.asOf === "string" ? first.asOf : undefined;
  if (!asOf) return null;
  const pick = (value: unknown) => (typeof value === "string" && value.trim() && value !== "native-provider" ? value.trim() : undefined);
  const source =
    pick(details.provider) ?? pick(first?.provider) ?? pick(first?.source) ?? pick(details.source) ??
    (typeof details.source === "string" ? details.source : undefined);
  if (!source) return null;
  const freshness = typeof details.dataFreshness === "string" ? details.dataFreshness : typeof first?.dataFreshness === "string" ? first.dataFreshness : undefined;
  return { asOf, source, ...(freshness ? { freshness } : {}) };
}

/**
 * 取第一段能解析成 JSON 的文本。实测 UpUp 会在 JSON 之后再附一段说明文字
 * （如弃用提示），所以不能把所有文本拼起来再解析。
 */
function parsePayload(tc: ToolCallView): unknown {
  for (const c of tc.content) {
    if (c.type !== "text") continue;
    const text = c.text.trim();
    if (!/^[[{]/.test(text)) continue;
    try {
      return JSON.parse(text);
    } catch {
      /* 试下一段 */
    }
  }
  return undefined;
}

function rowsOf(value: Record<string, unknown>): FinanceCardRow[] {
  const rows: FinanceCardRow[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const k = norm(key);
    if (HIDDEN.test(k) || isRecord(raw) || Array.isArray(raw)) continue;
    rows.push({ key, label: LABELS[k] ?? key, value: formatValue(raw, k), ...(toneOf(raw, k) ? { tone: toneOf(raw, k) } : {}) });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

function tableOf(items: unknown[]): FinanceCard["table"] | undefined {
  const records = items.filter(isRecord);
  if (!records.length) return undefined;
  const columns = Object.keys(records[0]!).filter((key) => !HIDDEN.test(norm(key)) && !isRecord(records[0]![key])).slice(0, MAX_COLUMNS);
  if (!columns.length) return undefined;
  return {
    columns: columns.map((key) => LABELS[norm(key)] ?? key),
    rows: records.slice(0, MAX_TABLE_ROWS).map((record) => columns.map((key) => formatValue(record[key], norm(key)))),
    total: records.length,
  };
}

/** 识别一个工具调用是否是 UpUp 风格的数据结果；不是返回 null。 */
export function detectFinanceCard(tc: ToolCallView): FinanceCard | null {
  if (tc.status !== "completed") return null;
  const provenance = provenanceOf(tc.details);
  if (!provenance) return null;
  const payload = parsePayload(tc);
  const kind = financeCardKind(tc.kind || tc.title);
  const base = { toolCallId: tc.toolCallId, toolName: tc.kind || tc.title, kind, ...provenance };
  if (Array.isArray(payload)) {
    const table = tableOf(payload);
    if (!table) return null;
    return { ...base, title: base.toolName, rows: [], table };
  }
  if (!isRecord(payload)) return null;
  // `{bars:[…]}` / `{items:[…]}` 之类：对象里唯一的数组当表格，其余字段当键值行。
  const nested = Object.values(payload).find((v) => Array.isArray(v) && v.some(isRecord)) as unknown[] | undefined;
  const rows = rowsOf(payload);
  const table = nested ? tableOf(nested) : undefined;
  if (!rows.length && !table) return null;
  const symbol = typeof payload.symbol === "string" ? payload.symbol : typeof payload.name === "string" ? payload.name : undefined;
  return { ...base, title: symbol ?? base.toolName, rows, ...(table ? { table } : {}) };
}

/** 一轮里所有数据卡（按出现顺序，同一工具调用只出一张）。 */
export function financeCardsOf(toolCalls: ToolCallView[], max = 4): FinanceCard[] {
  const cards: FinanceCard[] = [];
  const seen = new Set<string>();
  for (const tc of toolCalls) {
    if (seen.has(tc.toolCallId)) continue;
    const card = detectFinanceCard(tc);
    if (!card) continue;
    seen.add(tc.toolCallId);
    cards.push(card);
    if (cards.length >= max) break;
  }
  return cards;
}

/** 卡片转 Markdown（复制 / 写报告用），带来源、as-of 和免责声明。 */
export function financeCardMarkdown(card: FinanceCard): string {
  const lines = [`### ${FINANCE_KIND_LABEL[card.kind]} · ${card.title}`, "", `来源：${card.source} · 截至 ${card.asOf}${card.freshness ? ` · ${card.freshness}` : ""}`, ""];
  if (card.rows.length) {
    lines.push("| 指标 | 数值 |", "|---|---|", ...card.rows.map((row) => `| ${row.label} | ${row.value} |`), "");
  }
  if (card.table) {
    lines.push(`| ${card.table.columns.join(" | ")} |`, `|${card.table.columns.map(() => "---").join("|")}|`, ...card.table.rows.map((row) => `| ${row.join(" | ")} |`), "");
  }
  lines.push(`> ${FINANCE_DISCLAIMER}`);
  return lines.join("\n");
}
