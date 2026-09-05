/**
 * CreditPricingPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 未选择租户时提示
 *  - 加载默认定价列表 + 三个数字输入框
 *  - 编辑后保存按钮启用 + IPC 调用正确负载
 *  - 加载/保存错误会出现在 data-testid="credit-pricing-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListCreditPricingMock = vi.fn();
const casdoorQuoteCreditsMock = vi.fn();
const casdoorUpdateCreditPricingMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListCreditPricing: (...args: unknown[]) => casdoorListCreditPricingMock(...args),
  casdoorQuoteCredits: (...args: unknown[]) => casdoorQuoteCreditsMock(...args),
  casdoorUpdateCreditPricing: (...args: unknown[]) => casdoorUpdateCreditPricingMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  Coins: () => <span data-icon="coins" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Save: () => <span data-icon="save" />,
}));

import { CreditPricingPanel } from "@openbuddy/ui-billing";

function fixture(overrides: Partial<{ activeTenantId: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: overrides.activeTenantId ?? "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: { subject: "admin", owner: "org-built-in" },
  };
}

describe("CreditPricingPanel", () => {
  beforeEach(() => {
    casdoorListCreditPricingMock.mockReset();
    casdoorQuoteCreditsMock.mockReset();
    casdoorUpdateCreditPricingMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(fixture());
    casdoorListCreditPricingMock.mockResolvedValue([
      { model: "*", inputPointsPerThousand: 1, outputPointsPerThousand: 3, minimumPoints: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
      { model: "gpt-4", inputPointsPerThousand: 30, outputPointsPerThousand: 60, minimumPoints: 5, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY", costSource: "configured-pricing", updatedAt: "2026-01-02T00:00:00.000Z" },
    ]);
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(fixture({ activeTenantId: undefined }));
    render(<CreditPricingPanel />);
    expect(await screen.findByText(/请先登录并选择租户/)).toBeTruthy();
  });

  it("renders pricing rows with three number inputs each", async () => {
    render(<CreditPricingPanel />);
    await screen.findByTestId("credit-pricing-list");
    expect(screen.getByTestId("credit-pricing-input-*")).toBeTruthy();
    expect(screen.getByTestId("credit-pricing-output-*")).toBeTruthy();
    expect(screen.getByTestId("credit-pricing-min-*")).toBeTruthy();
    expect(screen.getByTestId("credit-pricing-input-gpt-4")).toBeTruthy();
    // Save buttons are initially disabled since nothing is dirty
    expect((screen.getByTestId("credit-pricing-save-*") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables save after edit and sends the right payload", async () => {
    casdoorUpdateCreditPricingMock.mockResolvedValueOnce({
      model: "gpt-4",
      inputPointsPerThousand: 50,
      outputPointsPerThousand: 80,
      minimumPoints: 5,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    render(<CreditPricingPanel />);
    const input = await screen.findByTestId("credit-pricing-input-gpt-4");
    fireEvent.change(input, { target: { value: "50" } });
    const saveButton = await screen.findByTestId("credit-pricing-save-gpt-4");
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() => expect(casdoorUpdateCreditPricingMock).toHaveBeenCalled());
    expect(casdoorUpdateCreditPricingMock).toHaveBeenCalledWith({
      model: "gpt-4",
      inputPointsPerThousand: 50,
      outputPointsPerThousand: 60,
      minimumPoints: 5,
      inputCostPerMillion: 2.1,
      outputCostPerMillion: 8.4,
      costCurrency: "CNY",
      costSource: "configured-pricing",
    });
    expect(await screen.findByTestId("credit-pricing-message")).toHaveTextContent("gpt-4 定价已保存");
  });

  it("requests a server-side quote for the selected model and token counts", async () => {
    casdoorQuoteCreditsMock.mockResolvedValueOnce({
      model: "gpt-4",
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      estimatedPoints: 60,
      unit: "points",
      priceBasis: "gateway-pricing",
      pricing: { model: "gpt-4", inputPointsPerThousand: 30, outputPointsPerThousand: 60, minimumPoints: 5, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY", costSource: "configured-pricing", updatedAt: "2026-01-01T00:00:00.000Z" },
      quoteValidUntil: "2026-02-01T00:01:00.000Z",
    });
    render(<CreditPricingPanel />);
    await screen.findByTestId("credit-quote-section");
    fireEvent.change(screen.getByTestId("credit-quote-model"), { target: { value: "gpt-4" } });
    fireEvent.click(screen.getByTestId("credit-quote-submit"));
    await waitFor(() => expect(casdoorQuoteCreditsMock).toHaveBeenCalledWith({ model: "gpt-4", promptTokens: 1000, completionTokens: 500 }));
    expect(await screen.findByTestId("credit-quote-result")).toHaveTextContent("预计消费 60 积分");
  });

  it("surfaces error messages from the gateway", async () => {
    casdoorUpdateCreditPricingMock.mockRejectedValueOnce(new Error("CREDIT_PRICING_PERSIST_DENIED"));
    render(<CreditPricingPanel />);
    const input = await screen.findByTestId("credit-pricing-input-*");
    fireEvent.change(input, { target: { value: "2" } });
    const saveButton = await screen.findByTestId("credit-pricing-save-*");
    fireEvent.click(saveButton);
    expect(await screen.findByTestId("credit-pricing-message")).toHaveTextContent("CREDIT_PRICING_PERSIST_DENIED");
  });

  it("warns when listing pricing fails", async () => {
    casdoorListCreditPricingMock.mockRejectedValueOnce(new Error("CREDIT_PRICING_UNREACHABLE"));
    render(<CreditPricingPanel />);
    expect(await screen.findByTestId("credit-pricing-message")).toHaveTextContent("CREDIT_PRICING_UNREACHABLE");
  });
});
