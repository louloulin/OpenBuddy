import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { appsList, appsSetEnabled } from "@openbuddy/client/api/files";
import {
  agentExtensionsPackages,
  agentExtensionsSetPackageResources,
  capabilityPackSetEnabled,
  capabilityPacksList,
} from "@openbuddy/client/agent-client";
import { ApplicationPicker } from "../ApplicationPicker";

vi.mock("@openbuddy/client/api/files", () => ({
  appsList: vi.fn(async () => []),
  appsIcon: vi.fn(async () => ({ dataUri: null })),
  appsSetEnabled: vi.fn(async () => ({ packageSource: "", enabled: false })),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  capabilityPacksList: vi.fn(),
  capabilityPackSetEnabled: vi.fn(),
  agentExtensionsPackages: vi.fn(),
  agentExtensionsSetPackageResources: vi.fn(),
}));

describe("应用选择器 (G1-16)", () => {
  it("lists the installed capability packs and toggles them", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([
      { id: "pack-1", name: "写作包", version: "1.2.0", installedAt: 0, enabled: true, requires: [], contributions: [{ kind: "skill", name: "s1", enabled: true }], skipped: [] },
    ] as never);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([]);
    vi.mocked(capabilityPackSetEnabled).mockResolvedValue([]);
    render(<ApplicationPicker />);
    expect(await screen.findByText("写作包")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /写作包/ }));
    await waitFor(() => expect(capabilityPackSetEnabled).toHaveBeenCalledWith("pack-1", false));
  });

  it("says so when nothing is installed", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([]);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([]);
    render(<ApplicationPicker />);
    expect(await screen.findByText("还没有安装任何应用")).toBeInTheDocument();
  });

  it("lists the installed Pi packages and can stop loading them", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([]);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([
      { source: "npm:pi-web-access", scope: "user", filtered: false },
    ] as never);
    vi.mocked(agentExtensionsSetPackageResources).mockResolvedValue([]);
    render(<ApplicationPicker cwd="/ws" />);
    expect(await screen.findByText("pi-web-access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pi-web-access/ }));
    await waitFor(() => expect(agentExtensionsSetPackageResources).toHaveBeenCalledWith(
      "npm:pi-web-access",
      { extensions: false, skills: false, prompts: false, themes: false },
      "/ws",
    ));
  });

  it("有 pi.app 的包装成「应用」卡：显示定位并按应用整体启停（UP-2.4）", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([] as never);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([
      { source: "/repo/upup", scope: "user", filtered: false, installedPath: "/repo/upup" },
    ] as never);
    vi.mocked(appsList).mockResolvedValue([
      { id: "upup", name: "upup", kind: "app", source: "pi", packageSource: "/repo/upup", installedPath: "/repo/upup", tagline: "证券智能投研助手", category: "finance" },
    ]);
    vi.mocked(appsSetEnabled).mockResolvedValue({ packageSource: "/repo/upup", enabled: false });

    render(<ApplicationPicker />);
    expect(await screen.findByText("应用")).toBeInTheDocument();
    expect(screen.getByText(/证券智能投研助手/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用 upup" }));
    await waitFor(() => expect(appsSetEnabled).toHaveBeenCalledWith("/repo/upup", false));
  });

  it("应用带场景时渲染「应用场景」chip，点击把 prompt 交给回调（UP-4.1）", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([] as never);
    vi.mocked(agentExtensionsPackages).mockResolvedValue([
      { source: "/repo/upup", scope: "user", filtered: false, installedPath: "/repo/upup" },
    ] as never);
    vi.mocked(appsList).mockResolvedValue([
      {
        id: "upup", name: "upup", kind: "app", source: "pi", packageSource: "/repo/upup",
        sceneList: [{ id: "deep", name: "个股深研", group: "投研", prompt: "/invest 600519.SH" }],
      },
    ]);
    const onPick = vi.fn();
    render(<ApplicationPicker onPickPrompt={onPick} />);
    fireEvent.click(await screen.findByRole("button", { name: "场景 个股深研" }));
    expect(onPick).toHaveBeenCalledWith("/invest 600519.SH");
  });
});
