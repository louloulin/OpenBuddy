import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
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

  it("关于 shows the version and the Pi engine, without faking an update check", () => {
    render(<AboutSettingsPanel />);
    expect(screen.getByText("OpenBuddy")).toBeInTheDocument();
    expect(screen.getByText(/Pi 版 WorkBuddy/)).toBeInTheDocument();
    expect(screen.getByText("@earendil-works/pi-coding-agent")).toBeInTheDocument();
    expect(screen.queryByText(/检查更新/)).toBeNull();
  });
});
