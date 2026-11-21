import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentResourcesPanel } from "../AgentResourcesPanel";
import { agentExtensionsPackageDetails, agentExtensionsPackages, agentExtensionsPreviewPackage, agentExtensionsResources, agentExtensionsSearchRegistry, agentExtensionsSetEnabled, agentExtensionsSetPackageResources, capabilityPackSetEnabled, capabilityPacksList, mcpAuthTrigger, mcpList, mcpTest } from "@openbuddy/client/agent-client";
import { readTextFile } from "@openbuddy/client/api/files";

vi.mock("@openbuddy/client/api/files", () => ({ readTextFile: vi.fn() }));

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
  agentExtensionsPackageDetails: vi.fn(async () => ({ name: "pi-web-access", version: "1.2.0", maintainers: [], categories: [] })),
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

  it("shows npm scores and the package changelog Pi resolved (E1)", async () => {
    vi.mocked(agentExtensionsSearchRegistry).mockResolvedValue({
      query: "web", source: "npm", total: 1, from: 0, fetchedAt: 0,
      packages: [{
        name: "pi-web-access", version: "1.2.0", description: "Web search", weeklyDownloads: 1234,
        score: { final: 0.912, quality: 0.9, popularity: 0.55, maintenance: 0.777 },
        repository: "https://github.com/a/b", npmUrl: "https://www.npmjs.com/package/pi-web-access", keywords: ["pi-package"],
      }],
    });
    vi.mocked(agentExtensionsPackages).mockResolvedValue([{ source: "npm:pi-web-access", scope: "user", filtered: false, installedPath: "/pi/pi-web-access" }]);
    vi.mocked(agentExtensionsResources).mockResolvedValue({
      extensions: [{ source: "npm:pi-web-access", scope: "user", path: "/pi/pi-web-access/index.js", enabled: true, changelogPath: "/pi/pi-web-access/CHANGELOG.md" }],
      skills: [], prompts: [], themes: [], failures: [],
    });
    vi.mocked(readTextFile).mockResolvedValue("# 1.2.0\n- Faster search");
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));

    // The installed package offers the changelog Pi reported, read locally and bounded.
    fireEvent.click(await screen.findByRole("button", { name: "更新日志" }));
    await waitFor(() => expect(readTextFile).toHaveBeenCalledWith("/pi/pi-web-access/CHANGELOG.md", 64 * 1024));
    expect(await screen.findByText(/Faster search/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("质量 90")).toBeInTheDocument();
    expect(screen.getByText("人气 55")).toBeInTheDocument();
    expect(screen.getByText("维护 78")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "仓库" })).toHaveAttribute("href", "https://github.com/a/b");
    expect(screen.getByRole("link", { name: "npm" })).toHaveAttribute("href", "https://www.npmjs.com/package/pi-web-access");
    expect(screen.getByRole("combobox", { name: "市场排序" })).toBeInTheDocument();
  });

  it("filters the market by capability and shows a package's integrity details (E1)", async () => {
    vi.mocked(agentExtensionsSearchRegistry).mockResolvedValue({
      query: "", source: "npm", total: 2, from: 0, fetchedAt: 0,
      packages: [
        { name: "pi-web-access", version: "1.2.0", description: "Web", keywords: ["pi-package", "browser"], categories: ["web"], weeklyDownloads: 10 },
        { name: "pi-mcp-bridge", version: "0.3.0", description: "MCP", keywords: ["pi-package", "mcp"], categories: ["mcp"], weeklyDownloads: 5 },
      ],
    });
    vi.mocked(agentExtensionsPackageDetails).mockResolvedValue({
      name: "pi-web-access", version: "1.2.0", integrity: "sha512-abc==",
      maintainers: ["nicopreme"], publishedAt: "2026-11-17T10:07:26.630Z",
      gitHead: "1f0c2d3", license: "MIT", unpackedSize: 2048, categories: ["web"],
    });
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));
    fireEvent.click(await screen.findByRole("button", { name: "搜索" }));
    expect(await screen.findByText("pi-web-access")).toBeInTheDocument();

    // Capability filter comes from the packages' own categories.
    fireEvent.change(screen.getByRole("combobox", { name: "按能力筛选" }), { target: { value: "mcp" } });
    expect(screen.queryByText("pi-web-access")).toBeNull();
    expect(screen.getByText("pi-mcp-bridge")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "按能力筛选" }), { target: { value: "all" } });
    const webRow = screen.getByText("pi-web-access").closest(".ext-market__item") as HTMLElement;
    fireEvent.click(within(webRow).getByRole("button", { name: "详情" }));
    await waitFor(() => expect(agentExtensionsPackageDetails).toHaveBeenCalledWith("pi-web-access"));
    expect(await screen.findByText("sha512-abc==")).toBeInTheDocument();
    expect(screen.getByText("@nicopreme")).toBeInTheDocument();
    expect(screen.getByText("1f0c2d3")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
  });

  it("edits Pi's glob patterns for an installed package (E1)", async () => {
    const installed = { source: "npm:pi-web-access", scope: "user" as const, filtered: false, installedPath: "/pi/pi-web-access", filters: { skills: ["docs/**"] } };
    vi.mocked(agentExtensionsPackages).mockResolvedValue([installed]);
    vi.mocked(agentExtensionsSetPackageResources).mockResolvedValue([{ ...installed, filters: { skills: ["docs/**", "!drafts/*"] } }]);
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "可信扩展" }));

    // The editor shows the patterns Pi already applies, and writes new ones back.
    fireEvent.click(await screen.findByRole("button", { name: "npm:pi-web-access 过滤模式" }));
    const input = await screen.findByLabelText("npm:pi-web-access 技能 模式");
    expect(input).toHaveValue("docs/**");
    fireEvent.change(input, { target: { value: "docs/**, !drafts/*" } });
    fireEvent.click(screen.getByRole("button", { name: "保存过滤" }));
    await waitFor(() => expect(agentExtensionsSetPackageResources).toHaveBeenCalledWith("npm:pi-web-access", {
      extensions: true, skills: ["docs/**", "!drafts/*"], prompts: true, themes: true,
    }));
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
