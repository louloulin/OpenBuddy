import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotifyChannelsPanel } from "../NotifyChannelsPanel";
import type { NotifyChannel } from "@openbuddy/protocol/notifications";

// 20261116-pii W4.6：渠道的配置与发送都在主进程，面板只调用宿主命令。
const { list, save, remove, test } = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  notifyChannelsList: list,
  notifyChannelsSave: save,
  notifyChannelsDelete: remove,
  notifyChannelsTest: test,
}));

const channel = (patch: Partial<NotifyChannel> = {}): NotifyChannel => ({
  id: "ch1",
  label: "群机器人",
  kind: "slack-webhook",
  endpoint: "https://hooks.example/x",
  enabled: true,
  ...patch,
});

beforeEach(() => {
  list.mockReset();
  save.mockReset();
  remove.mockReset();
  test.mockReset();
});

describe("NotifyChannelsPanel", () => {
  it("无渠道时显示空态", async () => {
    list.mockResolvedValue([]);
    render(<NotifyChannelsPanel />);
    await waitFor(() => expect(screen.getByText("暂无通知渠道")).toBeInTheDocument());
  });

  it("列出主进程返回的渠道", async () => {
    list.mockResolvedValue([channel()]);
    render(<NotifyChannelsPanel />);
    await waitFor(() => expect(screen.getByText("群机器人")).toBeInTheDocument());
    // 「Slack」既是行类型也是下拉选项，取行内的那一个。
    expect(screen.getByText("Slack", { selector: ".notify-panel__row-kind" })).toBeInTheDocument();
  });

  it("添加渠道时调用宿主的保存命令", async () => {
    list.mockResolvedValue([]);
    save.mockResolvedValue(channel());
    render(<NotifyChannelsPanel />);
    await waitFor(() => expect(screen.getByText("暂无通知渠道")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("渠道类型"), { target: { value: "generic-webhook" } });
    fireEvent.change(screen.getByPlaceholderText("Webhook URL"), { target: { value: "https://hooks.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      kind: "generic-webhook",
      endpoint: "https://hooks.example/new",
      enabled: true,
    });
  });

  it("测试发送走宿主命令并提示结果", async () => {
    list.mockResolvedValue([channel()]);
    test.mockResolvedValue({ id: "ch1", ok: true });
    const toast = vi.fn();
    render(<NotifyChannelsPanel onToast={toast} />);
    await waitFor(() => expect(screen.getByText("群机器人")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "测试" }));
    await waitFor(() => expect(test).toHaveBeenCalledWith("ch1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("测试消息已发送")));
  });

  it("停用与移除也走宿主命令", async () => {
    list.mockResolvedValue([channel()]);
    save.mockResolvedValue(channel({ enabled: false }));
    remove.mockResolvedValue(undefined);
    render(<NotifyChannelsPanel />);
    await waitFor(() => expect(screen.getByText("群机器人")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "停用 群机器人" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "ch1", enabled: false })));
    fireEvent.click(screen.getByRole("button", { name: "移除 群机器人" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("ch1"));
  });
});
