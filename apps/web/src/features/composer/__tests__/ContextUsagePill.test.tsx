import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ info: vi.fn(), usage: vi.fn(), compact: vi.fn(), set: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentSessionInfo: mocks.info,
  agentSessionUsage: mocks.usage,
  agentCompact: mocks.compact,
  settingsAgentSet: mocks.set,
}));

import { ContextUsagePill } from "../ContextUsagePill";
import { formatCost } from "../ContextUsageActions";

const context = {
  used: 50000, total: 128000, usagePct: 39, systemPromptTokens: 1000, toolDefinitionsCount: 5, toolDefinitionsTokens: 2000,
  messageCount: 4, messageTokens: 47000, turnCount: 2, toolCallCount: 0, compactionCount: 0, freeTokens: 78000,
};
const usage = { inputTokens: 1200, outputTokens: 180, totalTokens: 1380, cachedReadTokens: 300 };

async function openPopover() {
  render(<ContextUsagePill sessionId="s1" />);
  fireEvent.click(await screen.findByRole("button", { name: /上下文已使用/ }));
  await screen.findByText("上下文容量");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.mockResolvedValue({ sessionId: "s1", cwd: "/w", context, autoCompaction: true });
  mocks.usage.mockResolvedValue({ ...usage, cost: { total: 0.0063, priced: true, currency: "USD" } });
});

describe("context popover (pii W1.5)", () => {
  it("shows this session's cost when the model has prices, and no cost row without them", async () => {
    await openPopover();
    expect(await screen.findByText("本会话费用")).toBeInTheDocument();
    expect(screen.getByText("$0.0063")).toBeInTheDocument();
  });

  it("hides the cost when no price data is known", async () => {
    mocks.usage.mockResolvedValue({ ...usage, cost: { total: 0, priced: false, currency: "USD" } });
    await openPopover();
    await screen.findByRole("switch", { name: "自动压缩" });
    expect(screen.queryByText("本会话费用")).toBeNull();
  });

  it("立即压缩 compacts the session, reports the saving and refreshes the numbers", async () => {
    mocks.compact.mockResolvedValue({ tokensBefore: 50000, tokensAfter: 8000 });
    await openPopover();
    const callsBefore = mocks.info.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "立即压缩" }));
    expect(mocks.compact).toHaveBeenCalledWith("s1");
    expect(await screen.findByText("已压缩：50.0K → 8.0K")).toBeInTheDocument();
    await waitFor(() => expect(mocks.info.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("explains when there is nothing to compact yet", async () => {
    mocks.compact.mockRejectedValue(new Error("Error invoking remote method 'openbuddy:invoke': Error: Already compacted"));
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "立即压缩" }));
    expect(await screen.findByText("暂时没有可压缩的内容，对话再长一些后再试")).toHaveAttribute("role", "status");
  });

  it("the 自动压缩 switch saves the setting for every task", async () => {
    mocks.set.mockResolvedValue({ autoCompaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 20000 } });
    await openPopover();
    const toggle = await screen.findByRole("switch", { name: "自动压缩" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(mocks.set).toHaveBeenCalledWith({ autoCompaction: { enabled: false } });
    await waitFor(() => expect(screen.getByRole("switch", { name: "自动压缩" })).not.toBeChecked());
  });

  it("rolls the switch back when saving fails", async () => {
    mocks.set.mockRejectedValue(new Error("boom"));
    await openPopover();
    fireEvent.click(await screen.findByRole("switch", { name: "自动压缩" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("设置失败");
    expect(screen.getByRole("switch", { name: "自动压缩" })).toBeChecked();
  });

  it("formats small and large amounts", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.0063)).toBe("$0.0063");
    expect(formatCost(0.123)).toBe("$0.123");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});
