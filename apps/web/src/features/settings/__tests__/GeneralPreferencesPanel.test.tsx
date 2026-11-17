import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";

// The tray preference lives in the main process (W4.4); the panel only mirrors it.
const trayState = { enabled: false };
vi.mock("@openbuddy/client/agent-client", () => ({
  trayGet: vi.fn(async () => ({ enabled: trayState.enabled })),
  traySet: vi.fn(async (enabled: boolean) => { trayState.enabled = enabled; return { enabled }; }),
}));
import { GeneralPreferencesPanel } from "../sections/GeneralPreferencesPanel";
import { AboutSettingsPanel } from "../sections/AboutSettingsPanel";
import { loadDensity, loadFontSize } from "../preferences";
import { getSendKey } from "../../composer/send-key";

/**
 * W6.3 通用偏好：主题 / 字号 / 密度 / 发送键。
 * 断言写 localStorage + `<html data-*>`，因为主进程不参与这些纯渲染层偏好。
 */
describe("GeneralPreferencesPanel (pii W6.3)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.fontSize;
    delete document.documentElement.dataset.density;
  });

  it("applies font size and density to <html> and localStorage", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GeneralPreferencesPanel />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "大" }));
    expect(loadFontSize()).toBe("large");
    expect(document.documentElement.dataset.fontSize).toBe("large");

    await user.click(screen.getByRole("button", { name: "紧凑" }));
    expect(loadDensity()).toBe("compact");
    expect(document.documentElement.dataset.density).toBe("compact");

    await user.click(screen.getByRole("button", { name: "标准" }));
    expect(loadFontSize()).toBe("normal");
  });

  it("switches the theme and the send key", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GeneralPreferencesPanel />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /深色/ }));
    expect(localStorage.getItem("openbuddy.theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Ctrl/Cmd+Enter" }));
    expect(getSendKey()).toBe("mod+enter");
    await user.click(screen.getByRole("button", { name: "Enter" }));
    expect(getSendKey()).toBe("enter");
  });

  it("mirrors the main-process tray preference and toggles it", async () => {
    trayState.enabled = false;
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <GeneralPreferencesPanel />
      </ThemeProvider>,
    );
    const group = await screen.findByRole("group", { name: "托盘常驻" });
    await waitFor(() => expect(group).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "开启" }));
    await waitFor(() => expect(trayState.enabled).toBe(true));
    expect(screen.getByRole("button", { name: "开启" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(trayState.enabled).toBe(false));
  });

  it("关于 shows the version and the Pi engine, without faking an update check", () => {
    render(<AboutSettingsPanel />);
    expect(screen.getByText("OpenBuddy")).toBeInTheDocument();
    expect(screen.getByText(/Pi 版 WorkBuddy/)).toBeInTheDocument();
    expect(screen.getByText("@earendil-works/pi-coding-agent")).toBeInTheDocument();
    expect(screen.queryByText(/检查更新/)).toBeNull();
  });
});
