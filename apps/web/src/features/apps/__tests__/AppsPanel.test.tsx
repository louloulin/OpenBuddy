import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppsPanel } from "../AppsPanel";

const appsList = vi.fn();
const appsSetEnabled = vi.fn();
const appsIcon = vi.fn();
const agentExtensionsPackages = vi.fn();
vi.mock("@openbuddy/client/api/files", () => ({
  appsList: (...args: unknown[]) => appsList(...args),
  appsSetEnabled: (...args: unknown[]) => appsSetEnabled(...args),
  appsIcon: (...args: unknown[]) => appsIcon(...args),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentExtensionsPackages: (...args: unknown[]) => agentExtensionsPackages(...args),
}));


beforeEach(() => {
  appsList.mockReset().mockResolvedValue([
    {
      id: "upup", name: "upup", kind: "app", source: "pi", packageSource: "/repo/upup",
      tagline: "证券智能投研助手", category: "finance",
      sceneList: [{ id: "deep", name: "个股深研", prompt: "/invest 600519.SH" }],
      toolPolicy: { deny: ["place_trade_order"] },
    },
    { id: "pi-memory", name: "pi-memory", kind: "extension", source: "pi", installedPath: "/r/pi-memory" },
  ]);
  appsSetEnabled.mockReset().mockResolvedValue({ packageSource: "/repo/upup", enabled: false });
  appsIcon.mockReset().mockResolvedValue({ dataUri: null });
  agentExtensionsPackages.mockReset().mockResolvedValue([
    { source: "/repo/upup", scope: "user", filtered: false, installedPath: "/repo/upup" },
  ]);
});

describe("应用页 (UP-2.4)", () => {
  it("应用与扩展包分栏，应用卡显示定位/分类/场景/策略", async () => {
    render(<AppsPanel />);
    expect(await screen.findByText("upup")).toBeInTheDocument();
    expect(screen.getByText("证券智能投研助手")).toBeInTheDocument();
    expect(screen.getByText("finance")).toBeInTheDocument();
    expect(screen.getByText("已拒绝 place_trade_order")).toBeInTheDocument();
    expect(screen.getByText("扩展包")).toBeInTheDocument();
    expect(screen.getByText("pi-memory")).toBeInTheDocument();
  });

  it("开关按应用整体启停", async () => {
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: /upup/ }));
    await waitFor(() => expect(appsSetEnabled).toHaveBeenCalledWith("/repo/upup", false));
  });

  it("场景 chip 把 prompt 交给上层（填首页输入框）", async () => {
    const onPickPrompt = vi.fn();
    render(<AppsPanel onPickPrompt={onPickPrompt} />);
    fireEvent.click(await screen.findByRole("button", { name: "场景 个股深研" }));
    expect(onPickPrompt).toHaveBeenCalledWith("/invest 600519.SH");
  });

  it("没有安装任何应用时给空态", async () => {
    appsList.mockResolvedValue([]);
    agentExtensionsPackages.mockResolvedValue([]);
    render(<AppsPanel />);
    expect(await screen.findByText("还没有安装任何应用")).toBeInTheDocument();
  });
});
