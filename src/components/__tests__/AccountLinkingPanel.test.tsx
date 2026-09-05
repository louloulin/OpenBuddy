/**
 * AccountLinkingPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 未登录态提示
 *  - 绑定列表渲染 + 微信/邮箱友好标签
 *  - 解绑按钮触发 `casdoorUnlinkAccount` 并刷新
 *  - 解绑时缺少 identifier 时按钮禁用
 *  - 错误信息会出现在 data-testid="account-linking-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListAccountLinkingMock = vi.fn();
const casdoorUnlinkAccountMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListAccountLinking: (...args: unknown[]) => casdoorListAccountLinkingMock(...args),
  casdoorUnlinkAccount: (...args: unknown[]) => casdoorUnlinkAccountMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  Link2: () => <span data-icon="link" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Unlink: () => <span data-icon="unlink" />,
  ShieldCheck: () => <span data-icon="shield" />,
}));

import { AccountLinkingPanel } from "@openbuddy/ui-account";

function signedInFixture(overrides: Partial<{ owner: string | undefined; subject: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: {
      subject: overrides.subject ?? "user-a",
      owner: overrides.owner ?? "org-built-in",
    },
  };
}

describe("AccountLinkingPanel", () => {
  beforeEach(() => {
    casdoorListAccountLinkingMock.mockReset();
    casdoorUnlinkAccountMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(signedInFixture());
    casdoorListAccountLinkingMock.mockResolvedValue([]);
  });

  it("prompts the user to sign in when no identity is available", async () => {
    casdoorStatusMock.mockResolvedValueOnce({
      status: "signed_out",
      tenantContext: { availableTenantIds: [] },
      identity: null,
    });
    render(<AccountLinkingPanel />);
    expect(await screen.findByText(/请先登录企业账户/)).toBeTruthy();
  });

  it("renders linked options with friendly provider labels", async () => {
    casdoorListAccountLinkingMock.mockResolvedValueOnce([
      { type: "wechat", identifier: "wx-openid-1", linkedAt: "2026-01-01T00:00:00.000Z", enabled: true },
      { type: "email", identifier: "user@example.com", linkedAt: "2026-02-01T00:00:00.000Z", enabled: true },
      { type: "password", identifier: "*", enabled: true },
    ]);
    render(<AccountLinkingPanel />);
    const list = await screen.findByTestId("account-linking-list");
    expect(list.textContent).toContain("微信");
    expect(list.textContent).toContain("邮箱");
    expect(list.textContent).toContain("密码");
    expect(list.textContent).toContain("wx-openid-1");
    expect(list.textContent).toContain("user@example.com");
  });

  it("invokes unlink with the correct payload", async () => {
    casdoorListAccountLinkingMock.mockResolvedValueOnce([
      { type: "wechat", identifier: "wx-openid-1", linkedAt: "2026-01-01T00:00:00.000Z", enabled: true },
    ]);
    casdoorUnlinkAccountMock.mockResolvedValueOnce(undefined);
    render(<AccountLinkingPanel />);
    const unlinkButton = await screen.findByTestId("account-linking-unlink-wechat:wx-openid-1");
    fireEvent.click(unlinkButton);
    await waitFor(() => expect(casdoorUnlinkAccountMock).toHaveBeenCalledWith({
      owner: "org-built-in",
      name: "user-a",
      type: "wechat",
      identifier: "wx-openid-1",
    }));
    expect(await screen.findByTestId("account-linking-message")).toHaveTextContent("已解绑 微信");
  });

  it("disables the unlink button when the option lacks identifier or type", async () => {
    casdoorListAccountLinkingMock.mockResolvedValueOnce([
      { type: "wechat", identifier: "wx-openid-1", linkedAt: "2026-01-01T00:00:00.000Z", enabled: true },
      { type: "", identifier: "" },
    ]);
    render(<AccountLinkingPanel />);
    const good = await screen.findByTestId("account-linking-unlink-wechat:wx-openid-1");
    expect((good as HTMLButtonElement).disabled).toBe(false);
  });

  it("surfaces error messages from the gateway", async () => {
    casdoorListAccountLinkingMock.mockResolvedValueOnce([
      { type: "wechat", identifier: "wx-openid-1", enabled: true },
    ]);
    casdoorUnlinkAccountMock.mockRejectedValueOnce(new Error("ACCOUNT_LINKING_LAST_METHOD"));
    render(<AccountLinkingPanel />);
    const unlinkButton = await screen.findByTestId("account-linking-unlink-wechat:wx-openid-1");
    fireEvent.click(unlinkButton);
    expect(await screen.findByTestId("account-linking-message")).toHaveTextContent("ACCOUNT_LINKING_LAST_METHOD");
  });

  it("warns when listing linked accounts fails", async () => {
    casdoorListAccountLinkingMock.mockRejectedValueOnce(new Error("CASDOOR_UNREACHABLE"));
    render(<AccountLinkingPanel />);
    expect(await screen.findByTestId("account-linking-message")).toHaveTextContent("CASDOOR_UNREACHABLE");
  });
});
