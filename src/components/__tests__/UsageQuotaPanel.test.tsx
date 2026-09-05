import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsageQuotaPanel } from "@openbuddy/ui-billing";
import { recordUsage, clearUsage, saveQuotaConfig, type UsageRecord } from "@/lib/billing/usage-quota";

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorStatus: vi.fn().mockRejectedValue(new Error("not in electron")),
  casdoorGetSelectedCreditWalletId: vi.fn(),
  casdoorGetSelectedCreditWalletCredits: vi.fn(),
  casdoorGetCredits: vi.fn(),
}));

describe("UsageQuotaPanel", () => {
  beforeEach(() => {
    clearUsage();
    window.localStorage.removeItem("openbuddy.quota");
  });

  it("空数据显示 0 token + 0 调用", () => {
    render(<UsageQuotaPanel />);
    // 空数据时总 Token 显示 0(作为 stat-value)。
    const tokenStat = screen.getByText("总 Token");
    expect(tokenStat.previousElementSibling?.textContent).toBe("0");
    expect(screen.getByText("调用次数")).toBeInTheDocument();
  });

  it("有用量记录 → 显示汇总", () => {
    recordUsage([], { modelId: "gpt-4", promptTokens: 500, completionTokens: 200 });
    render(<UsageQuotaPanel />);
    // totalTokens = 700
    expect(screen.getByText("700")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count
  });

  it("切换本月/今日周期", () => {
    render(<UsageQuotaPanel />);
    expect(screen.getByText("今日")).toBeInTheDocument();
    fireEvent.click(screen.getByText("本月"));
    // 重新渲染后仍正常。
    expect(screen.getByText("总 Token")).toBeInTheDocument();
    expect(screen.getByText(/服务端 Gateway 账本才是唯一计费事实源/)).toBeInTheDocument();
  });

  it("配置配额 → 显示进度条", () => {
    recordUsage([], { modelId: "gpt-4", promptTokens: 800, completionTokens: 200 });
    saveQuotaConfig({ period: "daily", tokenLimit: 1000 });
    render(<UsageQuotaPanel />);
    // 1000 token used = 1000, limit 1000 → pct 100
    expect(screen.getByText(/1,000 \/ 1,000/)).toBeInTheDocument();
  });

  it("按模型分组显示", () => {
    recordUsage([], { modelId: "gpt-4", promptTokens: 100, completionTokens: 50 });
    recordUsage([{
      date: new Date().toISOString().slice(0, 10),
      modelId: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      ts: Date.now(),
    } as UsageRecord], { modelId: "claude", promptTokens: 50, completionTokens: 30 });
    render(<UsageQuotaPanel />);
    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
  });
});
