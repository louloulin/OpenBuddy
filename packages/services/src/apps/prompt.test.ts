import { describe, expect, it } from "vitest";
import { buildAppPrompt } from "./prompt";
import type { AppEntry } from "./manifest";

const app = (overrides: Partial<AppEntry> = {}): AppEntry => ({
  id: "upup",
  name: "upup",
  kind: "app",
  source: "pi",
  packageSource: "https://gitcode.com/lumosaigroup/upup.git",
  tagline: "证券智能投研助手",
  ...overrides,
});

describe("buildAppPrompt (U4)", () => {
  it("包含应用身份与一句话定位", () => {
    const text = buildAppPrompt(app());
    expect(text).toContain("当前应用：upup — 证券智能投研助手。");
    expect(text).toContain("优先使用该应用声明的场景与工具");
  });

  it("把 deny / readonly 写进边界，避免模型尝试绕过", () => {
    const text = buildAppPrompt(app({ toolPolicy: { deny: ["place_trade_order"], readonly: ["get_astock_price"] } }));
    expect(text).toContain("本应用禁用以下工具：place_trade_order");
    expect(text).toContain("以下工具为只读：get_astock_price");
  });

  it("内置应用也生成稳定身份，且不编造策略", () => {
    const text = buildAppPrompt({ id: "openbuddy", name: "OpenBuddy", kind: "app", source: "builtin", tagline: "通用智能助手" });
    expect(text).toContain("OpenBuddy");
    expect(text).not.toContain("禁用");
  });
});
