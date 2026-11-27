import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppsPanel } from "../AppsPanel";

const appsList = vi.fn();
const appsSetEnabled = vi.fn();
const appsIcon = vi.fn();
const appsInstallState = vi.fn();
const appsUpdate = vi.fn();
const appsRollback = vi.fn();
const appsEnsureDefault = vi.fn();
const appsHygiene = vi.fn();
const appsHygieneKeep = vi.fn();
const agentExtensionsPackages = vi.fn();
const agentExtensionsPreviewPackage = vi.fn();
const agentExtensionsList = vi.fn();
const agentExtensionsSetEnabled = vi.fn();
const agentExtensionsCheckUpdates = vi.fn();
vi.mock("@openbuddy/client/api/files", () => ({
  appsList: (...args: unknown[]) => appsList(...args),
  appsSetEnabled: (...args: unknown[]) => appsSetEnabled(...args),
  appsIcon: (...args: unknown[]) => appsIcon(...args),
  appsInstallState: (...args: unknown[]) => appsInstallState(...args),
  appsUpdate: (...args: unknown[]) => appsUpdate(...args),
  appsRollback: (...args: unknown[]) => appsRollback(...args),
  appsEnsureDefault: (...args: unknown[]) => appsEnsureDefault(...args),
  appsHygiene: (...args: unknown[]) => appsHygiene(...args),
  appsHygieneKeep: (...args: unknown[]) => appsHygieneKeep(...args),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentExtensionsPackages: (...args: unknown[]) => agentExtensionsPackages(...args),
  agentExtensionsPreviewPackage: (...args: unknown[]) => agentExtensionsPreviewPackage(...args),
  agentExtensionsList: (...args: unknown[]) => agentExtensionsList(...args),
  agentExtensionsSetEnabled: (...args: unknown[]) => agentExtensionsSetEnabled(...args),
  agentExtensionsCheckUpdates: (...args: unknown[]) => agentExtensionsCheckUpdates(...args),
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
  agentExtensionsPreviewPackage.mockReset().mockResolvedValue({
    source: "https://gitcode.com/lumosaigroup/upup.git",
    extensions: [{ path: "extensions/index.ts", tools: Array.from({ length: 436 }, (_, i) => `t${i}`), commands: [], shortcuts: [], error: null }],
    skills: [],
    prompts: [],
    failures: [],
  });
  agentExtensionsList.mockReset().mockResolvedValue({ enabled: true, paths: [], projectTrusted: true });
  agentExtensionsSetEnabled.mockReset().mockResolvedValue({ enabled: true, paths: [], projectTrusted: true });
  agentExtensionsCheckUpdates.mockReset().mockResolvedValue([]);
  appsInstallState.mockReset().mockResolvedValue({});
  appsUpdate.mockReset().mockResolvedValue({ packageSource: "/repo/upup", packages: [], install: null, canRollback: false });
  appsRollback.mockReset().mockResolvedValue({ packageSource: "/repo/upup", rolledBackTo: "/repo/upup", packages: [] });
  appsHygiene.mockReset().mockResolvedValue({ idle: [] });
  appsHygieneKeep.mockReset().mockResolvedValue({ kept: true });
  appsEnsureDefault.mockReset().mockResolvedValue({ installed: true, source: "https://gitcode.com/lumosaigroup/upup.git", packages: [], extensionsEnabled: true });
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

  it("内置通用应用显示「内置」标记且没有启停开关", async () => {
    appsList.mockResolvedValue([
      { id: "openbuddy", name: "OpenBuddy", kind: "app", source: "builtin", tagline: "通用智能助手", category: "general" },
    ]);
    render(<AppsPanel />);
    expect(await screen.findByText("OpenBuddy")).toBeInTheDocument();
    expect(screen.getByText("内置")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("未安装 UpUp 时显示 Git 安装入口：先预演，再确认安装", async () => {
    appsList.mockResolvedValue([]);
    agentExtensionsPackages.mockResolvedValue([]);
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "检查并安装" }));
    await waitFor(() => expect(agentExtensionsPreviewPackage).toHaveBeenCalledWith("https://gitcode.com/lumosaigroup/upup.git"));
    fireEvent.click(await screen.findByRole("button", { name: /确认安装（436 个工具）/ }));
    await waitFor(() => expect(appsEnsureDefault).toHaveBeenCalledWith("https://gitcode.com/lumosaigroup/upup.git"));
  });

  it("已安装 UpUp 后不再显示 Git 安装入口", async () => {
    render(<AppsPanel />);
    await screen.findByText("upup");
    expect(screen.queryByRole("region", { name: "安装 UpUp" })).toBeNull();
  });

  it("安装 UpUp 走宿主命令，安装即启用并记录版本 (U1/U6)", async () => {
    appsList.mockResolvedValue([]);
    agentExtensionsPackages.mockResolvedValue([]);
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "检查并安装" }));
    fireEvent.click(await screen.findByRole("button", { name: /确认安装（436 个工具）/ }));
    await waitFor(() => expect(appsEnsureDefault).toHaveBeenCalledWith("https://gitcode.com/lumosaigroup/upup.git"));
  });

  it("扩展总开关关闭时给出启用入口 (U1)", async () => {
    agentExtensionsList.mockResolvedValue({ enabled: false, paths: [], projectTrusted: true });
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "启用扩展" }));
    await waitFor(() => expect(agentExtensionsSetEnabled).toHaveBeenCalledWith(true));
  });

  it("检查到更新后卡片可直接更新 (U2)", async () => {
    agentExtensionsCheckUpdates.mockResolvedValue([
      { source: "/repo/upup", displayName: "upup", type: "git", scope: "user" },
    ]);
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "检查更新" }));
    fireEvent.click(await screen.findByRole("button", { name: "更新 upup" }));
    await waitFor(() => expect(appsUpdate).toHaveBeenCalledWith("/repo/upup"));
  });
});

