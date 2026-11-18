import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { COMMANDS } from "@openbuddy/protocol/commands";
import { useCapabilitiesStore } from "../../state/capabilities-store";
import { ExpertsHub, openHubAt } from "../ExpertsHub";

const invoked: string[] = [];
vi.mock("@openbuddy/client/agent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/client/agent-client")>();
  const record = (name: string, value: unknown) => vi.fn(async () => { invoked.push(name); return value; });
  return {
    ...actual,
    skillsList: record("skills_list", [{ name: "pdf", displayName: "PDF 工具", description: "读写 PDF", enabled: true, path: "/skills/pdf" }]),
    mcpAuthStatus: record("mcp_auth_status", []),
    agentExtensionsList: record("agent_extensions_list", { enabled: false, paths: [], projectTrusted: true }),
    agentsList: record("agents_list", []),
    expertsDefaultRoot: record("experts_default_root", ""),
    expertsLoad: record("experts_load", { userDir: "", projectTrusted: false, experts: [], categories: [], scenes: [], roots: [], problems: [] }),
    skillsCatalogDefaultRoot: record("skills_catalog_default_root", ""),
    connectorsDefaultRoot: record("connectors_default_root", "builtin:connectors"),
    connectorsListRoots: record("connectors_list_roots", ["builtin:connectors"]),
    connectorsLoad: record("connectors_load", {
      root: "builtin:connectors",
      categories: [{ id: "all", zh: "全部" }],
      connectors: [{ id: "filesystem", name: "本地文件系统", desc: "读写工作区文件。", source: "filesystem", kind: "mcp", examplesZh: [], cat: "files" }],
    }),
    connectorsReadMcpConfig: record("connectors_read_mcp_config", "{\"mcpServers\":{}}"),
    promptsList: record("prompts_list", []),
  };
});
vi.mock("@/features/experts/connectors/McpConfigEditor", () => ({ McpConfigEditor: () => <div>MCP 配置编辑器</div> }));

const desktop = (extra: string[] = []) => useCapabilitiesStore.getState().apply({ protocolVersion: 1, platform: "desktop", commands: [...COMMANDS, ...extra], events: [], features: [] });
beforeEach(() => { invoked.length = 0; });
afterEach(() => useCapabilitiesStore.getState().apply(null));

describe("专家·技能·连接器 hub (pii W0.3 / U7.6)", () => {
  it("hides catalogs the host does not serve and shows skills / MCP / extensions management instead", async () => {
    // A host without the catalog modules (W2.1–W2.3 experts, W2.7 skills catalog + prompts):
    // the 专家 / 我的指令 tabs are hidden too, and 技能 falls back to the management view.
    useCapabilitiesStore.getState().apply({ protocolVersion: 1, platform: "desktop", commands: COMMANDS.filter((c) => !/^(agents_|experts_|skills_catalog_|prompts_|connectors_)/.test(c)), events: [], features: [] });
    render(<ExpertsHub />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["技能", "连接器", "扩展"]);
    expect(await screen.findByText("PDF 工具")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "连接器" }));
    expect(await screen.findByText("MCP 配置编辑器")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "扩展" }));
    expect(await screen.findByRole("checkbox", { name: "启用可信扩展" })).toBeInTheDocument();
    expect(invoked.filter((name) => /^(experts_|agents_list|skills_catalog_|connectors_)/.test(name))).toEqual([]);
  });

  it("shows the 专家 tab once the host serves the experts commands", async () => {
    desktop(["agents_list", "experts_load"]);
    render(<ExpertsHub />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["专家", "技能", "连接器", "我的指令", "扩展"]);
    expect(screen.getByRole("tab", { name: "专家" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens at the tab asked for (composer → 管理连接器)", async () => {
    desktop();
    openHubAt("connectors");
    render(<ExpertsHub />);
    expect(screen.getByRole("tab", { name: "连接器" })).toHaveAttribute("aria-selected", "true");
    // The built-in catalog (W2.4 P2) is served by connectors_default_root / connectors_load.
    expect(await screen.findByText("本地文件系统")).toBeInTheDocument();
  });

  it("serves 我的指令 from prompts_list and hides it otherwise (W2.7 / S8)", async () => {
    desktop();
    render(<ExpertsHub />);
    fireEvent.click(screen.getByRole("tab", { name: "我的指令" }));
    expect(await screen.findByText(/指令保存在/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建指令/ })).toBeInTheDocument();
    expect(invoked).toContain("prompts_list");
  });
});
