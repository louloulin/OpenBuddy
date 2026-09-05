/**
 * SessionManagementPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 渲染活跃会话（按 kind 分组）
 *  - 单条注销与批量注销调用 IPC
 *  - 已结束会话被过滤掉
 *  - 错误信息出现在 data-testid="session-management-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListSessionsMock = vi.fn();
const casdoorUnregisterSessionMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListSessions: (...args: unknown[]) => casdoorListSessionsMock(...args),
  casdoorUnregisterSession: (...args: unknown[]) => casdoorUnregisterSessionMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  Laptop: () => <span data-icon="laptop" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Trash2: () => <span data-icon="trash" />,
  Users: () => <span data-icon="users" />,
}));

import { SessionManagementPanel } from "@openbuddy/ui-account";

function fixture(overrides: Partial<{ activeTenantId: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: overrides.activeTenantId ?? "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: { subject: "admin", owner: "org-built-in" },
  };
}

function sessionFixture(sessionId: string, kind: "desktop" | "web" | "automation" | "team" | "session", endedAt?: string) {
  return {
    sessionId,
    subject: "user-a",
    kind,
    scopes: ["agent.prompt"],
    startedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    ...(endedAt ? { endedAt } : {}),
  };
}

describe("SessionManagementPanel", () => {
  beforeEach(() => {
    casdoorListSessionsMock.mockReset();
    casdoorUnregisterSessionMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(fixture());
    casdoorListSessionsMock.mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(fixture({ activeTenantId: undefined }));
    render(<SessionManagementPanel />);
    expect(await screen.findByText(/请先登录并选择租户/)).toBeTruthy();
  });

  it("renders active sessions grouped by kind", async () => {
    casdoorListSessionsMock.mockResolvedValueOnce([
      sessionFixture("sess-1", "desktop"),
      sessionFixture("sess-2", "web"),
      sessionFixture("sess-3", "automation"),
      sessionFixture("sess-ended", "desktop", "2026-02-01T00:00:00.000Z"), // ended - should be filtered
    ]);
    render(<SessionManagementPanel />);
    const list = await screen.findByTestId("session-management-list");
    expect(list.textContent).toContain("sess-1");
    expect(list.textContent).toContain("sess-2");
    expect(list.textContent).toContain("sess-3");
    expect(list.textContent).not.toContain("sess-ended");
    // Header shows per-kind counts
    expect(screen.getByText(/桌面=1/)).toBeTruthy();
    expect(screen.getByText(/Web=1/)).toBeTruthy();
  });

  it("unregisters a single session", async () => {
    casdoorListSessionsMock.mockResolvedValueOnce([sessionFixture("sess-1", "desktop")]);
    casdoorUnregisterSessionMock.mockResolvedValueOnce({ removed: true });
    render(<SessionManagementPanel />);
    fireEvent.click(await screen.findByTestId("session-unregister-sess-1"));
    await waitFor(() => expect(casdoorUnregisterSessionMock).toHaveBeenCalledWith("sess-1"));
    expect(await screen.findByTestId("session-management-message")).toHaveTextContent("已注销 sess-1");
  });

  it("unregisters all sessions via batch button", async () => {
    casdoorListSessionsMock.mockResolvedValueOnce([
      sessionFixture("sess-1", "desktop"),
      sessionFixture("sess-2", "web"),
      sessionFixture("sess-3", "automation"),
    ]);
    casdoorUnregisterSessionMock.mockResolvedValue({ removed: true });
    render(<SessionManagementPanel />);
    fireEvent.click(await screen.findByTestId("session-management-unregister-all"));
    await waitFor(() => expect(casdoorUnregisterSessionMock).toHaveBeenCalledTimes(3));
    expect(casdoorUnregisterSessionMock).toHaveBeenCalledWith("sess-1");
    expect(casdoorUnregisterSessionMock).toHaveBeenCalledWith("sess-2");
    expect(casdoorUnregisterSessionMock).toHaveBeenCalledWith("sess-3");
  });

  it("surfaces partial failure in batch unregister", async () => {
    casdoorListSessionsMock.mockResolvedValueOnce([
      sessionFixture("sess-1", "desktop"),
      sessionFixture("sess-2", "web"),
    ]);
    casdoorUnregisterSessionMock
      .mockResolvedValueOnce({ removed: true })
      .mockRejectedValueOnce(new Error("SESSION_NOT_FOUND"));
    render(<SessionManagementPanel />);
    fireEvent.click(await screen.findByTestId("session-management-unregister-all"));
    const msg = await screen.findByTestId("session-management-message");
    expect(msg.textContent).toContain("1 成功");
    expect(msg.textContent).toContain("1 失败");
  });

  it("surfaces single unregister errors", async () => {
    casdoorListSessionsMock.mockResolvedValueOnce([sessionFixture("sess-1", "desktop")]);
    casdoorUnregisterSessionMock.mockRejectedValueOnce(new Error("SESSION_REVOKE_DENIED"));
    render(<SessionManagementPanel />);
    fireEvent.click(await screen.findByTestId("session-unregister-sess-1"));
    expect(await screen.findByTestId("session-management-message")).toHaveTextContent("SESSION_REVOKE_DENIED");
  });

  it("warns when listing sessions fails", async () => {
    casdoorListSessionsMock.mockRejectedValueOnce(new Error("CASDOOR_LIST_SESSIONS_DENIED"));
    render(<SessionManagementPanel />);
    expect(await screen.findByTestId("session-management-message")).toHaveTextContent("CASDOOR_LIST_SESSIONS_DENIED");
  });
});
