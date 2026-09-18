/**
 * R48 — Casdoor 登录对话框契约测试。
 *
 * 覆盖用户反馈的三件事:
 *   1. 未配置企业身份时,对话框内能直接补 issuer / clientId,点一下就能登录
 *      (而不是把人送去设置表单);
 *   2. 已配置时直接发起 Casdoor 授权(casdoor:login),失败文案经过 humanize;
 *   3. 已登录时展示身份 + 退出登录。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const statusMock = vi.fn();
const saveConfigMock = vi.fn();
const loginMock = vi.fn();
const logoutMock = vi.fn();
const capabilitiesMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorStatus: (...a: unknown[]) => statusMock(...a),
  casdoorSaveConfig: (...a: unknown[]) => saveConfigMock(...a),
  casdoorLogin: (...a: unknown[]) => loginMock(...a),
  casdoorLogout: (...a: unknown[]) => logoutMock(...a),
  casdoorLoginCapabilities: (...a: unknown[]) => capabilitiesMock(...a),
}));

vi.mock("@/lib/platform/electron-api", () => ({
  listenSafe: () => Promise.resolve(() => undefined),
  isElectronBridgeUnavailable: () => false,
}));

import { CasdoorSignInDialog } from "../src/CasdoorSignInDialog";

const baseConfig = {
  issuer: "",
  clientId: "",
  redirectUri: "casdoor://localhost/callback",
  scope: "openid profile email",
  smsProviderHint: "",
  wechatProviderHint: "",
  managementUrl: "",
  configured: false,
};

const session = (over: Record<string, unknown> = {}) => ({
  status: "signed_out",
  config: { ...baseConfig },
  identity: null,
  tenantContext: { availableTenantIds: [] },
  ...over,
});

describe("R48 CasdoorSignInDialog", () => {
  beforeEach(() => {
    cleanup();
    statusMock.mockReset();
    saveConfigMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    capabilitiesMock.mockReset();
  });

  it("未配置时展示 issuer / clientId 字段与「保存并登录」按钮", async () => {
    statusMock.mockResolvedValue(session());
    render(<CasdoorSignInDialog open onClose={() => undefined} />);

    expect(await screen.findByTestId("casdoor-signin-form")).toBeTruthy();
    expect(screen.getByTestId("casdoor-signin-issuer")).toBeTruthy();
    expect(screen.getByTestId("casdoor-signin-client-id")).toBeTruthy();
    const primary = screen.getByTestId("casdoor-signin-enterprise");
    expect(primary.textContent).toBe("保存并登录");
  });

  it("未配置时点登录:先保存配置再发起 Casdoor 授权", async () => {
    statusMock.mockResolvedValue(session());
    saveConfigMock.mockResolvedValue({ ...baseConfig, configured: true });
    statusMock
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(session({ config: { ...baseConfig, configured: true } }));
    loginMock.mockResolvedValue({ ok: true, url: "https://casdoor.example.com/login" });

    render(<CasdoorSignInDialog open onClose={() => undefined} />);
    await screen.findByTestId("casdoor-signin-form");

    fireEvent.change(screen.getByTestId("casdoor-signin-issuer"), {
      target: { value: "https://casdoor.example.com" },
    });
    fireEvent.change(screen.getByTestId("casdoor-signin-client-id"), {
      target: { value: "client-123" },
    });
    fireEvent.click(screen.getByTestId("casdoor-signin-enterprise"));

    await waitFor(() => expect(saveConfigMock).toHaveBeenCalledTimes(1));
    expect(saveConfigMock.mock.calls[0][0]).toMatchObject({
      issuer: "https://casdoor.example.com",
      clientId: "client-123",
    });
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("default"));
  });

  it("R48 — 控制台地址留空时用 issuer 同源兜底(主进程要求同源)", async () => {
    statusMock.mockResolvedValue(session());
    saveConfigMock.mockResolvedValue({ ...baseConfig, configured: true });
    loginMock.mockResolvedValue({ ok: false, error: "Casdoor 未配置" });

    render(<CasdoorSignInDialog open onClose={() => undefined} />);
    await screen.findByTestId("casdoor-signin-form");

    fireEvent.change(screen.getByTestId("casdoor-signin-issuer"), {
      target: { value: "https://casdoor.example.com:8443" },
    });
    fireEvent.change(screen.getByTestId("casdoor-signin-client-id"), {
      target: { value: "c1" },
    });
    fireEvent.click(screen.getByTestId("casdoor-signin-enterprise"));

    await waitFor(() => expect(saveConfigMock).toHaveBeenCalledTimes(1));
    expect(saveConfigMock.mock.calls[0][0]).toMatchObject({
      managementUrl: "https://casdoor.example.com:8443",
    });
  });

  it("未配置且字段为空时给出可处置的错误,不发授权请求", async () => {
    statusMock.mockResolvedValue(session());
    render(<CasdoorSignInDialog open onClose={() => undefined} />);
    await screen.findByTestId("casdoor-signin-form");

    fireEvent.click(screen.getByTestId("casdoor-signin-enterprise"));

    expect(await screen.findByTestId("casdoor-signin-message")).toBeTruthy();
    expect(screen.getByTestId("casdoor-signin-message").textContent).toContain("必填");
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("已配置时直接发起授权,并把用户能处置的文案写进 message", async () => {
    statusMock.mockResolvedValue(
      session({ config: { ...baseConfig, issuer: "https://c.example.com", clientId: "c1", configured: true } }),
    );
    capabilitiesMock.mockResolvedValue({
      enterprise: { enabled: true },
      sms: { enabled: false },
      wechat: { enabled: false },
    });
    loginMock.mockResolvedValue({ ok: false, error: "Casdoor 配置无效，请先完成企业身份配置" });

    render(<CasdoorSignInDialog open onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("casdoor-signin-enterprise")).toBeTruthy());

    fireEvent.click(screen.getByTestId("casdoor-signin-enterprise"));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith("default"),
    );
    const msg = await screen.findByTestId("casdoor-signin-message");
    // 配置类错误保留主进程原文(它逐项说明缺什么),不再被泛化成一句套话。
    expect(msg.textContent).toContain("Casdoor 配置无效");
  });

  it("已登录时展示身份与退出登录,退出后回调通知宿主", async () => {
    const onSessionChange = vi.fn();
    statusMock.mockResolvedValue(
      session({
        status: "signed_in",
        config: { ...baseConfig, issuer: "https://c.example.com", clientId: "c1", configured: true },
        identity: { subject: "u1", displayName: "张三", email: "zhangsan@example.com" },
      }),
    );
    logoutMock.mockResolvedValue({ ok: true });

    render(
      <CasdoorSignInDialog open onClose={() => undefined} onSessionChange={onSessionChange} />,
    );

    const identity = await screen.findByTestId("casdoor-signin-identity");
    expect(identity.textContent).toContain("张三");
    expect(screen.getByTestId("casdoor-signin-signout")).toBeTruthy();

    fireEvent.click(screen.getByTestId("casdoor-signin-signout"));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onSessionChange).toHaveBeenLastCalledWith(null),
    );
  });

  it("打开开关为 false 时不拉状态、不渲染内容", () => {
    render(<CasdoorSignInDialog open={false} onClose={() => undefined} />);
    expect(screen.queryByTestId("casdoor-signin-form")).toBeNull();
    expect(statusMock).not.toHaveBeenCalled();
  });
});
