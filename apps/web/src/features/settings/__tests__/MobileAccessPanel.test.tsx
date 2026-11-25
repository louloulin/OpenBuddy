import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";

const invoke = vi.fn();

vi.mock("@openbuddy/client/ipc", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") },
}));

import { useCapabilitiesStore } from "@/app/state/capabilities-store";
import { MobileAccessPanel } from "../sections/MobileAccessPanel";

const future = () => new Date(Date.now() + 120_000).toISOString();

function grantCapability() {
  useCapabilitiesStore.getState().apply({
    protocolVersion: 1,
    platform: "desktop",
    commands: ["mobile_pair_start", "mobile_devices_list", "mobile_device_revoke"],
    events: [],
    features: [],
  } as never);
}

describe("MobileAccessPanel (20261115-mobile.md §4.4)", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(() => {
    cleanup();
    useCapabilitiesStore.getState().apply(null);
  });

  it("explains that a browser cannot mint pairing codes", () => {
    useCapabilitiesStore.getState().apply(null);
    render(<MobileAccessPanel />);
    expect(screen.getByText(/只能在桌面应用里生成/)).toBeTruthy();
  });

  it("lists this computer's phones and revokes one", async () => {
    grantCapability();
    invoke.mockImplementation(async (command: string) => {
      if (command === "mobile_devices_list") {
        return {
          configured: true,
          gatewayUrl: "https://gw.test",
          devices: [
            { id: "d1", name: "我的手机", platform: "ios", lastSeenAt: new Date().toISOString(), revokedAt: null },
            { id: "d2", name: "旧平板", platform: "android", lastSeenAt: null, revokedAt: new Date().toISOString() },
          ],
        };
      }
      if (command === "mobile_device_revoke") return { revoked: true };
      throw new Error(`unexpected ${command}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<ThemeProvider><MobileAccessPanel /></ThemeProvider>);

    await waitFor(() => expect(screen.getByText("我的手机")).toBeTruthy());
    expect(screen.getByText(/iOS · 最后连接 刚刚/)).toBeTruthy();
    expect(screen.getByText(/已断开/)).toBeTruthy();
    // A revoked device has nothing left to revoke.
    expect(screen.getAllByRole("button", { name: "断开" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "断开" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mobile_device_revoke", { id: "d1" }));
  });

  it("mints and shows a code with a QR", async () => {
    grantCapability();
    invoke.mockImplementation(async (command: string) => {
      if (command === "mobile_devices_list") return { configured: true, gatewayUrl: "https://gw.test", devices: [] };
      if (command === "mobile_pair_start") {
        return { code: "12345678", expiresAt: future(), scopes: ["sessions:read"], qr: "openbuddy://pair?gateway=x&code=12345678" };
      }
      throw new Error(`unexpected ${command}`);
    });
    const user = userEvent.setup();

    render(<ThemeProvider><MobileAccessPanel /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText("还没有手机连接过这台电脑。")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "生成配对码" }));

    await waitFor(() => expect(screen.getByText("1234 5678")).toBeTruthy());
    expect(screen.getByAltText("配对二维码").getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(screen.getByText(/秒内有效/)).toBeTruthy();
  });

  it("says what to configure when no gateway is set", async () => {
    grantCapability();
    invoke.mockResolvedValue({ configured: false, gatewayUrl: null, devices: [] });
    render(<ThemeProvider><MobileAccessPanel /></ThemeProvider>);
    await waitFor(() => expect(screen.getByText(/还没有配置网关/)).toBeTruthy());
    expect(screen.getByText(/OPENBUDDY_GATEWAY_ADMIN_TOKEN/)).toBeTruthy();
  });

  it("sends a real test notification and keeps remote control honestly disabled (G4-4)", async () => {
    grantCapability();
    invoke.mockImplementation(async (command: string) => {
      if (command === "mobile_devices_list") return { configured: true, gatewayUrl: "https://gw.test", devices: [] };
      if (command === "notification_append") return undefined;
      throw new Error(`unexpected ${command}`);
    });
    const user = userEvent.setup();
    render(<ThemeProvider><MobileAccessPanel /></ThemeProvider>);

    const push = await screen.findByRole("button", { name: "发送测试通知" });
    await user.click(push);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "notification_append",
        expect.objectContaining({ kind: "mobile", title: "发送测试通知" }),
      ),
    );

    const remote = screen.getByRole("button", { name: "未开放" });
    expect(remote).toBeDisabled();
    expect(screen.getByText(/远程控制需要系统辅助功能授权/)).toBeTruthy();
  });
});
