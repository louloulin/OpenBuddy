/**
 * TenantMembersPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 未登录态提示
 *  - 成员列表渲染 + 撤销状态徽标
 *  - 撤销/恢复按钮触发 IPC
 *  - 错误信息会出现在 data-testid="tenant-members-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListUsersMock = vi.fn();
const casdoorListMemberRevocationsMock = vi.fn();
const casdoorSetMemberRevocationMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListUsers: (...args: unknown[]) => casdoorListUsersMock(...args),
  casdoorListMemberRevocations: (...args: unknown[]) => casdoorListMemberRevocationsMock(...args),
  casdoorSetMemberRevocation: (...args: unknown[]) => casdoorSetMemberRevocationMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  Users: () => <span data-icon="users" />,
  RefreshCw: () => <span data-icon="refresh" />,
  ShieldOff: () => <span data-icon="shield-off" />,
  ShieldCheck: () => <span data-icon="shield-check" />,
}));

import { TenantMembersPanel } from "@openbuddy/ui-account";

function fixture(overrides: Partial<{ owner: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: { subject: "admin", owner: overrides.owner ?? "org-built-in" },
  };
}

describe("TenantMembersPanel", () => {
  beforeEach(() => {
    casdoorListUsersMock.mockReset();
    casdoorListMemberRevocationsMock.mockReset();
    casdoorSetMemberRevocationMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(fixture());
    casdoorListUsersMock.mockResolvedValue([]);
    casdoorListMemberRevocationsMock.mockResolvedValue([]);
  });

  it("prompts the user to sign in when no identity is available", async () => {
    casdoorStatusMock.mockResolvedValueOnce({
      status: "signed_out",
      tenantContext: { availableTenantIds: [] },
      identity: null,
    });
    render(<TenantMembersPanel />);
    expect(await screen.findByText(/请先登录企业账户/)).toBeTruthy();
  });

  it("renders members filtered by the active organization", async () => {
    casdoorListUsersMock.mockResolvedValueOnce([
      { owner: "org-built-in", name: "alice", displayName: "Alice", email: "alice@example.com", isAdmin: true, groups: ["admins"] },
      { owner: "org-built-in", name: "bob", displayName: "Bob", email: "bob@example.com", isAdmin: false, isForbidden: true, groups: [] },
      { owner: "other-org", name: "carol", displayName: "Carol" }, // 应当被过滤
    ]);
    casdoorListMemberRevocationsMock.mockResolvedValueOnce([
      { subject: "org-built-in/bob", revoked: true, revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "admin", reason: "offboarding" },
    ]);
    render(<TenantMembersPanel />);
    const list = await screen.findByTestId("tenant-members-list");
    expect(list.textContent).toContain("Alice");
    expect(list.textContent).toContain("Bob");
    expect(list.textContent).not.toContain("Carol");
    expect(list.textContent).toContain("admins");
    expect(list.textContent).toContain("offboarding");
  });

  it("revokes a member when the toggle button is clicked", async () => {
    casdoorListUsersMock.mockResolvedValueOnce([
      { owner: "org-built-in", name: "alice", displayName: "Alice", email: "alice@example.com" },
    ]);
    casdoorSetMemberRevocationMock.mockResolvedValueOnce({
      subject: "org-built-in/alice",
      revoked: true,
      revokedAt: "2026-02-01T00:00:00.000Z",
      revokedBy: "admin",
      reason: "管理员手动撤销",
    });
    render(<TenantMembersPanel />);
    const button = await screen.findByTestId("tenant-member-toggle-alice");
    fireEvent.click(button);
    await waitFor(() => expect(casdoorSetMemberRevocationMock).toHaveBeenCalled());
    expect(casdoorSetMemberRevocationMock).toHaveBeenCalledWith("org-built-in/alice", true, "管理员手动撤销");
    expect(await screen.findByTestId("tenant-members-message")).toHaveTextContent("已撤销");
  });

  it("restores a member already in the revocation list", async () => {
    casdoorListUsersMock.mockResolvedValueOnce([
      { owner: "org-built-in", name: "alice", displayName: "Alice", email: "alice@example.com", isForbidden: true },
    ]);
    casdoorListMemberRevocationsMock.mockResolvedValueOnce([
      { subject: "org-built-in/alice", revoked: true, revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "admin" },
    ]);
    casdoorSetMemberRevocationMock.mockResolvedValueOnce({
      subject: "org-built-in/alice",
      revoked: false,
      revokedAt: "2026-01-01T00:00:00.000Z",
      revokedBy: "admin",
    });
    render(<TenantMembersPanel />);
    const button = await screen.findByTestId("tenant-member-toggle-alice");
    expect(button.textContent).toContain("恢复");
    fireEvent.click(button);
    await waitFor(() => expect(casdoorSetMemberRevocationMock).toHaveBeenCalledWith("org-built-in/alice", false, expect.any(String)));
  });

  it("surfaces error messages from the gateway", async () => {
    casdoorListUsersMock.mockResolvedValueOnce([
      { owner: "org-built-in", name: "alice", email: "alice@example.com" },
    ]);
    casdoorSetMemberRevocationMock.mockRejectedValueOnce(new Error("MEMBER_REVOCATION_DENIED"));
    render(<TenantMembersPanel />);
    const button = await screen.findByTestId("tenant-member-toggle-alice");
    fireEvent.click(button);
    expect(await screen.findByTestId("tenant-members-message")).toHaveTextContent("MEMBER_REVOCATION_DENIED");
  });

  it("warns when listing members fails", async () => {
    casdoorListUsersMock.mockRejectedValueOnce(new Error("CASDOOR_LIST_USERS_DENIED"));
    render(<TenantMembersPanel />);
    expect(await screen.findByTestId("tenant-members-message")).toHaveTextContent("CASDOOR_LIST_USERS_DENIED");
  });
});
