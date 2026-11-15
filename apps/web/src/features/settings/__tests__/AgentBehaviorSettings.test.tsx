import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AgentSettings } from "@openbuddy/protocol/agent-settings";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@openbuddy/client/api/model", () => ({ settingsAgentGet: mocks.get, settingsAgentSet: mocks.set }));

import { AgentBehaviorSettings, formatTokenCount, parseModelKey } from "../sections/AgentBehaviorSettings";

const base: AgentSettings = {
  autoCompaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  autoRetry: { enabled: true, maxRetries: 3 },
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  cacheWarming: "idle",
  favoriteModels: ["model:fixture/fixture-model", "model:other/a%2Fb"],
  builtins: [{ id: "mode", label: "模式记忆", description: "重新打开后自动恢复", enabled: true }],
};
let saved: AgentSettings;

beforeEach(() => {
  vi.clearAllMocks();
  saved = structuredClone(base);
  mocks.get.mockImplementation(async () => structuredClone(saved));
  mocks.set.mockImplementation(async (patch: Partial<AgentSettings> & { autoCompaction?: object; autoRetry?: object; builtins?: Record<string, boolean> }) => {
    saved = {
      ...saved,
      ...patch,
      autoCompaction: { ...saved.autoCompaction, ...patch.autoCompaction },
      autoRetry: { ...saved.autoRetry, ...patch.autoRetry },
      builtins: saved.builtins.map((b) => ({ ...b, enabled: patch.builtins?.[b.id] ?? b.enabled })),
    };
    return structuredClone(saved);
  });
});

describe("设置 · 智能体 运行行为 (pii W0.4)", () => {
  it("shows the saved values in groups with Chinese labels", async () => {
    render(<AgentBehaviorSettings />);
    expect(await screen.findByRole("switch", { name: "自动压缩" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "压缩时机" })).toHaveValue("16384");
    expect(screen.getByRole("combobox", { name: "最多重试次数" })).toHaveValue("3");
    expect(within(screen.getByRole("radiogroup", { name: "追加的发送方式" })).getByRole("radio", { name: "逐条" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("radiogroup", { name: "缓存预热" })).getByRole("radio", { name: "始终" })).toHaveAttribute("aria-checked", "true");
    const favorites = screen.getByRole("list", { name: "收藏的模型" });
    expect(within(favorites).getByText("fixture-model")).toBeInTheDocument();
    expect(within(favorites).getByText("a/b")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "模式记忆" })).toBeChecked();
  });

  it("saves a switch at once and greys out the settings that depend on it", async () => {
    render(<AgentBehaviorSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "自动压缩" }));
    expect(mocks.set).toHaveBeenCalledWith({ autoCompaction: { enabled: false } });
    await screen.findByText("已保存，已打开的任务立即生效");
    expect(screen.getByRole("combobox", { name: "压缩时机" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "自动压缩" })).not.toBeChecked();
  });

  it("saves thresholds, retry counts, queue delivery and cache warming", async () => {
    render(<AgentBehaviorSettings />);
    fireEvent.change(await screen.findByRole("combobox", { name: "压缩时机" }), { target: { value: "32768" } });
    expect(mocks.set).toHaveBeenLastCalledWith({ autoCompaction: { reserveTokens: 32768 } });
    fireEvent.change(screen.getByRole("combobox", { name: "最多重试次数" }), { target: { value: "5" } });
    expect(mocks.set).toHaveBeenLastCalledWith({ autoRetry: { maxRetries: 5 } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "追加的发送方式" })).getByRole("radio", { name: "合并" }));
    expect(mocks.set).toHaveBeenLastCalledWith({ followUpMode: "all" });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "插话的发送方式" })).getByRole("radio", { name: "合并" }));
    expect(mocks.set).toHaveBeenLastCalledWith({ steeringMode: "all" });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "缓存预热" })).getByRole("radio", { name: "关闭" }));
    expect(mocks.set).toHaveBeenLastCalledWith({ cacheWarming: "off" });
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "缓存预热" })).getByRole("radio", { name: "关闭" })).toHaveAttribute("aria-checked", "true"));
  });

  it("removes a favourite and switches a built-in off", async () => {
    render(<AgentBehaviorSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "取消收藏 fixture-model" }));
    expect(mocks.set).toHaveBeenLastCalledWith({ favoriteModels: ["model:other/a%2Fb"] });
    fireEvent.click(screen.getByRole("switch", { name: "模式记忆" }));
    expect(mocks.set).toHaveBeenLastCalledWith({ builtins: { mode: false } });
    await waitFor(() => expect(screen.getByRole("switch", { name: "模式记忆" })).not.toBeChecked());
  });

  it("reports a failed save and shows the stored values again", async () => {
    mocks.set.mockRejectedValueOnce(new Error("invalid_payload: patch.autoRetry.maxRetries"));
    render(<AgentBehaviorSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "自动重试" }));
    expect(await screen.findByText(/保存失败/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch", { name: "自动重试" })).toBeChecked());
  });

  it("formats token counts and model keys for display", () => {
    expect(formatTokenCount(16384)).toBe("16K");
    expect(formatTokenCount(20000)).toBe("20K");
    expect(formatTokenCount(512)).toBe("512");
    expect(parseModelKey("model:fixture/fixture-model")).toEqual({ provider: "fixture", model: "fixture-model" });
    expect(parseModelKey("model:open%20router/a%2Fb")).toEqual({ provider: "open router", model: "a/b" });
  });
});
