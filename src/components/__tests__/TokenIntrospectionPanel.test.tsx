/**
 * TokenIntrospectionPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 默认要求登录 + 租户
 *  - 空 token 时给出 warn 提示并不调用 IPC
 *  - 成功返回时渲染 active 徽标 + 全部 11 个标准字段
 *  - active=false 时显示 warn 文案
 *  - 失败时清空结果并展示 err 提示
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorIntrospectTokenMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorIntrospectToken: (...args: unknown[]) => casdoorIntrospectTokenMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  KeyRound: () => <span data-icon="keyround" />,
  Loader2: () => <span data-icon="loader" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Search: () => <span data-icon="search" />,
}));

import { TokenIntrospectionPanel } from "@openbuddy/ui-account";

function statusFixture(activeTenantId?: string) {
  return {
    status: "signed_in" as const,
    tenantContext: {
      activeTenantId: activeTenantId ?? "tenant-a",
      availableTenantIds: ["tenant-a"],
    },
    identity: { subject: "admin", owner: "org-built-in" },
  };
}

function introspectionFixture(overrides: Partial<{ active: boolean }> = {}) {
  return {
    active: overrides.active ?? true,
    scope: "openid profile email",
    clientId: "openbuddy-desktop",
    username: "admin",
    sub: "admin",
    tokenType: "Bearer",
    exp: 1_900_000_000,
    iat: 1_899_999_000,
    nbf: 1_899_999_000,
    aud: "openbuddy",
    iss: "https://casdoor.example.com",
    jti: "jti-001",
  };
}

describe("TokenIntrospectionPanel", () => {
  beforeEach(() => {
    casdoorIntrospectTokenMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(statusFixture());
    casdoorIntrospectTokenMock.mockResolvedValue(introspectionFixture());
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(statusFixture(""));
    render(<TokenIntrospectionPanel />);
    expect(await screen.findByText(/请先登录并选择租户/)).toBeTruthy();
  });

  it("warns when submitting an empty token", async () => {
    render(<TokenIntrospectionPanel />);
    const button = await screen.findByTestId("token-introspection-submit");
    fireEvent.click(button);
    const msg = await screen.findByTestId("token-introspection-message");
    expect(msg.textContent).toMatch(/请粘贴或输入要校验的 token/);
    expect(casdoorIntrospectTokenMock).not.toHaveBeenCalled();
  });

  it("renders the result for a valid token with all 11 standard fields", async () => {
    render(<TokenIntrospectionPanel />);
    const textarea = await screen.findByTestId("token-introspection-input");
    fireEvent.change(textarea, { target: { value: "fake-jwt-token" } });
    fireEvent.click(screen.getByTestId("token-introspection-submit"));

    await waitFor(() => expect(casdoorIntrospectTokenMock).toHaveBeenCalledWith({
      token: "fake-jwt-token",
      tokenTypeHint: "access_token",
    }));
    const badge = await screen.findByTestId("token-introspection-active-badge");
    expect(badge.textContent).toBe("active = true");

    expect(screen.getByTestId("token-introspection-row-sub").textContent).toContain("admin");
    expect(screen.getByTestId("token-introspection-row-username").textContent).toContain("admin");
    expect(screen.getByTestId("token-introspection-row-client").textContent).toContain("openbuddy-desktop");
    expect(screen.getByTestId("token-introspection-row-scope").textContent).toContain("openid profile email");
    expect(screen.getByTestId("token-introspection-row-token-type").textContent).toContain("Bearer");
    expect(screen.getByTestId("token-introspection-row-iss").textContent).toContain("casdoor.example.com");
    expect(screen.getByTestId("token-introspection-row-aud").textContent).toContain("openbuddy");
    expect(screen.getByTestId("token-introspection-row-jti").textContent).toContain("jti-001");
  });

  it("renders a warn message when the token is inactive", async () => {
    casdoorIntrospectTokenMock.mockResolvedValueOnce(introspectionFixture({ active: false }));
    render(<TokenIntrospectionPanel />);
    const textarea = await screen.findByTestId("token-introspection-input");
    fireEvent.change(textarea, { target: { value: "revoked-jwt" } });
    fireEvent.click(screen.getByTestId("token-introspection-submit"));

    const badge = await screen.findByTestId("token-introspection-active-badge");
    expect(badge.textContent).toBe("active = false");
    const msg = await screen.findByTestId("token-introspection-message");
    expect(msg.textContent).toMatch(/Casdoor 端被视为无效/);
  });

  it("surfaces an error message and clears the previous result on failure", async () => {
    casdoorIntrospectTokenMock
      .mockResolvedValueOnce(introspectionFixture())
      .mockRejectedValueOnce(new Error("INVALID_BEARER"));
    render(<TokenIntrospectionPanel />);
    const textarea = await screen.findByTestId("token-introspection-input");
    fireEvent.change(textarea, { target: { value: "fake-jwt-token" } });
    fireEvent.click(screen.getByTestId("token-introspection-submit"));
    expect(await screen.findByTestId("token-introspection-row-sub")).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "broken-jwt" } });
    fireEvent.click(screen.getByTestId("token-introspection-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("token-introspection-message").textContent).toMatch(/INVALID_BEARER/),
    );
    expect(screen.queryByTestId("token-introspection-result")).toBeNull();
  });

  it("passes tokenTypeHint=refresh_token when the radio is switched", async () => {
    render(<TokenIntrospectionPanel />);
    const textarea = await screen.findByTestId("token-introspection-input");
    fireEvent.change(textarea, { target: { value: "rid-1" } });
    fireEvent.click(screen.getByTestId("token-introspection-hint-refresh"));
    fireEvent.click(screen.getByTestId("token-introspection-submit"));
    await waitFor(() =>
      expect(casdoorIntrospectTokenMock).toHaveBeenCalledWith({
        token: "rid-1",
        tokenTypeHint: "refresh_token",
      }),
    );
  });
});
