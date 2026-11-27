import { describe, expect, it } from "vitest";
import { detectFinanceCard, financeCardKind, financeCardMarkdown, financeCardsOf, provenanceOf, FINANCE_DISCLAIMER } from "../finance-card";
import type { ToolCallView } from "../transcript";

/** 形状取自 UpUp `market_data_quote` 的真实返回（pi-market-data/extensions/index.ts）。 */
const quote = (over: Partial<ToolCallView> = {}): ToolCallView => ({
  toolCallId: "call-quote",
  title: "market_data_quote",
  kind: "market_data_quote",
  status: "completed",
  content: [{ type: "text", text: JSON.stringify({ symbol: "600519.SH", market: "CN", price: 1520.5, currency: "CNY", asOf: "2026-11-14", source: "eastmoney", freshness: "live", bid: 1520.1, ask: 1520.6, last: 1520.5, indicative: false, peTTM: 22.35, priceToBook: 7.81, changePct: -1.24 }) }],
  details: {
    evidence: [{ asOf: "2026-11-14", source: "eastmoney", dataFreshness: "live" }],
    dataFreshness: "live",
    asOf: "2026-11-14",
    provider: "eastmoney",
    auditId: "call-quote",
    source: "native-provider",
  },
  ...over,
});

describe("UpUp 数据卡识别 (UP-5.1)", () => {
  it("行情结果出卡：标题是代码，来源/截至/新鲜度来自信封", () => {
    const card = detectFinanceCard(quote())!;
    expect(card).toMatchObject({ kind: "quote", title: "600519.SH", source: "eastmoney", asOf: "2026-11-14", freshness: "live" });
    expect(card.rows.find((row) => row.key === "price")).toMatchObject({ label: "价格", value: "1520.50" });
    expect(card.rows.find((row) => row.key === "peTTM")?.label).toBe("市盈率 TTM");
    // 元数据不进正文
    expect(card.rows.map((row) => row.key)).not.toContain("asOf");
    expect(card.rows.map((row) => row.key)).not.toContain("indicative");
  });

  it("涨跌字段带方向（UI 红涨绿跌）", () => {
    const card = detectFinanceCard(quote())!;
    expect(card.rows.find((row) => row.key === "changePct")).toMatchObject({ tone: "down", value: "-1.24%" });
  });

  it("缺 as-of 或来源（违反 UpUp 输出契约）的结果不出卡", () => {
    expect(detectFinanceCard(quote({ details: { auditId: "x", source: "native-provider" } }))).toBeNull();
    expect(detectFinanceCard(quote({ details: { auditId: "x", asOf: "2026-11-14" } }))).toBeNull();
    expect(detectFinanceCard(quote({ details: undefined }))).toBeNull();
  });

  it("失败/进行中的调用、非 JSON 正文都不出卡", () => {
    expect(detectFinanceCard(quote({ status: "failed" }))).toBeNull();
    expect(detectFinanceCard(quote({ status: "in_progress" }))).toBeNull();
    expect(detectFinanceCard(quote({ content: [{ type: "text", text: "Market quote request aborted" }] }))).toBeNull();
  });

  it("JSON 后面附加说明文字时仍能识别（实测 UpUp 会追加弃用提示）", () => {
    const tc = quote();
    const card = detectFinanceCard({ ...tc, content: [...tc.content, { type: "text", text: "Deprecated: use market_data_snapshot" }] });
    expect(card?.title).toBe("600519.SH");
  });

  it("evidence 数组里的 asOf 也认（契约第 2 分支）", () => {
    expect(provenanceOf({ auditId: "a", evidence: [{ asOf: "2026-11-01", source: "tushare" }] })).toEqual({ asOf: "2026-11-01", source: "tushare" });
  });

  it("数组/嵌套数组结果渲染成表格，最多 10 行", () => {
    const bars = Array.from({ length: 15 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, open: 10 + i, close: 11 + i, volume: 1000 }));
    const card = detectFinanceCard(quote({ kind: "market_data_history", title: "market_data_history", content: [{ type: "text", text: JSON.stringify({ symbol: "000001.SZ", bars }) }] }))!;
    expect(card.table?.columns).toEqual(["日期", "开盘", "收盘", "成交量"]);
    expect(card.table?.rows).toHaveLength(10);
    expect(card.table?.total).toBe(15);
  });

  it("按工具名归类：行情 / 估值 / 风险 / 数据", () => {
    expect(financeCardKind("market_data_quote")).toBe("quote");
    expect(financeCardKind("valuation_ratios")).toBe("valuation");
    expect(financeCardKind("dcf_model")).toBe("valuation");
    expect(financeCardKind("risk_metrics")).toBe("risk");
    expect(financeCardKind("get_financials")).toBe("data");
  });

  it("一轮里去重并限量；普通工具调用被忽略", () => {
    const plain: ToolCallView = { toolCallId: "r", title: "read", kind: "read", status: "completed", content: [{ type: "text", text: "{}" }] };
    const cards = financeCardsOf([quote(), quote(), plain, quote({ toolCallId: "b" })]);
    expect(cards.map((card) => card.toolCallId)).toEqual(["call-quote", "b"]);
  });

  it("Markdown 导出带来源、截至时间和固定免责声明", () => {
    const md = financeCardMarkdown(detectFinanceCard(quote())!);
    expect(md).toContain("### 行情 · 600519.SH");
    expect(md).toContain("来源：eastmoney · 截至 2026-11-14");
    expect(md).toContain("| 价格 | 1520.50 |");
    expect(md).toContain(FINANCE_DISCLAIMER);
  });
});
