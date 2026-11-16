import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UsageQuotaPanel } from "../UsageQuotaPanel";
import { saveQuotaConfig } from "@/features/settings/usage-quota";
import type { UsageSnapshot } from "@openbuddy/protocol/usage";

const today = new Date().toISOString().slice(0, 10);
const snapshot: UsageSnapshot = {
  generatedAt: new Date().toISOString(),
  totals: { tokens: 700, prompt: 600, completion: 100, cost: 0.01, sessions: 2 },
  byDate: { [today]: { tokens: 700, cost: 0.01, sessions: 2 } },
  byModel: { "fixture/model-a": { tokens: 700, cost: 0.01, sessions: 2 } },
  byExpert: { "专家 · 分析师": { tokens: 400, cost: 0.005, sessions: 1 } },
  sessions: [
    { sessionId: "a", title: "季度分析", cwd: "/ws", at: new Date().toISOString(), modelKey: "fixture/model-a", expertName: "分析师", tokens: { input: 300, output: 100, total: 400 }, cost: 0.005, toolCalls: 2 },
    { sessionId: "b", title: "周报", cwd: "/ws", at: new Date().toISOString(), modelKey: "fixture/model-a", tokens: { input: 250, output: 50, total: 300 }, cost: 0.005, toolCalls: 1 },
  ],
};

const mocks = vi.hoisted(() => ({ usageSnapshot: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ usageSnapshot: mocks.usageSnapshot }));

beforeEach(() => {
  window.localStorage.removeItem("openbuddy.quota");
  mocks.usageSnapshot.mockReset();
});

describe("用量统计 (pii W5.6)", () => {
  it("reads the host snapshot instead of a localStorage ledger", async () => {
    mocks.usageSnapshot.mockResolvedValue(snapshot);
    const { container } = render(<UsageQuotaPanel />);
    await waitFor(() => expect(container.querySelector(".quota-panel__stat-value")?.textContent).toBe("700"));
    const stats = [...container.querySelectorAll(".quota-panel__stat-value")].map((el) => el.textContent);
    expect(stats).toEqual(["700", "2", "$0.0100"]); // token / 任务数 / 费用
    expect(screen.getByText("fixture/model-a")).toBeInTheDocument();
    expect(screen.getByText("专家 · 分析师")).toBeInTheDocument();
    expect(screen.getByText("季度分析")).toBeInTheDocument();
  });

  it("shows 0 for an empty snapshot", async () => {
    mocks.usageSnapshot.mockResolvedValue({ generatedAt: new Date().toISOString(), totals: { tokens: 0, prompt: 0, completion: 0, cost: 0, sessions: 0 }, byDate: {}, byModel: {}, byExpert: {}, sessions: [] });
    const { container } = render(<UsageQuotaPanel />);
    await waitFor(() => expect(container.querySelector(".quota-panel__stat-value")).toBeInTheDocument());
    expect([...container.querySelectorAll(".quota-panel__stat-value")].map((el) => el.textContent)).toEqual(["0", "0", "$0.0000"]);
    expect(screen.queryByText("按模型")).not.toBeInTheDocument();
  });

  it("keeps the local reminder threshold", async () => {
    mocks.usageSnapshot.mockResolvedValue(snapshot);
    saveQuotaConfig({ period: "daily", tokenLimit: 500 });
    render(<UsageQuotaPanel />);
    await waitFor(() => expect(screen.getByText(/700 \/ 500/)).toBeInTheDocument());
    expect(screen.getByText("已达到提醒阈值，仍可发送")).toBeInTheDocument();
    fireEvent.click(screen.getByText("本月"));
    expect(screen.getByText("Token")).toBeInTheDocument();
  });
});
