/**
 * BillingPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 空租户态提示
 *  - 套餐目录 + 订单列表渲染
 *  - 下单按钮触发 `casdoorCreateBillingOrder` 并刷新列表
 *  - 退款/过期按钮只对允许的状态可点击
 *  - 错误信息会出现在 data-testid="casdoor-billing-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListBillingPlansMock = vi.fn();
const casdoorGetBillingSubscriptionMock = vi.fn();
const casdoorListBillingOrdersMock = vi.fn();
const casdoorCreateBillingOrderMock = vi.fn();
const casdoorRefundBillingOrderMock = vi.fn();
const casdoorExpireBillingOrderMock = vi.fn();
const casdoorStatusMock = vi.fn();
const casdoorTenantHealthMock = vi.fn();
const casdoorGetSelectedCreditWalletIdMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListBillingPlans: (...args: unknown[]) => casdoorListBillingPlansMock(...args),
  casdoorGetBillingSubscription: (...args: unknown[]) => casdoorGetBillingSubscriptionMock(...args),
  casdoorListBillingOrders: (...args: unknown[]) => casdoorListBillingOrdersMock(...args),
  casdoorCreateBillingOrder: (...args: unknown[]) => casdoorCreateBillingOrderMock(...args),
  casdoorRefundBillingOrder: (...args: unknown[]) => casdoorRefundBillingOrderMock(...args),
  casdoorExpireBillingOrder: (...args: unknown[]) => casdoorExpireBillingOrderMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
  casdoorTenantHealth: (...args: unknown[]) => casdoorTenantHealthMock(...args),
  casdoorGetSelectedCreditWalletId: (...args: unknown[]) => casdoorGetSelectedCreditWalletIdMock(...args),
}));

vi.mock("lucide-react", () => ({
  CreditCard: () => <span data-icon="credit-card" />,
  RefreshCw: () => <span data-icon="refresh" />,
  ShoppingCart: () => <span data-icon="cart" />,
  Undo2: () => <span data-icon="undo" />,
  XCircle: () => <span data-icon="x" />,
}));

import { BillingPanel } from "@openbuddy/ui-billing";

function sessionFixture(overrides: Partial<{ activeTenantId: string | undefined; subject: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: overrides.activeTenantId ?? "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: { subject: overrides.subject ?? "user-a" },
  };
}

function planFixture(id: string, points: number, priceMinor: number) {
  return {
    id,
    name: `Plan ${id}`,
    currency: "CNY",
    priceMinor,
    points,
    active: true,
    features: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function orderFixture(orderNo: string, planId: string, status: "pending" | "paid" | "refunded" | "expired") {
  return {
    id: orderNo,
    orderNo,
    tenantId: "tenant-a",
    subject: "user-a",
    planId,
    points: 10000,
    amountMinor: 9900,
    currency: "CNY",
    status,
    idempotencyKey: orderNo,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T01:00:00.000Z",
  };
}

describe("BillingPanel", () => {
  beforeEach(() => {
    casdoorListBillingPlansMock.mockReset();
    casdoorGetBillingSubscriptionMock.mockReset();
    casdoorGetBillingSubscriptionMock.mockResolvedValue(null);
    casdoorListBillingOrdersMock.mockReset();
    casdoorCreateBillingOrderMock.mockReset();
    casdoorRefundBillingOrderMock.mockReset();
    casdoorExpireBillingOrderMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(sessionFixture());
    casdoorTenantHealthMock.mockReset();
    casdoorTenantHealthMock.mockResolvedValue(null);
    casdoorGetSelectedCreditWalletIdMock.mockReset();
    casdoorGetSelectedCreditWalletIdMock.mockResolvedValue(undefined);
    casdoorGetSelectedCreditWalletIdMock.mockReset();
    casdoorGetSelectedCreditWalletIdMock.mockResolvedValue(undefined);
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(sessionFixture({ activeTenantId: undefined }));
    casdoorListBillingPlansMock.mockResolvedValueOnce([]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([]);
    render(<BillingPanel />);
    expect(await screen.findByText(/请先登录企业账户并选择租户/)).toBeTruthy();
  });

  it("renders plans and orders once the tenant is active", async () => {
    casdoorListBillingPlansMock.mockResolvedValueOnce([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([
      orderFixture("ob_abc", "team", "pending"),
    ]);
    render(<BillingPanel />);
    await waitFor(() => expect(casdoorListBillingPlansMock).toHaveBeenCalled());
    expect(await screen.findByTestId("casdoor-billing-plans-list")).toBeTruthy();
    expect(await screen.findByTestId("casdoor-billing-orders-list")).toBeTruthy();
    expect(screen.getByTestId("casdoor-billing-buy-team")).toBeTruthy();
    const expireButton = screen.getByTestId("casdoor-billing-expire-ob_abc");
    const refundButton = screen.getByTestId("casdoor-billing-refund-ob_abc");
    expect((expireButton as HTMLButtonElement).disabled).toBe(false);
    // pending 订单不允许退款（按钮禁用）
    expect((refundButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the current paid subscription entitlement snapshot", async () => {
    casdoorListBillingPlansMock.mockResolvedValueOnce([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([]);
    casdoorGetBillingSubscriptionMock.mockResolvedValueOnce({
      tenantId: "tenant-a",
      subject: "user-a",
      planId: "team",
      orderNo: "ob_paid",
      status: "active",
      entitlements: { maxTokensPerDay: 100000, maxPointsPerDay: 10000, newApiGroup: "team" },
      startedAt: "2026-01-01T00:00:00.000Z",
      entitlementsExpiresAt: "2026-02-01T00:00:00.000Z",
    });
    render(<BillingPanel />);
    expect(await screen.findByTestId("casdoor-billing-subscription")).toHaveTextContent("ob_paid");
    expect(screen.getByTestId("casdoor-billing-subscription")).toHaveTextContent("100,000");
    expect(screen.getByTestId("casdoor-billing-subscription")).toHaveTextContent("权益到期");
  });

  it("creates an order when the buy button is clicked", async () => {
    casdoorListBillingPlansMock.mockResolvedValue([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValue([]);
    casdoorCreateBillingOrderMock.mockResolvedValueOnce({
      ...orderFixture("ob_new", "team", "pending"),
      expiresAt: "2026-02-01T00:00:00.000Z",
    });
    render(<BillingPanel />);
    const buyButton = await screen.findByTestId("casdoor-billing-buy-team");
    fireEvent.click(buyButton);
    await waitFor(() => expect(casdoorCreateBillingOrderMock).toHaveBeenCalled());
    const input = casdoorCreateBillingOrderMock.mock.calls[0]?.[0];
    expect(input?.planId).toBe("team");
    expect(typeof input?.idempotencyKey).toBe("string");
    expect(input?.expiresInSeconds).toBe(1800);
    expect(await screen.findByTestId("casdoor-billing-message")).toHaveTextContent("ob_new");
  });

  it("attaches the selected shared wallet to a purchase order", async () => {
    casdoorListBillingPlansMock.mockResolvedValue([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValue([]);
    casdoorGetSelectedCreditWalletIdMock.mockResolvedValue("wallet-1");
    casdoorCreateBillingOrderMock.mockResolvedValueOnce({ ...orderFixture("ob_wallet", "team", "pending") });
    render(<BillingPanel />);
    fireEvent.click(await screen.findByTestId("casdoor-billing-buy-team"));
    await waitFor(() => expect(casdoorCreateBillingOrderMock).toHaveBeenCalled());
    expect(casdoorCreateBillingOrderMock.mock.calls[0]?.[0]).toMatchObject({ planId: "team", walletId: "wallet-1" });
    expect(await screen.findByTestId("casdoor-billing-target")).toHaveTextContent("共享钱包 wallet-1");
  });

  it("renders the persisted wallet target on existing orders", async () => {
    casdoorListBillingPlansMock.mockResolvedValue([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([{ ...orderFixture("ob_wallet", "team", "pending"), walletId: "wallet-1" }]);
    render(<BillingPanel />);
    expect(await screen.findByTestId("casdoor-billing-orders-list")).toHaveTextContent("共享钱包 wallet-1");
  });

  it("only enables refund for paid orders and expire for pending orders", async () => {
    casdoorListBillingPlansMock.mockResolvedValue([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([
      orderFixture("ob_pending", "team", "pending"),
      orderFixture("ob_paid", "team", "paid"),
    ]);
    render(<BillingPanel />);
    const pendingRefund = await screen.findByTestId("casdoor-billing-refund-ob_pending");
    const paidRefund = await screen.findByTestId("casdoor-billing-refund-ob_paid");
    const pendingExpire = await screen.findByTestId("casdoor-billing-expire-ob_pending");
    const paidExpire = await screen.findByTestId("casdoor-billing-expire-ob_paid");
    expect((pendingRefund as HTMLButtonElement).disabled).toBe(true);
    expect((paidRefund as HTMLButtonElement).disabled).toBe(false);
    expect((pendingExpire as HTMLButtonElement).disabled).toBe(false);
    expect((paidExpire as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces error messages from the gateway", async () => {
    casdoorListBillingPlansMock.mockResolvedValueOnce([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([orderFixture("ob_paid", "team", "paid")]);
    casdoorRefundBillingOrderMock.mockRejectedValueOnce(new Error("余额不足"));
    render(<BillingPanel />);
    const refundButton = await screen.findByTestId("casdoor-billing-refund-ob_paid");
    fireEvent.click(refundButton);
    expect(await screen.findByTestId("casdoor-billing-message")).toHaveTextContent("余额不足");
  });

  it("reports a warning when plans fail to load", async () => {
    casdoorListBillingPlansMock.mockRejectedValueOnce(new Error("BILLING_PLAN_NOT_FOUND"));
    casdoorListBillingOrdersMock.mockResolvedValueOnce([]);
    render(<BillingPanel />);
    expect(await screen.findByTestId("casdoor-billing-message")).toHaveTextContent("BILLING_PLAN_NOT_FOUND");
  });

  it("renders tenant quota summary when tenant health is available", async () => {
    casdoorListBillingPlansMock.mockResolvedValueOnce([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([]);
    casdoorTenantHealthMock.mockResolvedValueOnce({
      ok: true,
      store: "json",
      latencyMs: 4,
      version: "1",
      tenantId: "tenant-a",
      policy: {
        status: "active",
        maxResources: 100,
        version: 3,
        killSwitch: false,
        modelAllowlist: 2,
        mcpAllowlist: 1,
        maxTokensPerDay: 100000,
        tokensUsedToday: 75000,
      },
      resources: { project: 4, knowledge_base: 2 },
      revokedMembers: 1,
      activeSessions: 3,
      siem: null,
      at: "2026-08-30T00:00:00.000Z",
    });
    render(<BillingPanel />);
    const quota = await screen.findByTestId("casdoor-billing-quota");
    expect(quota.textContent).toContain("75,000");
    expect(quota.textContent).toContain("100,000");
    expect(quota.textContent).toContain("75.0%");
    expect(quota.textContent).toContain("活跃会话 3");
    expect(quota.textContent).toContain("撤销成员 1");
  });

  it("warns when tenant quota is near the daily limit", async () => {
    casdoorListBillingPlansMock.mockResolvedValueOnce([planFixture("team", 10000, 9900)]);
    casdoorListBillingOrdersMock.mockResolvedValueOnce([]);
    casdoorTenantHealthMock.mockResolvedValueOnce({
      ok: true,
      store: "json",
      latencyMs: 4,
      version: "1",
      tenantId: "tenant-a",
      policy: {
        status: "active",
        maxResources: 100,
        version: 3,
        killSwitch: false,
        modelAllowlist: 2,
        mcpAllowlist: 1,
        maxTokensPerDay: 100,
        tokensUsedToday: 95,
      },
      resources: {},
      revokedMembers: 0,
      activeSessions: 0,
      siem: null,
      at: "2026-08-30T00:00:00.000Z",
    });
    render(<BillingPanel />);
    const quota = await screen.findByTestId("casdoor-billing-quota");
    expect(quota.textContent).toContain("95.0%");
  });
});
