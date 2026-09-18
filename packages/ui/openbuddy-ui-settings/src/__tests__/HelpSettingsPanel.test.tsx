/**
 * HelpSettingsPanel.test.tsx — R64 「重新观看引导」入口测试。
 *
 * 验证三件事:
 *   1. onReplayTour 未传时:不渲染按钮(SettingsPanel 没接 host 的能力时,
 *      不会硬塞一个点了没反应的 button);
 *   2. onReplayTour 传入时:渲染一个 data-testid="replay-tour" 的按钮,
 *      点击后真的调用 host 注入的回调;
 *   3. 不依赖任何 slot / runtime,纯组件层断言。
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { HelpSettingsPanel } from "../SettingsSections";

afterEach(() => cleanup());

describe("HelpSettingsPanel — R64 重新观看引导入口", () => {
  it("onReplayTour 未传时:不渲染「重新观看引导」按钮", () => {
    render(<HelpSettingsPanel />);
    expect(screen.queryByTestId("replay-tour")).toBeNull();
  });

  it("onReplayTour 传入时:渲染按钮 + 点击后真的调用 host 回调", () => {
    const onReplayTour = vi.fn();
    render(<HelpSettingsPanel onReplayTour={onReplayTour} />);
    const btn = screen.getByTestId("replay-tour");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("重新观看引导");
    fireEvent.click(btn);
    expect(onReplayTour).toHaveBeenCalledTimes(1);
  });

  it("不传时仍渲染「关于」section 的文档链接(向后兼容)", () => {
    render(<HelpSettingsPanel />);
    expect(screen.getByText("ACP 协议规范")).toBeTruthy();
    expect(screen.getByText("OpenBuddy / Pi 使用文档")).toBeTruthy();
  });
});
