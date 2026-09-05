import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const statusMock = vi.fn();
const listMock = vi.fn();
const selectedMock = vi.fn();
const selectMock = vi.fn();
const creditsMock = vi.fn();
const ledgerMock = vi.fn();
vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorStatus: (...args: unknown[]) => statusMock(...args),
  casdoorListCreditWallets: (...args: unknown[]) => listMock(...args),
  casdoorGetSelectedCreditWalletId: (...args: unknown[]) => selectedMock(...args),
  casdoorSelectCreditWallet: (...args: unknown[]) => selectMock(...args),
  casdoorGetSelectedCreditWalletCredits: (...args: unknown[]) => creditsMock(...args),
  casdoorListSelectedCreditWalletLedger: (...args: unknown[]) => ledgerMock(...args),
}));
vi.mock("lucide-react", () => ({ Wallet: () => <span />, RefreshCw: () => <span /> }));
import { CreditWalletPanel } from "@openbuddy/ui-billing";

const wallets = [
  { id: "wallet-spend", tenantId: "tenant-a", name: "团队钱包", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin", members: [{ walletId: "wallet-spend", tenantId: "tenant-a", subject: "user-a", role: "spender", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin" }] },
  { id: "wallet-view", tenantId: "tenant-a", name: "只读钱包", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin", members: [{ walletId: "wallet-view", tenantId: "tenant-a", subject: "user-a", role: "viewer", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin" }] },
];

beforeEach(() => {
  statusMock.mockReset().mockResolvedValue({ tenantContext: { activeTenantId: "tenant-a", membership: { isTenantAdmin: false } }, identity: { subject: "user-a", isAdmin: false } });
  listMock.mockReset().mockResolvedValue(wallets);
  selectedMock.mockReset().mockResolvedValue(undefined);
  selectMock.mockReset().mockResolvedValue({ selectedWalletId: "wallet-spend", wallets });
  creditsMock.mockReset().mockResolvedValue({ tenantId: "tenant-a", subject: "wallet:wallet-spend", plan: "team-wallet", balance: 1200, reserved: 200, available: 1000, lifetimeGranted: 2000, lifetimeConsumed: 800, lifetimeRefunded: 0, lifetimeExpired: 0, updatedAt: "2026-01-01", version: 1 });
  ledgerMock.mockReset().mockResolvedValue([{ id: "entry-1", tenantId: "tenant-a", subject: "wallet:wallet-spend", type: "consume", amount: 20, unit: "points", model: "MiniMax-M3", createdAt: "2026-01-01" }]);
});

describe("CreditWalletPanel", () => {
  it("only shows wallets that the subject can spend", async () => {
    render(<CreditWalletPanel />);
    const select = await screen.findByTestId("credit-wallet-select");
    expect(select.textContent).toContain("团队钱包");
    expect(select.textContent).not.toContain("只读钱包");
  });

  it("selects a shared wallet and reports the active billing scope", async () => {
    render(<CreditWalletPanel />);
    const select = await screen.findByTestId("credit-wallet-select");
    fireEvent.change(select, { target: { value: "wallet-spend" } });
    await waitFor(() => expect(selectMock).toHaveBeenCalledWith("wallet-spend"));
    expect(await screen.findByTestId("credit-wallet-message")).toHaveTextContent("共享钱包扣费");
  });

  it("shows the selected account balance and recent ledger", async () => {
    render(<CreditWalletPanel />);
    expect(await screen.findByTestId("credit-wallet-account")).toHaveTextContent("1,200 积分");
    expect(await screen.findByTestId("credit-wallet-ledger")).toHaveTextContent("消费");
    expect(ledgerMock).toHaveBeenCalledWith(8);
  });
});
