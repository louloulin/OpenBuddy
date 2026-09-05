import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const reconciliationMock = vi.fn();
const statusMock = vi.fn();
vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorGetCreditReconciliation: (...args: unknown[]) => reconciliationMock(...args),
  casdoorStatus: (...args: unknown[]) => statusMock(...args),
}));
vi.mock("lucide-react", () => ({ BarChart3: () => <span />, RefreshCw: () => <span /> }));
import { CreditReconciliationPanel } from "@openbuddy/ui-billing";

const report = {
  source: "openbuddy-credit-ledger" as const,
  externalNewApiCostFetched: false as const,
  tenantId: "tenant-a",
  reportId: "reconciliation_0123456789abcdef01234567",
  reportHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  generatedAt: "2026-08-30T12:00:00.000Z",
  coveragePercent: 50,
  total: { requests: 2, promptTokens: 30, completionTokens: 10, totalTokens: 40, pointsSettled: 8, upstreamCost: 0.02, upstreamCostEntries: 1 },
  commerce: { grossOrders: 3, refundedOrders: 1, grossPoints: 30000, refundedPoints: 5000, netPoints: 25000, grossAmountMinorByCurrency: { CNY: 29900, USD: 1200 }, refundedAmountMinorByCurrency: { CNY: 9900 }, netAmountMinorByCurrency: { CNY: 20000, USD: 1200 } },
  economics: { settledPoints: 8, grossRevenueMinorByCurrency: { CNY: 29900, USD: 1200 }, refundedRevenueMinorByCurrency: { CNY: 9900 }, netRevenueMinorByCurrency: { CNY: 20000, USD: 1200 }, verifiedExternalCostByCurrency: { USD: 0.5 }, matchedVerifiedExternalCostByCurrency: { USD: 0.5 }, unmatchedVerifiedExternalCostByCurrency: {}, verifiedCostRecords: 2, matchedVerifiedCostRecords: 2, unmatchedVerifiedCostRecords: 0, costCoveragePercent: 100, contributionMarginMajorByCurrency: { USD: 11.5 } },
  byModel: { "demo-model": { requests: 2, promptTokens: 30, completionTokens: 10, totalTokens: 40, pointsSettled: 8, upstreamCost: 0.02, upstreamCostEntries: 1 } },
  bySubject: { alice: { requests: 2, promptTokens: 30, completionTokens: 10, totalTokens: 40, pointsSettled: 8, upstreamCost: 0.02, upstreamCostEntries: 1 } },
  byActor: { alice: { requests: 2, promptTokens: 30, completionTokens: 10, totalTokens: 40, pointsSettled: 8, upstreamCost: 0.02, upstreamCostEntries: 1 } },
  external: {
    source: "new-api-import",
    records: 1,
    matchedRecords: 1,
    unmatchedRecords: 0,
    totalCost: 0.02,
    currencies: ["USD"],
    byModel: {},
    bySubject: {},
    byActor: { alice: { requests: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15, pointsSettled: 0, upstreamCost: 0, upstreamCostEntries: 0, externalCost: 0.02, externalCostEntries: 1, paidPointsConsumed: 0, freePointsConsumed: 0, recognizedRevenueMinorByCurrency: {} } },
    byAgent: {},
    bySession: {},
  },
};

beforeEach(() => {
  reconciliationMock.mockReset().mockResolvedValue(report);
  statusMock.mockReset().mockResolvedValue({ tenantContext: { activeTenantId: "tenant-a" } });
});

describe("CreditReconciliationPanel", () => {
  it("renders summary and model/subject breakdown", async () => {
    render(<CreditReconciliationPanel />);
    expect(await screen.findByTestId("credit-reconciliation-summary")).toBeTruthy();
    expect(screen.getByTestId("credit-reconciliation-coverage").textContent).toContain("50%");
    expect(screen.getByTestId("credit-reconciliation-commerce").textContent).toContain("净收入");
    expect(screen.getByTestId("credit-reconciliation-commerce").textContent).toContain("CNY 200.00");
    expect(screen.getByTestId("credit-reconciliation-commerce").textContent).toContain("USD 12.00");
    expect(screen.getByTestId("credit-reconciliation-commerce").textContent).toContain("净积分");
    expect(screen.getByTestId("credit-reconciliation-economics").textContent).toContain("成本匹配率");
    expect(screen.getByTestId("credit-reconciliation-economics").textContent).toContain("USD 11.50");
    expect(screen.getByTestId("credit-reconciliation-models").textContent).toContain("demo-model");
    expect(screen.getByTestId("credit-reconciliation-subjects").textContent).toContain("alice");
    expect(screen.getByTestId("credit-reconciliation-actors").textContent).toContain("alice");
    expect(screen.getByTestId("credit-reconciliation-external-actors").textContent).toContain("外部成本 0.02");
    expect(reconciliationMock).toHaveBeenCalledWith();
  });

  it("shows a load error", async () => {
    reconciliationMock.mockRejectedValueOnce(new Error("GATEWAY_DOWN"));
    render(<CreditReconciliationPanel />);
    expect(await screen.findByTestId("credit-reconciliation-message")).toHaveTextContent("GATEWAY_DOWN");
  });

  it("refreshes the report", async () => {
    render(<CreditReconciliationPanel />);
    await screen.findByTestId("credit-reconciliation-summary");
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    await waitFor(() => expect(reconciliationMock).toHaveBeenCalledTimes(2));
  });

  it("loads a shared-wallet statement when a wallet scope is supplied", async () => {
    render(<CreditReconciliationPanel />);
    await screen.findByTestId("credit-reconciliation-summary");
    fireEvent.change(screen.getByPlaceholderText("输入 walletId，留空按租户"), { target: { value: "wallet-1" } });
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    await waitFor(() => expect(reconciliationMock).toHaveBeenLastCalledWith(undefined, undefined, "wallet-1"));
  });
});
