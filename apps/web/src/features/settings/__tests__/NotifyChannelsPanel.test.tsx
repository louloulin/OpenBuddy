import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotifyChannelsPanel } from "../NotifyChannelsPanel";
import { resetNotifyChannels, registerNotifyChannel, listAllNotifyChannels } from "@/features/settings/notify-channels";

describe("NotifyChannelsPanel", () => {
  beforeEach(resetNotifyChannels);

  it("无渠道时显示空态", () => {
    render(<NotifyChannelsPanel />);
    expect(screen.getByText("暂无通知渠道")).toBeInTheDocument();
  });

  it("添加渠道后显示在列表", () => {
    render(<NotifyChannelsPanel onToast={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "我的Slack" } });
    fireEvent.change(inputs[1], { target: { value: "https://hooks.slack.com/x" } });
    fireEvent.click(screen.getByText("+ 添加"));
    expect(screen.getByText("我的Slack")).toBeInTheDocument();
    expect(listAllNotifyChannels()[0].enabled).toBe(false);
  });

  it("移除渠道", () => {
    registerNotifyChannel({ id: "test", label: "Test", kind: "generic-webhook", enabled: true });
    render(<NotifyChannelsPanel onToast={vi.fn()} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("移除"));
    expect(screen.queryByText("Test")).toBeNull();
  });

  it("渠道尚未接入时不能启用发送", () => {
    registerNotifyChannel({ id: "test", label: "Test", kind: "generic-webhook", enabled: true });
    render(<NotifyChannelsPanel />);
    expect(screen.getByTitle("渠道尚未接入主进程，不能启用发送")).toBeDisabled();
    expect(screen.getByText(/渠道配置尚未接入主进程/)).toBeInTheDocument();
    expect(screen.getByText("未接入发送")).toBeInTheDocument();
  });

  it("禁用发送测试且不会发起外部网络请求", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);
    registerNotifyChannel({ id: "test", label: "Webhook", kind: "generic-webhook", endpoint: "https://example.com/hook", enabled: true });
    const onToast = vi.fn(); render(<NotifyChannelsPanel onToast={onToast} />);
    const test = screen.getByRole("button", { name: "测试" });
    expect(test).toBeDisabled(); fireEvent.click(test);
    expect(fetch).not.toHaveBeenCalled(); expect(onToast).not.toHaveBeenCalled(); fetch.mockRestore();
  });
});
