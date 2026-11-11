import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentResourcesPanel } from "../AgentResourcesPanel";
import { mcpAuthStatus, mcpAuthTrigger } from "@/lib/agent-client";

vi.mock("@/lib/agent-client", () => ({
  skillsList: vi.fn(async () => []), skillsAdd: vi.fn(), skillsRemove: vi.fn(), skillsToggle: vi.fn(),
  mcpAuthStatus: vi.fn(async () => [{ serverName: "remote", status: "needs_auth" }]),
  mcpAuthTrigger: vi.fn(async () => ({ status: "authenticated" })),
}));
vi.mock("../experts-panel/connectors/McpConfigEditor", () => ({ McpConfigEditor: () => <div>MCP editor</div> }));
beforeEach(() => vi.clearAllMocks());

describe("MCP explicit OAuth", () => {
  it("reads status without starting auth and refreshes status after successful user authorization", async () => {
    vi.mocked(mcpAuthStatus).mockResolvedValueOnce([{ serverName: "remote", status: "needs_auth" }]).mockResolvedValue([{ serverName: "remote", status: "authenticated" }]);
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 配置" }));
    expect(await screen.findByText("需要授权")).toBeInTheDocument();
    expect(mcpAuthTrigger).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "授权 remote" }));
    expect(await screen.findByText("已授权")).toBeInTheDocument();
    expect(mcpAuthTrigger).toHaveBeenCalledWith("A", "remote");
    expect(mcpAuthStatus).toHaveBeenCalledTimes(2);
  });
  it.each(["cancelled", "failed"])("shows %s auth results and leaves retry available", async status => {
    vi.mocked(mcpAuthStatus).mockResolvedValue([{ serverName: "remote", status: "needs_auth" }]);
    vi.mocked(mcpAuthTrigger).mockResolvedValue({ status });
    render(<AgentResourcesPanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "MCP 配置" }));
    fireEvent.click(await screen.findByRole("button", { name: "授权 remote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(status === "cancelled" ? "已取消" : "授权失败");
    await waitFor(() => expect(screen.getByRole("button", { name: "授权 remote" })).toBeEnabled());
  });
});