describe("安装来源与回滚 (U6)", () => {
  it("卡片显示当前版本，有上一份记录时给回滚入口", async () => {
    appsInstallState.mockResolvedValue({
      "/repo/upup": {
        current: { source: "/repo/upup", version: "2026.11.27", at: "2026-11-27T00:00:00.000Z" },
        previous: { source: "/repo/upup", version: "2026.11.20", at: "2026-11-20T00:00:00.000Z" },
      },
    });
    render(<AppsPanel />);
    expect(await screen.findByText("当前版本 2026.11.27")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回滚 upup" }));
    await waitFor(() => expect(appsRollback).toHaveBeenCalledWith("/repo/upup"));
  });

  it("只有当前记录（没有上一份）时不显示回滚", async () => {
    appsInstallState.mockResolvedValue({
      "/repo/upup": { current: { source: "/repo/upup", version: "2026.11.27", at: "2026-11-27T00:00:00.000Z" } },
    });
    render(<AppsPanel />);
    expect(await screen.findByText("当前版本 2026.11.27")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "回滚 upup" })).toBeNull();
  });
});

describe("上下文治理 (U5 / UP-6.4)", () => {
  const idle = [{ appId: "upup", name: "upup", packageSource: "/repo/upup", lastUsedAt: "2026-10-01", idleDays: 57 }];

  it("≥14 天未用的应用显示提醒，「停用」调用 apps_set_enabled(false)", async () => {
    appsHygiene.mockResolvedValue({ idle });
    render(<AppsPanel />);
    expect(await screen.findByText("57 天未使用（最近 2026-10-01）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停用 upup" }));
    await waitFor(() => expect(appsSetEnabled).toHaveBeenCalledWith("/repo/upup", false));
  });

  it("「保留」记下并立即收起提醒", async () => {
    appsHygiene.mockResolvedValue({ idle });
    render(<AppsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "保留" }));
    await waitFor(() => expect(appsHygieneKeep).toHaveBeenCalledWith("/repo/upup"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "长期未使用的应用" })).toBeNull());
  });

  it("没有长期未用的应用时不显示", async () => {
    render(<AppsPanel />);
    await screen.findByText("证券智能投研助手");
    expect(screen.queryByRole("region", { name: "长期未使用的应用" })).toBeNull();
  });
});
