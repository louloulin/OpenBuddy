import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotifyChannelsPanel } from "@openbuddy/ui-mcp";
import { resetNotifyChannels, registerNotifyChannel } from "@/lib/notify/notify-channels";

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
  });

  it("移除渠道", () => {
    registerNotifyChannel({ id: "test", label: "Test", kind: "generic-webhook", enabled: true });
    render(<NotifyChannelsPanel onToast={vi.fn()} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("移除"));
    expect(screen.queryByText("Test")).toBeNull();
  });

  it("切换启用/禁用", () => {
    registerNotifyChannel({ id: "test", label: "Test", kind: "generic-webhook", enabled: true });
    render(<NotifyChannelsPanel />);
    const toggle = screen.getByTitle("禁用");
    fireEvent.click(toggle);
    // 切换后按钮 title 变为"启用"。
    expect(screen.getByTitle("启用")).toBeInTheDocument();
  });

  it("测试发送调用 dispatchNotification", async () => {
    // mock fetch(webhook 发送)。
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response)) as unknown as typeof fetch;
    registerNotifyChannel({
      id: "test",
      label: "Webhook",
      kind: "generic-webhook",
      endpoint: "http://localhost:9999/hook",
      enabled: true,
    });
    const onToast = vi.fn();
    render(<NotifyChannelsPanel onToast={onToast} />);
    fireEvent.click(screen.getByText("测试"));
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    globalThis.fetch = origFetch;
  });
});
