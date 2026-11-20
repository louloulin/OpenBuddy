import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentResourcesPanel } from "../AgentResourcesPanel";
import { agentExtensionsPreviewPackage, agentExtensionsSearchRegistry, agentExtensionsSetEnabled, capabilityPackSetEnabled, capabilityPacksList, mcpAuthTrigger, mcpList, mcpTest } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  skillsList: vi.fn(async () => []), skillsAdd: vi.fn(), skillsRemove: vi.fn(), skillsToggle: vi.fn(),
  mcpList: vi.fn(async () => [{ name: "remote", transport: "streamable_http", target: "https://mcp.example.test", enabled: true, needsAuth: true }]),
  mcpTest: vi.fn(async () => ({ name: "remote", ok: true, ms: 42, transport: "streamable_http", tools: [{ name: "search" }, { name: "fetch" }] })),
  mcpToggle: vi.fn(async () => {}),
  mcpAuthTrigger: vi.fn(async () => ({ status: "authenticated" })),
  mcpDeferredGet: vi.fn(async () => ({ deferred: false })),
  mcpDeferredSet: vi.fn(async (deferred: boolean) => ({ deferred })),
  permissionList: vi.fn(async () => []),
  permissionSave: vi.fn(async () => {}),
  agentExtensionsList: vi.fn(async () => ({ enabled: false, paths: ["/trusted/extension.ts"], projectTrusted: true })),
  agentExtensionsSetEnabled: vi.fn(async () => ({ enabled: true, paths: ["/trusted/extension.ts"], projectTrusted: true })),
  agentExtensionsAdd: vi.fn(), agentExtensionsRemove: vi.fn(), agentExtensionsInspect: vi.fn(), agentExtensionsSetPathEnabled: vi.fn(),
  agentExtensionsPackages: vi.fn(async () => []), agentExtensionsInstallPackage: vi.fn(async () => []),
  agentExtensionsRemovePackage: vi.fn(async () => []), agentExtensionsUpdatePackages: vi.fn(async () => []),
  agentExtensionsPreviewPackage: vi.fn(async () => ({ source: "", extensions: [], skills: [], prompts: [], failures: [] })),
  agentExtensionsCheckUpdates: vi.fn(async () => []),
  agentExtensionsResources: vi.fn(async () => ({ extensions: [], skills: [], prompts: [], themes: [], failures: [] })),
  agentExtensionsSetPackageResources: vi.fn(async () => []),
  agentExtensionsSearchRegistry: vi.fn(async () => ({ query: "", source: "npm", total: 1, fetchedAt: 0, packages: [{ name: "pi-web-access", version: "1.2.0", description: "Web search", publisher: "pi", weeklyDownloads: 1234, keywords: ["pi-package"] }] })),
  onExtensionProgress: vi.fn(async () => () => {}),
  capabilityPacksList: vi.fn(async () => []),
  capabilityPackSetEnabled: vi.fn(async () => []),
  capabilityPackSetContribution: vi.fn(async () => []),
  capabilityPackRemove: vi.fn(async () => ({ packId: "wb", removed: true, kept: [] })),
}));
vi.mock("../../experts/connectors/McpConfigEditor", () => ({ McpConfigEditor: () => <div>MCP editor</div> }));
beforeEach(() => vi.clearAllMocks());

describe("MCP explicit OAuth", () => {
  it("only enables trusted extensions after an acknowledged user action and preserves state on failure", async () => {
    vi.mocked(agentExtensionsSetEnabled).mockRejectedValueOnce(new Error("session busy"));
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));
    const enabled = await screen.findByRole("checkbox", { name: "启用可信扩展" });
    expect(enabled).not.toBeChecked();
    expect(agentExtensionsSetEnabled).not.toHaveBeenCalled();
    fireEvent.click(enabled);
    expect(await screen.findByRole("alert")).toHaveTextContent("session busy");
    expect(enabled).not.toBeChecked();
    fireEvent.click(enabled);
    await waitFor(() => expect(enabled).toBeChecked());
  });

  it("lists each MCP server with a real 测试连接 and starts auth only on click", async () => {
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 配置" }));
    expect(await screen.findByText("需要授权")).toBeInTheDocument();
    expect(mcpAuthTrigger).not.toHaveBeenCalled();

    // 测试连接: one real connect, tools and duration shown on the card.
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/42ms/)).toBeInTheDocument();
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(mcpTest).toHaveBeenCalledWith("remote");

    // W2.4: sign-in no longer needs an open task — the session id is only a tag.
    fireEvent.click(screen.getByRole("button", { name: "授权" }));
    await waitFor(() => expect(mcpAuthTrigger).toHaveBeenCalledWith("", "remote"));
    expect(mcpList).toHaveBeenCalled();
  });

  it.each(["cancelled", "failed"])("shows %s auth results and leaves retry available", async status => {
    vi.mocked(mcpAuthTrigger).mockResolvedValue({ status });
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 配置" }));
    fireEvent.click(await screen.findByRole("button", { name: "授权" }));
    await waitFor(() => expect(mcpAuthTrigger).toHaveBeenCalled());
    // The card stays usable: 授权 can be retried.
    expect(screen.getByRole("button", { name: "授权" })).toBeEnabled();
  });

  it("searches npm for Pi packages and previews the install (S15)", async () => {
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));
    const input = await screen.findByLabelText("搜索 Pi 扩展包");
    fireEvent.change(input, { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("pi-web-access")).toBeInTheDocument();
    expect(agentExtensionsSearchRegistry).toHaveBeenCalledWith("web");
    expect(screen.getByText("1234 次/周")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查并安装" }));
    await waitFor(() => expect(agentExtensionsPreviewPackage).toHaveBeenCalledWith("npm:pi-web-access"));
  });

  it("manages an installed capability pack (B1a)", async () => {
    vi.mocked(capabilityPacksList).mockResolvedValue([{
      id: "rich-pack", name: "能力包", installedAt: 1, enabled: true, requires: ["EnableDocs"],
      contributions: [{ kind: "skill", name: "docx", enabled: true }, { kind: "prompt", name: "report", enabled: true }, { kind: "mcp", name: "calendar", enabled: false }],
      skipped: [{ kind: "hook", name: "hooks", reason: "需要宿主权限" }],
    }]);
    vi.mocked(capabilityPackSetEnabled).mockResolvedValue([{
      id: "rich-pack", name: "能力包", installedAt: 1, enabled: false, requires: ["EnableDocs"],
      contributions: [{ kind: "skill", name: "docx", enabled: false }, { kind: "prompt", name: "report", enabled: false }, { kind: "mcp", name: "calendar", enabled: false }],
      skipped: [],
    }]);
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));
    const row = await screen.findByText("rich-pack · 2/3 项启用 · 需要 EnableDocs");
    // Expanding lists each contribution for the per-item switches.
    fireEvent.click(row);
    expect(await screen.findByText("技能 · docx")).toBeInTheDocument();
    expect(screen.getByText(/跳过：hook:hooks/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "禁用" }));
    await waitFor(() => expect(capabilityPackSetEnabled).toHaveBeenCalledWith("rich-pack", false));
    expect(await screen.findByText("rich-pack · 0/3 项启用 · 需要 EnableDocs")).toBeInTheDocument();
  });
});
