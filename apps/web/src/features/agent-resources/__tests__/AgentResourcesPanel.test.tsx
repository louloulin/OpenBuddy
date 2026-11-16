import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentResourcesPanel } from "../AgentResourcesPanel";
import { agentExtensionsSetEnabled, mcpAuthTrigger, mcpList, mcpTest } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  skillsList: vi.fn(async () => []), skillsAdd: vi.fn(), skillsRemove: vi.fn(), skillsToggle: vi.fn(),
  mcpList: vi.fn(async () => [{ name: "remote", transport: "streamable_http", target: "https://mcp.example.test", enabled: true, needsAuth: true }]),
  mcpTest: vi.fn(async () => ({ name: "remote", ok: true, ms: 42, transport: "streamable_http", tools: [{ name: "search" }, { name: "fetch" }] })),
  mcpToggle: vi.fn(async () => {}),
  mcpAuthTrigger: vi.fn(async () => ({ status: "authenticated" })),
  agentExtensionsList: vi.fn(async () => ({ enabled: false, paths: ["/trusted/extension.ts"], projectTrusted: true })),
  agentExtensionsSetEnabled: vi.fn(async () => ({ enabled: true, paths: ["/trusted/extension.ts"], projectTrusted: true })),
  agentExtensionsAdd: vi.fn(), agentExtensionsRemove: vi.fn(), agentExtensionsInspect: vi.fn(), agentExtensionsSetPathEnabled: vi.fn(),
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
});
