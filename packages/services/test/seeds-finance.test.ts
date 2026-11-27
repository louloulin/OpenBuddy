import { describe, expect, it } from "vitest";
import { FINANCE_SEEDS } from "../src/agents/seeds-finance";
import { EXPERT_CATEGORIES, EXPERT_SCENES, SEED_EXPERTS } from "../src/agents/seeds";
import { toolFilter } from "@openbuddy/engine/builtin/persona";

/** UpUp 2026.10.11 的部分真实工具名（含交易与会改状态的工具）。 */
const UPUP_TOOLS = [
  "market_data_quote", "market_data_history", "get_financials", "get_key_ratios", "valuation_ratios", "dcf_model",
  "calculate_var", "calculate_max_drawdown", "industry_five_forces", "company_profile", "compute_macd",
  "upup_market_data_quote", "upup_get_financials", "upup_dcf_model", "upup_place_trade_order", "upup_add_to_watchlist",
  "place_trade_order", "cancel_trade_order", "add_position", "add_to_watchlist", "remove_position", "fund_follow", "fund_alert_create",
];

describe("投研专家 (UP-5.3)", () => {
  it("三位专家都在内置目录里，归入金融投研分类与投研场景", () => {
    const ids = FINANCE_SEEDS.map((seed) => seed.id);
    expect(ids).toEqual(["fundamental-analyst", "risk-analyst", "investment-researcher"]);
    for (const id of ids) expect(SEED_EXPERTS.some((seed) => seed.id === id)).toBe(true);
    expect(EXPERT_CATEGORIES.some((category) => category.id === "finance")).toBe(true);
    expect(EXPERT_SCENES.find((scene) => scene.id === "invest")?.expertIds).toEqual(ids);
  });

  it("绑定后工具收窄到只读数据/计算工具，交易与改状态工具一律不在名单", () => {
    for (const seed of FINANCE_SEEDS) {
      const allowed = toolFilter(seed)!;
      const kept = UPUP_TOOLS.filter(allowed);
      expect(kept.length).toBeGreaterThan(3);
      expect(allowed("upup_market_data_quote"), `${seed.id} 应允许 UpUp 新名工具`).toBe(true);
      for (const name of ["upup_place_trade_order", "upup_add_to_watchlist", "place_trade_order", "cancel_trade_order", "add_position", "add_to_watchlist", "remove_position", "fund_follow", "fund_alert_create"]) {
        expect(allowed(name), `${seed.id} 不应允许 ${name}`).toBe(false);
      }
    }
  });

  it("各专家的工具重点不同：基本面有 DCF、风险有 VaR、研究员能写报告", () => {
    const [fundamental, risk, researcher] = FINANCE_SEEDS.map((seed) => toolFilter(seed)!);
    expect(fundamental!("dcf_model")).toBe(true);
    expect(risk!("calculate_var")).toBe(true);
    expect(risk!("write")).toBe(false);
    expect(researcher!("write")).toBe(true);
  });
});
