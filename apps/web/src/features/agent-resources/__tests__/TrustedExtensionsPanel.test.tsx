import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TrustedExtensionsPanel } from "../TrustedExtensionsPanel";
import type { ExtensionPackage } from "@openbuddy/protocol/extensions";
import {
  agentExtensionsInstallPackage,
  agentExtensionsList,
  agentExtensionsPackages,
  agentExtensionsUpdatePackages,
  agentExtensionsPreviewPackage,
  agentExtensionsCheckUpdates,
  agentExtensionsResources,
  agentExtensionsSetPackageResources,
} from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  agentExtensionsList: vi.fn(),
  agentExtensionsPackages: vi.fn(),
  agentExtensionsInstallPackage: vi.fn(),
  agentExtensionsRemovePackage: vi.fn(),
  agentExtensionsUpdatePackages: vi.fn(),
  agentExtensionsPreviewPackage: vi.fn(),
  agentExtensionsCheckUpdates: vi.fn(async () => []),
  agentExtensionsResources: vi.fn(async () => ({ extensions: [], skills: [], prompts: [], themes: [], failures: [] })),
  agentExtensionsSetPackageResources: vi.fn(),
  agentExtensionsSearchRegistry: vi.fn(async () => ({ query: "", source: "npm", total: 0, fetchedAt: 0, packages: [] })),
  agentExtensionsAdd: vi.fn(),
  agentExtensionsRemove: vi.fn(),
  agentExtensionsInspect: vi.fn(),
  agentExtensionsSetEnabled: vi.fn(),
  agentExtensionsSetPathEnabled: vi.fn(),
  onExtensionProgress: vi.fn(async () => () => {}),
}));
vi.mock("@openbuddy/client/ipc", () => ({ dialog: { open: vi.fn() } }));

const config = { enabled: true, paths: [], items: [], errors: [], projectTrusted: false };
const installed: ExtensionPackage[] = [{ source: "owner/repo", scope: "user", filtered: false, installedPath: "/x/owner/repo" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentExtensionsList).mockResolvedValue(config);
  vi.mocked(agentExtensionsPackages).mockResolvedValue([]);
  vi.mocked(agentExtensionsInstallPackage).mockResolvedValue(installed);
  vi.mocked(agentExtensionsUpdatePackages).mockResolvedValue(installed);
});

describe("扩展中心 · npm / git 安装 (pii W2.6 P2)", () => {
  it("installs a package source and lists it", async () => {
    render(<TrustedExtensionsPanel />);
    await screen.findByText("从 npm / git 安装");
    fireEvent.change(screen.getByLabelText("扩展包来源"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() => expect(agentExtensionsInstallPackage).toHaveBeenCalledWith("owner/repo"));
    expect((await screen.findAllByText("owner/repo")).length).toBeGreaterThan(0);
    expect(screen.getByText("用户")).toBeInTheDocument();
  });

  it("updates every configured package", async () => {
    vi.mocked(agentExtensionsPackages).mockResolvedValue(installed);
    render(<TrustedExtensionsPanel />);
    await screen.findByText("owner/repo");
    fireEvent.click(screen.getByRole("button", { name: "全部更新" }));
    await waitFor(() => expect(agentExtensionsUpdatePackages).toHaveBeenCalledWith(undefined));
  });

  it("previews a package's registrations before installing", async () => {
    vi.mocked(agentExtensionsPreviewPackage).mockResolvedValue({
      source: "owner/repo",
      extensions: [{ path: "/tmp/ext.ts", tools: ["read"], commands: ["hello"], shortcuts: [], error: null }],
      skills: [], prompts: [], failures: [],
    });
    render(<TrustedExtensionsPanel />);
    await screen.findByText("从 npm / git 安装");
    fireEvent.change(screen.getByLabelText("扩展包来源"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));
    expect(await screen.findByRole("dialog", { name: "扩展包预览" })).toBeInTheDocument();
    expect(screen.getByText("/hello")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "信任并安装" }));
    await waitFor(() => expect(agentExtensionsInstallPackage).toHaveBeenCalledWith("owner/repo"));
  });

  it("checks for available package updates", async () => {
    vi.mocked(agentExtensionsPackages).mockResolvedValue(installed);
    vi.mocked(agentExtensionsCheckUpdates).mockResolvedValue([{ source: "owner/repo", displayName: "owner/repo", type: "git", scope: "user" }]);
    render(<TrustedExtensionsPanel />);
    await screen.findByText("owner/repo");
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText(/1 个扩展包可更新/)).toBeInTheDocument();
    expect(screen.getByText(/用户 · 可更新/)).toBeInTheDocument();
  });

  it("switches a package's resource kinds through Pi's package filters (S17)", async () => {
    vi.mocked(agentExtensionsPackages).mockResolvedValue(installed);
    vi.mocked(agentExtensionsResources).mockResolvedValue({
      extensions: [{ source: "owner/repo", scope: "user", path: "/x/ext.ts", enabled: true }],
      skills: [{ source: "owner/repo", scope: "user", path: "/x/skills/a", enabled: true }],
      prompts: [], themes: [], failures: [],
    });
    vi.mocked(agentExtensionsSetPackageResources).mockResolvedValue([{ ...installed[0]!, filters: { skills: false } }]);
    render(<TrustedExtensionsPanel />);
    await screen.findByText("owner/repo");
    const toggle = await screen.findByRole("checkbox", { name: "owner/repo 技能" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(agentExtensionsSetPackageResources).toHaveBeenCalledWith("owner/repo", { skills: false }));
  });
});
